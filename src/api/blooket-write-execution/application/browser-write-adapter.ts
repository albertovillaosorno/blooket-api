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
//   - Adaptation from canonical write execution to browser form submissions.
// - Must-Not:
//   - Persist progress, inspect DOM, resolve media, retry, or bypass stops.
// - Allows:
//   - Inputs: Browser write surface plus canonical operation/target calls.
//   - Outputs: The existing confirmed write-attempt contract.
//   - Side effects: Delegates at most one browser form mutation to the surface.
// - Split-When:
//   - Browser surface outcomes need provider-specific recovery policies.
// - Merge-When:
//   - The canonical write port directly consumes provider submissions.
// - Summary:
//   - Lowers one write and converts confirmed browser outcomes to receipts.
// - Description:
//   - Create Set IDs are decoded again before they become durable receipts.
// - Usage:
//   - Wrap a verified concrete browser surface for persisted execution.
// - Defaults:
//   - Lowering, malformed success data, and exceptions fail closed.
//
import { decodeBlooketSetId } from
  "../../../ir/blooket-set-reads/contract/set-read.ts";
import { exactOwnData, snapshotExactDenseArray } from
  "../../../ir/runtime-decoding/domain/exact-object.ts";

import type {
  BlooketAddQuestionSubmission,
  BlooketCreateSetSubmission,
} from "../../../ir/blooket-write-submissions/contract/write-submission.ts";
import type { BlooketPreparedMedia } from
  "../contract/prepared-media.ts";
import { blooketWriteOperationMediaIds } from
  "./admit-prepared-media.ts";
import type {
  BlooketWriteAttemptResult,
  BlooketWriteExecutionPort,
} from "../contract/write-execution.ts";
import type {
  BlooketAddQuestionSurfaceResult,
  BlooketBrowserWriteSurfacePort,
  BlooketCreateSetSurfaceResult,
} from "../contract/browser-write-surface.ts";
import { lowerBlooketWriteSubmission } from "./lower-submission.ts";

// This identifies a trusted composition route, never provider evidence or a
// remote command permission. The surface still owes fresh saved-state proof.
const browserPorts = new WeakSet<BlooketWriteExecutionPort>();
const confirmationProbes = new WeakMap<BlooketWriteExecutionPort,
  () => Promise<boolean>>();
export function isBrowserWriteExecutionPort(port: BlooketWriteExecutionPort):
  boolean {
  return browserPorts.has(port);
}

export async function browserCreateSetConfirmationSupported(
  port: BlooketWriteExecutionPort,
): Promise<boolean> {
  try { return await confirmationProbes.get(port)?.() === true; }
  catch { return false; }
}

export function blooketBrowserWriteExecutionPort(
  surface: BlooketBrowserWriteSurfacePort,
): BlooketWriteExecutionPort {
  const port: BlooketWriteExecutionPort = {
    execute: async (operation, target, context) => {
      const lowered = lowerBlooketWriteSubmission(operation, target);
      if (!lowered.ok) {
        return browserFailure();
      }
      const expectedMediaIds = blooketWriteOperationMediaIds(operation);
      const admitted = ownMediaArguments(
        context.preparedMedia, expectedMediaIds,
      );
      if (!admitted) return browserFailure();

      try {
        if (lowered.value.kind === "create-set") {
          return await executeCreateSet(surface, lowered.value, admitted);
        }
        return await executeAddQuestion(surface, lowered.value, admitted);
      } catch {
        return browserFailure();
      }
    },
  };
  browserPorts.add(port);
  const probe = Object.getOwnPropertyDescriptor(surface,
    "inspectCreateSetConfirmation");
  if (probe?.enumerable && Object.hasOwn(probe, "value") &&
      typeof probe.value === "function")
    confirmationProbes.set(port, () => probe.value.call(surface));
  return Object.freeze(port);
}

function ownMediaArguments(
  provided: unknown, expectedIds: readonly string[],
): readonly BlooketPreparedMedia[] | undefined {
  const items = snapshotExactDenseArray(provided, expectedIds.length);
  if (!items || items.length !== expectedIds.length) return undefined;
  const captured: BlooketPreparedMedia[] = [];
  try {
    const length = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype), "byteLength",
    )?.get;
    if (!length) return undefined;
    for (let index = 0; index < items.length; index++) {
      const owned = exactOwnData(items[index],
        ["bytes", "format", "mediaId", "revision"]);
      const bytes = owned?.["bytes"];
      if (!owned || owned["mediaId"] !== expectedIds[index] ||
          !Number.isSafeInteger(owned["revision"]) ||
          (owned["revision"] as number) < 1 ||
          (owned["format"] !== "png" && owned["format"] !== "jpeg" &&
           owned["format"] !== "gif") ||
          !(bytes instanceof Uint8Array)) return undefined;
      const byteCount = length.call(bytes) as number;
      if (byteCount < 1 || byteCount >= 2_500_000) return undefined;
      captured.push(Object.freeze({
        mediaId: owned["mediaId"] as string,
        revision: owned["revision"] as number,
        format: owned["format"] as BlooketPreparedMedia["format"],
        bytes,
      }));
    }
  } catch { return undefined; }
  return Object.freeze(captured);
}

async function executeCreateSet(
  surface: BlooketBrowserWriteSurfacePort,
  submission: BlooketCreateSetSubmission,
  media: Parameters<BlooketBrowserWriteSurfacePort["createSet"]>[1],
): Promise<BlooketWriteAttemptResult> {
  const result = await surface.createSet(submission, media);
  const acknowledged = exactOwnData(result, ["ok", "remoteSetId"]);
  if (acknowledged?.["ok"] !== true) return preserveFailure(result);

  const decoded = decodeBlooketSetId(
    acknowledged["remoteSetId"], "$.remoteSetId",
  );
  if (!decoded.ok) {
    return browserFailure();
  }
  return {
    ok: true,
    receipt: {
      kind: "set-created",
      remoteSetId: decoded.value,
    },
  };
}

async function executeAddQuestion(
  surface: BlooketBrowserWriteSurfacePort,
  submission: BlooketAddQuestionSubmission,
  media: Parameters<BlooketBrowserWriteSurfacePort["addQuestion"]>[1],
): Promise<BlooketWriteAttemptResult> {
  const result = await surface.addQuestion(submission, media);
  if (exactOwnData(result, ["ok"])?.["ok"] === true)
    return { ok: true, receipt: null };
  return preserveFailure(result);
}

function preserveFailure(
  result: BlooketCreateSetSurfaceResult | BlooketAddQuestionSurfaceResult,
): BlooketWriteAttemptResult {
  const browser = exactOwnData(result, ["code", "kind", "ok"]);
  if (browser?.["ok"] === false && browser["kind"] === "browser" &&
      (browser["code"] === "blooket-browser-unavailable" ||
       browser["code"] === "blooket-browser-failed"))
    return { ok: false, kind: "browser", code: browser["code"] };
  const navigation = exactOwnData(result, ["kind", "ok", "state"]);
  const state = navigation?.["state"];
  if (navigation?.["ok"] === false &&
      navigation["kind"] === "navigation" &&
      (state === "signed-out" || state === "organization-prompt" ||
       state === "expired-session" || state === "rate-limited" ||
       state === "security-challenge" || state === "unexpected-page"))
    return { ok: false, kind: "navigation", state };
  return browserFailure();
}

function browserFailure(): BlooketWriteAttemptResult {
  return {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  };
}
