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
//   - Bounded publication policy display and local form unit conversions.
// - Must-Not:
//   - Persist settings, contact Blooket, or schedule account writes.
// - Allows:
//   - Inputs: Validated preference values and one local form read callback.
//   - Outputs: Canonical millisecond and task-start policy values.
//   - Side effects: None.
// - Split-When:
//   - More publication policies need independent UI controls.
// - Merge-When:
//   - The settings UI no longer exposes publication pacing.
// - Summary:
//   - Converts strict teacher pacing inputs with no silent numeric coercion.
// - Description:
//   - Server settings decoding remains the final authority after submission.
// - Usage:
//   - Called only from the localhost Settings page.
// - Defaults:
//   - Blank, fractional, unknown, and out-of-bounds fields are rejected.
//
const INPUTS = Object.freeze([
  ["publicationMinIntervalSeconds", "minimumStartIntervalMs", 1_000, 2, 60],
  ["publicationStartsPerMinute", "maximumStartsPerMinute", 1, 1, 20],
  ["publicationTaskStarts", "maximumTaskStarts", 1, 1, 10_000],
  ["publicationTaskDurationMinutes", "maximumTaskDurationMs", 60_000,
    1, 1_440],
]);

export function publicationFormValues(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy))
    throw Error("publication-settings-invalid");
  const values = {};
  for (const [formName, policyName, factor, min, max] of INPUTS) {
    const raw = policy[policyName];
    if (!Number.isSafeInteger(raw) || raw < min * factor ||
        raw > max * factor || raw % factor !== 0)
      throw Error("publication-settings-invalid");
    values[formName] = String(raw / factor);
  }
  return values;
}

export function readPublicationFormValues(read) {
  if (typeof read !== "function")
    throw Error("publication-settings-invalid");
  const policy = {};
  for (const [formName, policyName, factor, min, max] of INPUTS) {
    const text = read(formName);
    if (typeof text !== "string" || !/^[1-9][0-9]*$/u.test(text))
      throw Error("publication-settings-invalid");
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number < min || number > max)
      throw Error("publication-settings-invalid");
    policy[policyName] = number * factor;
  }
  return policy;
}
