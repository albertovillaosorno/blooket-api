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
import {
  lstat,
  readFile,
} from "node:fs/promises";

import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import {
  isRecord,
  requiredString,
  unknownFieldIssues,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import {
  removeDurableFile,
  writeAtomicFile,
  writeDurableFileIfAbsent,
} from "../../atomic-files/adapter-outbound/atomic-file.ts";

export const WRITE_ATTEMPT_VERSION = 1 as const;

export function writeAttemptExecutionLockPath(path: string): string {
  return path + ".lock";
}

export interface WriteAttemptRecord {
  readonly schemaVersion: typeof WRITE_ATTEMPT_VERSION;
  readonly planId: string;
  readonly operationId: string;
  readonly operationIndex: number;
  readonly phase: "attempting" | "confirmed";
}

const WRITE_ATTEMPT_KEYS = new Set([
  "schemaVersion",
  "planId",
  "operationId",
  "operationIndex",
  "phase",
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
): Promise<WriteAttemptFileMutationResult> {
  const operation = plan.operations[operationIndex];
  if (operation === undefined) {
    return invalidFailure(
      "$.operationIndex",
      "invalid-write-attempt-index",
      "Expected an operation index present in the write plan.",
    );
  }

  const record: WriteAttemptRecord = {
    schemaVersion: WRITE_ATTEMPT_VERSION,
    planId: plan.planId,
    operationId: operation.operationId,
    operationIndex,
    phase: "attempting",
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
  if (record.phase === "confirmed") {
    return { ok: true, record };
  }

  const confirmed: WriteAttemptRecord = {
    ...record,
    phase: "confirmed",
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

  const issues: ValidationIssue[] = [
    ...unknownFieldIssues(value, WRITE_ATTEMPT_KEYS, "$"),
  ];
  const planId = requiredString(value["planId"], "$.planId", issues);
  const operationId = requiredString(
    value["operationId"],
    "$.operationId",
    issues,
  );
  const operationIndex = value["operationIndex"];
  const phase = value["phase"];

  if (value["schemaVersion"] !== WRITE_ATTEMPT_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      code: "unsupported-version",
      message: "Expected write attempt journal version 1.",
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

  if (issues.length > 0) {
    return { ok: false, kind: "invalid", issues };
  }
  if (
    planId === undefined
    || operationId === undefined
    || typeof operationIndex !== "number"
    || (phase !== "attempting" && phase !== "confirmed")
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
    },
  };
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

async function readOwnedTextFile(path: string): Promise<
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "unreadable" }
> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { kind: "unsafe" };
    }
    return {
      kind: "text",
      value: await readFile(path, "utf8"),
    };
  } catch (error: unknown) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return { kind: "missing" };
    }
    return { kind: "unreadable" };
  }
}
