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
  isExactDenseArray, ownDataField,
} from "../../../ir/runtime-decoding/domain/exact-object.ts";

export function checkBlooketLibraryObservation(
  observed: unknown,
  captured: unknown,
): unknown {
  if (!record(observed) || ownDataField(observed, "ok") !== true ||
      !record(ownDataField(observed, "value"))) return observed;
  const observation = ownDataField(observed, "value");
  if (!record(observation)) return observed;
  const items = ownDataField(observation, "items");
  if (!isExactDenseArray(items) || items.length > 200)
    return { ok: false, code: "blooket-browser-failed" };
  if (captured === null) return observed;
  const failed = { ok: false, code: "blooket-browser-failed" };
  if (!record(captured) || !exactKeys(captured, ["build", "source"]) ||
      typeof captured["build"] !== "string" ||
      typeof captured["source"] !== "string") return failed;
  if (captured["build"] !== BLOOKET_LIBRARY_MODEL_BUILD) return observed;
  const model = decodeBlooketLibraryModel(
    captured["source"], captured["build"],
  );
  if (!model) return failed;
  const equal = (expected: typeof model.allSets) =>
    expected.length === items.length && expected.every(set =>
      items.filter(item => record(item) &&
        ownDataField(item, "id") === set.id &&
        ownDataField(item, "title") === set.title).length === 1,
    );
  return equal(model.allSets) && equal(model.displayedSets) ? observed : failed;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== "string" || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && "value" in descriptor && descriptor.enumerable;
  });
}
