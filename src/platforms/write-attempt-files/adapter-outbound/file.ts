// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - MIT
// Confidential:
//   - false
// License-File:
//   - LICENSE-MIT
//
// Boundary-Contract:
// - Owns:
//   - Durable write-ahead evidence for one in-flight Blooket write operation.
// - Must-Not:
//   - Execute writes, infer remote success, or delete corrupt recovery
//     evidence.
// - Allows:
//   - Inputs: Trusted journal paths, exact write plans, and operation
//     identities.
//   - Outputs: Missing/attempting/confirmed records or stable failures.
//   - Side effects: Atomically creates, confirms, and clears one journal file.
// - Split-When:
//   - Multiple concurrent remote operations require independent journal slots.
// - Merge-When:
//   - Remote writes become transactionally queryable and no journal is needed.
// - Summary:
//   - Preserves enough evidence to distinguish ambiguous from confirmed writes.
// - Description:
//   - Begin never overwrites; confirm replaces atomically; clear validates
//     first.
// - Usage:
//   - Begin immediately before a remote mutation and confirm immediately after.
// - Defaults:
//   - Existing or malformed journals stop execution instead of being replaced.
//
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";
import {
  decodeBlooketWriteReceipt,
  type BlooketWriteReceipt,
} from "../../../projects/blooket-write-plans/domain/checkpoint.ts";
import {
  decodeBlooketWriteVerificationBaseline,
  verificationBaselineKindForOperation,
  type BlooketWriteVerificationBaseline,
} from
  "../../../projects/blooket-write-plans/domain/verification-baseline.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import {
  removeDurableFile,
  writeAtomicFile,
  writeDurableFileIfAbsent,
} from "../../atomic-files/adapter-outbound/atomic-file.ts";

export const WRITE_ATTEMPT_VERSION = 3 as const;
const LEGACY_WRITE_ATTEMPT_VERSION = 1 as const;
const RECEIPT_WRITE_ATTEMPT_VERSION = 2 as const;

export function writeAttemptExecutionLockPath(path: string): string {
  return path + ".lock";
}

export interface WriteAttemptRecord {
  readonly schemaVersion: typeof WRITE_ATTEMPT_VERSION;
  readonly planId: string;
  readonly operationId: string;
  readonly operationIndex: number;
  readonly phase: "attempting" | "confirmed";
  readonly receipt: BlooketWriteReceipt | null;
  readonly baseline: BlooketWriteVerificationBaseline | null;
}

const LEGACY_WRITE_ATTEMPT_KEYS = new Set([
  "schemaVersion",
  "planId",
  "operationId",
  "operationIndex",
  "phase",
]);
const RECEIPT_WRITE_ATTEMPT_KEYS = new Set([
  ...LEGACY_WRITE_ATTEMPT_KEYS,
  "receipt",
]);
const WRITE_ATTEMPT_KEYS = new Set([
  ...RECEIPT_WRITE_ATTEMPT_KEYS,
  "baseline",
]);

export type WriteAttemptFileLoadResult =
  | {
      readonly ok: true;
      readonly kind: "missing";
    }
  | {
      readonly ok: true;
      readonly kind: "record";
      readonly record: WriteAttemptRecord;
    }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code:
        | "write-attempt-file-unsafe"
        | "write-attempt-file-unreadable";
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[];
    };

export type WriteAttemptFileMutationResult =
  | {
      readonly ok: true;
      readonly record?: WriteAttemptRecord;
    }
  | {
      readonly ok: false;
      readonly kind: "conflict";
      readonly code: "write-attempt-exists";
    }
  | {
      readonly ok: false;
      readonly kind: "io";
      readonly code:
        | "write-attempt-file-unsafe"
        | "write-attempt-write-failed";
    }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[];
    };

export async function loadWriteAttemptFile(
  path: string,
  plan: BlooketWritePlan,
): Promise<WriteAttemptFileLoadResult> {
  const read = await readOwnedTextFile(path);
  if (read.kind === "missing") {
    return { ok: true, kind: "missing" };
  }
  if (read.kind === "unsafe") {
    return {
      ok: false,
      kind: "io",
      code: "write-attempt-file-unsafe",
    };
  }
  if (read.kind === "unreadable") {
    return {
      ok: false,
      kind: "io",
      code: "write-attempt-file-unreadable",
    };
  }

  const parsed = parseJson(read.value);
  if (!parsed.ok) {
    return parsed;
  }
  const decoded = decodeWriteAttempt(parsed.value, plan);
  if (!decoded.ok) {
    return decoded;
  }
  return {
    ok: true,
    kind: "record",
    record: decoded.value,
  };
}

export async function beginWriteAttempt(
  path: string,
  plan: BlooketWritePlan,
  operationIndex: number,
  baselineCandidate: unknown = null,
): Promise<WriteAttemptFileMutationResult> {
  const operation = plan.operations[operationIndex];
  if (operation === undefined) {
    return invalidFailure(
      "$.operationIndex",
      "invalid-write-attempt-index",
      "Expected an operation index present in the write plan.",
    );
  }

  const baseline = decodeAttemptBaseline(
    baselineCandidate,
    operation.kind,
  );
  if (!baseline.ok) {
    return {
      ok: false,
      kind: "invalid",
      issues: baseline.issues,
    };
  }

  const record: WriteAttemptRecord = {
    schemaVersion: WRITE_ATTEMPT_VERSION,
    planId: plan.planId,
    operationId: operation.operationId,
    operationIndex,
    phase: "attempting",
    receipt: null,
    baseline: baseline.value,
  };

  try {
    const created = await writeDurableFileIfAbsent(
      path,
      serialize(record),
    );
    return created === "created"
      ? { ok: true, record }
      : {
          ok: false,
          kind: "conflict",
          code: "write-attempt-exists",
        };
  } catch {
    return {
      ok: false,
      kind: "io",
      code: "write-attempt-write-failed",
    };
  }
}

export async function confirmWriteAttempt(
  path: string,
  plan: BlooketWritePlan,
  operationId: string,
  receiptCandidate: unknown,
): Promise<WriteAttemptFileMutationResult> {
  const loaded = await loadWriteAttemptFile(path, plan);
  if (!loaded.ok) {
    return loaded.kind === "io"
      ? {
          ok: false,
          kind: "io",
          code: loaded.code === "write-attempt-file-unsafe"
            ? "write-attempt-file-unsafe"
            : "write-attempt-write-failed",
        }
      : loaded;
  }
  if (loaded.kind === "missing") {
    return invalidFailure(
      "$",
      "write-attempt-missing",
      "Expected an existing write attempt journal.",
    );
  }

  const record = loaded.record;
  if (record.operationId !== operationId) {
    return invalidFailure(
      "$.operationId",
      "write-attempt-operation-mismatch",
      "Attempt journal belongs to a different operation.",
    );
  }
  const operation = plan.operations[record.operationIndex];
  if (operation === undefined) {
    return invalidFailure(
      "$.operationIndex",
      "invalid-write-attempt-index",
      "Expected an operation index present in the write plan.",
    );
  }
  const receipt = decodeConfirmedReceipt(
    receiptCandidate,
    operation.kind,
  );
  if (!receipt.ok) {
    return receipt;
  }
  if (record.phase === "confirmed") {
    if (!sameReceipt(record.receipt, receipt.value)) {
      return invalidFailure(
        "$.receipt",
        "write-attempt-receipt-mismatch",
        "Confirmed journal has a different write receipt.",
      );
    }
    return { ok: true, record };
  }

  const confirmed: WriteAttemptRecord = {
    ...record,
    phase: "confirmed",
    receipt: receipt.value,
  };
  try {
    await writeAtomicFile(path, serialize(confirmed));
    return { ok: true, record: confirmed };
  } catch {
    return {
      ok: false,
      kind: "io",
      code: "write-attempt-write-failed",
    };
  }
}

export async function clearWriteAttempt(
  path: string,
  plan: BlooketWritePlan,
): Promise<WriteAttemptFileMutationResult> {
  const loaded = await loadWriteAttemptFile(path, plan);
  if (!loaded.ok) {
    return loaded.kind === "io"
      ? {
          ok: false,
          kind: "io",
          code: loaded.code === "write-attempt-file-unsafe"
            ? "write-attempt-file-unsafe"
            : "write-attempt-write-failed",
        }
      : loaded;
  }
  if (loaded.kind === "missing") {
    return { ok: true };
  }

  try {
    await removeDurableFile(path);
    return { ok: true };
  } catch {
    return {
      ok: false,
      kind: "io",
      code: "write-attempt-write-failed",
    };
  }
}

function decodeWriteAttempt(
  value: unknown,
  plan: BlooketWritePlan,
):
  | { readonly ok: true; readonly value: WriteAttemptRecord }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[];
    } {
  if (!isRecord(value)) {
    return invalidFailure(
      "$",
      "expected-object",
      "Expected a write attempt journal object.",
    );
  }

  const inputVersion = value["schemaVersion"];
  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(
      value,
      inputVersion === LEGACY_WRITE_ATTEMPT_VERSION
        ? LEGACY_WRITE_ATTEMPT_KEYS
        : inputVersion === RECEIPT_WRITE_ATTEMPT_VERSION
          ? RECEIPT_WRITE_ATTEMPT_KEYS
          : WRITE_ATTEMPT_KEYS,
      "$",
    ),
  ];
  const planId = requiredString(value["planId"], "$.planId", issues);
  const operationId = requiredString(
    value["operationId"],
    "$.operationId",
    issues,
  );
  const operationIndex = value["operationIndex"];
  const phase = value["phase"];

  if (
    inputVersion !== LEGACY_WRITE_ATTEMPT_VERSION
    && inputVersion !== RECEIPT_WRITE_ATTEMPT_VERSION
    && inputVersion !== WRITE_ATTEMPT_VERSION
  ) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected write attempt journal version 1, 2, or 3.",
    });
  }
  if (planId !== undefined && planId !== plan.planId) {
    issues.push({
      path: "$.planId",
      code: "write-plan-mismatch",
      message: "Attempt journal belongs to a different write plan.",
    });
  }
  if (
    typeof operationIndex !== "number"
    || !Number.isSafeInteger(operationIndex)
    || operationIndex < 0
    || operationIndex >= plan.operations.length
  ) {
    issues.push({
      path: "$.operationIndex",
      code: "invalid-write-attempt-index",
      message: "Expected an operation index present in the write plan.",
    });
  }
  if (phase !== "attempting" && phase !== "confirmed") {
    issues.push({
      path: "$.phase",
      code: "invalid-write-attempt-phase",
      message: 'Expected "attempting" or "confirmed".',
    });
  }
  if (
    typeof operationIndex === "number"
    && Number.isSafeInteger(operationIndex)
    && operationIndex >= 0
    && operationIndex < plan.operations.length
    && operationId !== undefined
    && plan.operations[operationIndex]?.operationId !== operationId
  ) {
    issues.push({
      path: "$.operationId",
      code: "write-attempt-operation-mismatch",
      message: "Attempt operation does not match the plan index.",
    });
  }

  const operation = typeof operationIndex === "number"
    && Number.isSafeInteger(operationIndex)
    && operationIndex >= 0
    && operationIndex < plan.operations.length
    ? plan.operations[operationIndex]
    : undefined;
  const receipt = decodeStoredReceipt(
    inputVersion,
    value["receipt"],
    phase,
    operation?.kind,
    issues,
  );
  const baseline = decodeStoredBaseline(
    inputVersion,
    value["baseline"],
    operation?.kind,
    issues,
  );

  if (issues.length > 0) {
    return { ok: false, kind: "invalid", issues };
  }
  if (
    planId === undefined
    || operationId === undefined
    || typeof operationIndex !== "number"
    || (phase !== "attempting" && phase !== "confirmed")
    || receipt === undefined
    || baseline === undefined
  ) {
    return invalidFailure(
      "$",
      "decoder-invariant",
      "Write attempt decoder invariant failed.",
    );
  }

  return {
    ok: true,
    value: {
      schemaVersion: WRITE_ATTEMPT_VERSION,
      planId,
      operationId,
      operationIndex,
      phase,
      receipt,
      baseline,
    },
  };
}

function decodeAttemptBaseline(
  value: unknown,
  operationKind: "set" | "question",
):
  | {
      readonly ok: true;
      readonly value: BlooketWriteVerificationBaseline | null;
    }
  | {
      readonly ok: false;
      readonly issues: readonly ValidationIssue[];
    } {
  if (value === null) {
    return { ok: true, value: null };
  }
  return decodeBlooketWriteVerificationBaseline(
    value,
    verificationBaselineKindForOperation(operationKind),
  );
}

function decodeStoredBaseline(
  version: unknown,
  value: unknown,
  operationKind: "set" | "question" | undefined,
  issues: ValidationIssue[],
): BlooketWriteVerificationBaseline | null | undefined {
  if (
    version === LEGACY_WRITE_ATTEMPT_VERSION
    || version === RECEIPT_WRITE_ATTEMPT_VERSION
  ) {
    return null;
  }
  if (operationKind === undefined) {
    return null;
  }
  const decoded = decodeAttemptBaseline(value, operationKind);
  if (!decoded.ok) {
    issues.push(...decoded.issues.map((issue) => ({
      ...issue,
      path: issue.path === "$"
        ? "$.baseline"
        : "$.baseline" + issue.path.slice(1),
    })));
    return undefined;
  }
  return decoded.value;
}

function decodeConfirmedReceipt(
  value: unknown,
  operationKind: "set" | "question",
):
  | { readonly ok: true; readonly value: BlooketWriteReceipt | null }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[];
    } {
  if (operationKind === "question") {
    return value === null
      ? { ok: true, value: null }
      : invalidFailure(
          "$.receipt",
          "unexpected-write-receipt",
          "Question writes must not return a set-creation receipt.",
        );
  }
  const decoded = decodeBlooketWriteReceipt(value);
  return decoded.ok
    ? { ok: true, value: decoded.value }
    : { ok: false, kind: "invalid", issues: decoded.issues };
}

function decodeStoredReceipt(
  version: unknown,
  value: unknown,
  phase: unknown,
  operationKind: "set" | "question" | undefined,
  issues: ValidationIssue[],
): BlooketWriteReceipt | null | undefined {
  if (operationKind === undefined) {
    return null;
  }
  if (version === LEGACY_WRITE_ATTEMPT_VERSION) {
    if (phase === "confirmed" && operationKind === "set") {
      issues.push({
        path: "$.receipt",
        code: "missing-set-receipt",
        message: "Legacy confirmed set attempt has no remote set binding.",
      });
    }
    return null;
  }
  if (phase === "attempting") {
    if (value !== null) {
      issues.push({
        path: "$.receipt",
        code: "unexpected-write-receipt",
        message: "Attempting journals cannot contain confirmed receipts.",
      });
    }
    return value === null ? null : undefined;
  }
  if (phase !== "confirmed") {
    return null;
  }
  if (operationKind === "question") {
    if (value !== null) {
      issues.push({
        path: "$.receipt",
        code: "unexpected-write-receipt",
        message: "Question attempts cannot contain set receipts.",
      });
    }
    return value === null ? null : undefined;
  }
  const decoded = decodeBlooketWriteReceipt(value);
  if (!decoded.ok) {
    issues.push(...decoded.issues);
    return undefined;
  }
  return decoded.value;
}

function sameReceipt(
  left: BlooketWriteReceipt | null,
  right: BlooketWriteReceipt | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.kind === right.kind
    && left.remoteSetId === right.remoteSetId;
}

function parseJson(source: string):
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly kind: "invalid";
      readonly issues: readonly ValidationIssue[];
    } {
  try {
    return {
      ok: true,
      value: JSON.parse(source) as unknown,
    };
  } catch {
    return invalidFailure(
      "$",
      "invalid-json",
      "Write attempt journal contains invalid JSON.",
    );
  }
}

function invalidFailure(
  path: string,
  code: string,
  message: string,
): {
  readonly ok: false;
  readonly kind: "invalid";
  readonly issues: readonly ValidationIssue[];
} {
  return {
    ok: false,
    kind: "invalid",
    issues: [{ path, code, message }],
  };
}

function serialize(record: WriteAttemptRecord): string {
  return JSON.stringify(record, null, 2) + "\n";
}

const MAX_ATTEMPT_FILE_BYTES = 65_536;

async function readOwnedTextFile(path: string): Promise<
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "unreadable" }
> {
  // Open and inspect the same descriptor: lstat followed by readFile could
  // follow a symlink swapped in between the two filesystem operations.
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ENOENT") return { kind: "missing" };
      if (error.code === "ELOOP") return { kind: "unsafe" };
    }
    return { kind: "unreadable" };
  }
  let result:
    | { readonly kind: "text"; readonly value: string }
    | { readonly kind: "unsafe" }
    | { readonly kind: "unreadable" } = { kind: "unreadable" };
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_ATTEMPT_FILE_BYTES) {
      result = { kind: "unsafe" };
    } else {
      const bytes = Buffer.alloc(MAX_ATTEMPT_FILE_BYTES + 1);
      let size = 0;
      let complete = false;
      while (size < bytes.length) {
        const part = await handle.read(bytes, size, bytes.length - size, null);
        if (part.bytesRead === 0) {
          complete = true;
          break;
        }
        size += part.bytesRead;
      }
      result = complete
        ? { kind: "text", value: bytes.subarray(0, size).toString("utf8") }
        : { kind: "unsafe" };
    }
  } catch { /* An unreadable descriptor cannot admit a new reservation. */ }
  try { await handle.close(); }
  catch { return { kind: "unreadable" }; }
  return result;
}
