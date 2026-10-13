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
//   - Consistency checks between visible and server-rendered library facts.
// - Must-Not:
//   - Upgrade completeness or expose captured Flight text to the bridge.
// - Allows:
//   - Inputs: An untrusted DOM observation and a local-only model envelope.
//   - Outputs: The original consistent observation or stable failure.
//   - Side effects: None.
// - Split-When:
//   - Another browser host requires materially different consistency checks.
// - Merge-When:
//   - Provider library reads expose equivalent authoritative identity facts.
// - Summary:
//   - Rejects missing or changed cards for the exact observed model build.
// - Description:
//   - Unknown builds retain the existing visible observation boundary.
// - Usage:
//   - Compare both observations inside the paired extension worker.
// - Defaults:
//   - The allSets name never upgrades unknown collection completeness.
//
import {
  BLOOKET_LIBRARY_MODEL_BUILD, decodeBlooketLibraryModel,
} from "../../../ir/blooket-flight-records/contract/library-model.ts";
import {
  exactOwnData, ownDataField, snapshotExactDenseArray,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";

export function checkBlooketLibraryObservation(
  observed: unknown,
  captured: unknown,
): unknown {
  if (!record(observed) || ownDataField(observed, "ok") !== true ||
      !record(ownDataField(observed, "value"))) return observed;
  const observation = ownDataField(observed, "value");
  if (!record(observation)) return observed;
  const items = snapshotExactDenseArray(
    ownDataField(observation, "items"), 200,
  );
  if (!items) return { ok: false, code: "blooket-browser-failed" };
  if (captured === null) return observed;
  const failed = { ok: false, code: "blooket-browser-failed" };
  const modelSource = exactOwnData(captured, ["build", "source"]);
  if (!modelSource || typeof modelSource["build"] !== "string" ||
      typeof modelSource["source"] !== "string") return failed;
  if (modelSource["build"] !== BLOOKET_LIBRARY_MODEL_BUILD)
    return observed;
  const model = decodeBlooketLibraryModel(
    modelSource["source"], modelSource["build"],
  );
  if (!model) return failed;
  // Never call methods inherited by an untrusted browser result array.
  // Its dense own slots were checked above, but its prototype need not be
  // the ordinary Array.prototype during adversarial local port tests.
  const equal = (expected: typeof model.allSets) => {
    if (expected.length !== items.length) return false;
    for (const set of expected) {
      let matches = 0;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (record(item) && ownDataField(item, "id") === set.id &&
            ownDataField(item, "title") === set.title) matches++;
      }
      if (matches !== 1) return false;
    }
    return true;
  };
  return equal(model.allSets) && equal(model.displayedSets) ? observed : failed;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value);
}
