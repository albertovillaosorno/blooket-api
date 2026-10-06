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
//   - Differential Create Set verification from validated set read surfaces.
// - Must-Not:
//   - Verify questions, mutate remotely, retry, or infer from title alone.
// - Allows:
//   - Inputs: Set read port plus exact operation, target, and prior baseline.
//   - Outputs: Set-list baselines and exact reconciliation evidence.
//   - Side effects: Read-only set list/detail browser observations.
// - Split-When:
//   - Question reads gain a verified independently versioned shape.
// - Merge-When:
//   - Browser writes expose transactionally queryable operation receipts.
// - Summary:
//   - Confirms Create Set only by reproducing the exact pre-write collection.
// - Description:
//   - One candidate is removed from post-state before baseline comparison.
// - Usage:
//   - Use as the write verifier until question read evidence is available.
// - Defaults:
//   - Question verification and concurrent/ambiguous changes are inconclusive.
//
import { createHash } from "node:crypto";

import {
  decodeBlooketSetDetail,
  decodeBlooketSetList,
  type BlooketSetDetail,
  type BlooketSetSummary,
} from "../../../ir/blooket-set-reads/contract/set-read.ts";
import {
  frameBlooketWriteVerificationCollection,
  type BlooketWriteVerificationBaseline,
} from
  "../../../projects/blooket-write-plans/domain/verification-baseline.ts";
import type { BlooketSetReadPort } from
  "../../blooket-set-reads/contract/set-reads.ts";
import type {
  BlooketWriteVerificationPort,
  BlooketWriteVerificationResult,
} from "../contract/write-verification.ts";

export function blooketSetReadWriteVerifier(
  reads: BlooketSetReadPort,
): BlooketWriteVerificationPort {
  return {
    captureBaseline: async (operation) => {
      if (operation.kind === "question") {
        return { ok: true, baseline: null };
      }
      const listed = await safeList(reads);
      if (!listed.ok) {
        return listed;
      }
      return {
        ok: true,
        baseline: baselineFor(listed.value),
      };
    },

    verify: async (operation, _target, baseline) => {
      if (operation.kind === "question") {
        return { ok: true, outcome: "inconclusive" };
      }
      if (baseline === null || baseline.kind !== "set-list") {
        return { ok: true, outcome: "inconclusive" };
      }

      const listed = await safeList(reads);
      if (!listed.ok) {
        return listed;
      }
      const currentBaseline = baselineFor(listed.value);
      if (sameBaseline(currentBaseline, baseline)) {
        return { ok: true, outcome: "not-confirmed" };
      }
      if (listed.value.length !== baseline.itemCount + 1) {
        return { ok: true, outcome: "inconclusive" };
      }
      if (operation.coverMediaId !== null) {
        return { ok: true, outcome: "inconclusive" };
      }

      const candidates = listed.value
        .map((set, index) => ({ set, index }))
        .filter(({ set }) => set.title === operation.title)
        .filter(({ index }) => sameBaseline(
          baselineFor(withoutIndex(listed.value, index)),
          baseline,
        ));
      if (candidates.length !== 1) {
        return { ok: true, outcome: "inconclusive" };
      }

      const candidate = candidates[0]?.set;
      if (candidate === undefined) {
        return { ok: true, outcome: "inconclusive" };
      }
      const detailed = await safeGet(reads, candidate.id);
      if (!detailed.ok) {
        return detailed;
      }
      if (
        detailed.value.id !== candidate.id
        || detailed.value.title !== operation.title
        || detailed.value.description !== operation.description
        || detailed.value.visibility !== operation.visibility
      ) {
        return { ok: true, outcome: "inconclusive" };
      }
      return {
        ok: true,
        outcome: "confirmed",
        receipt: {
          kind: "set-created",
          remoteSetId: candidate.id,
        },
      };
    },
  };
}

async function safeList(
  reads: BlooketSetReadPort,
): Promise<
  | { readonly ok: true; readonly value: readonly BlooketSetSummary[] }
  | Extract<BlooketWriteVerificationResult, { readonly ok: false }>
> {
  try {
    const probed = await reads.list();
    if (!probed.ok) {
      return { ok: false, kind: "browser", code: probed.code };
    }
    const decoded = decodeBlooketSetList(probed.value);
    return decoded.ok
      ? { ok: true, value: decoded.value }
      : browserFailure();
  } catch {
    return browserFailure();
  }
}

async function safeGet(
  reads: BlooketSetReadPort,
  setId: string,
): Promise<
  | {
      readonly ok: true;
      readonly value: BlooketSetDetail;
    }
  | Extract<BlooketWriteVerificationResult, { readonly ok: false }>
> {
  try {
    const probed = await reads.get(setId);
    if (!probed.ok) {
      return { ok: false, kind: "browser", code: probed.code };
    }
    const decoded = decodeBlooketSetDetail(probed.value);
    return decoded.ok
      ? { ok: true, value: decoded.value }
      : browserFailure();
  } catch {
    return browserFailure();
  }
}

function baselineFor(
  sets: readonly BlooketSetSummary[],
): BlooketWriteVerificationBaseline {
  const items = sets.map((set) => JSON.stringify([set.id, set.title]));
  const framed = frameBlooketWriteVerificationCollection(items);
  return {
    schemaVersion: 1,
    kind: "set-list",
    itemCount: sets.length,
    sha256: createHash("sha256").update(framed, "utf8").digest("hex"),
  };
}

function withoutIndex(
  sets: readonly BlooketSetSummary[],
  index: number,
): readonly BlooketSetSummary[] {
  return [
    ...sets.slice(0, index),
    ...sets.slice(index + 1),
  ];
}

function sameBaseline(
  left: BlooketWriteVerificationBaseline,
  right: BlooketWriteVerificationBaseline,
): boolean {
  return left.kind === right.kind
    && left.itemCount === right.itemCount
    && left.sha256 === right.sha256;
}

function browserFailure(): Extract<
  BlooketWriteVerificationResult,
  { readonly ok: false }
> {
  return {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  };
}
