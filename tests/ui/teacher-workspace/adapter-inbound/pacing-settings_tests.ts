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
//   - Local teacher publication pacing settings unit conversion checks.
// - Must-Not:
//   - Contact Blooket or modify real service settings.
// - Allows:
//   - Inputs: Synthetic policy values and field strings.
//   - Outputs: Strict UI-to-canonical and canonical-to-UI assertions.
//   - Side effects: None.
// - Split-When:
//   - Independent desktop settings need different unit conventions.
// - Merge-When:
//   - No settings form accepts publication pacing controls.
// - Summary:
//   - Refuses coercion, missing fields, and out-of-bounds values.
// - Description:
//   - Milliseconds and minutes have exact, bounded conversions.
// - Usage:
//   - Run with repository Node tests and local service tests.
// - Defaults:
//   - Unknown fields cannot be silently substituted with defaults.
//
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { publicationFormValues, readPublicationFormValues } from
  "../../../../src/ui/teacher-workspace/adapter-inbound/pacing-settings.js";

const defaultPolicy = {
  minimumStartIntervalMs: 2_000,
  maximumStartsPerMinute: 20,
  maximumTaskStarts: 10_000,
  maximumTaskDurationMs: 86_400_000,
};

test("publication settings form retains all four canonical units", () => {
  const form = publicationFormValues(defaultPolicy);
  assert.deepEqual(form, {
    publicationMinIntervalSeconds: "2",
    publicationStartsPerMinute: "20",
    publicationTaskStarts: "10000",
    publicationTaskDurationMinutes: "1440",
  });
  const decoded = readPublicationFormValues(name => form[name]);
  assert.deepEqual(decoded, defaultPolicy);
  const strict = {
    minimumStartIntervalMs: 4_000, maximumStartsPerMinute: 2,
    maximumTaskStarts: 6, maximumTaskDurationMs: 180_000,
  };
  const strictForm = publicationFormValues(strict);
  assert.deepEqual(readPublicationFormValues(name => strictForm[name]), strict);
});

test("publication fields never coerce empty, fractional or oversized inputs",
  () => {
  const current = publicationFormValues(defaultPolicy);
  for (const name of Object.keys(current)) {
    for (const invalid of ["", " 2", "2 ", "+2", "1.5", "NaN", "1e3",
      "-1", "0", "1000000000", "20x", "2\\n", "002", null, 2]) {
      const injected = { ...current, [name]: invalid };
      assert.throws(() => readPublicationFormValues(key => injected[key]),
        /publication-settings-invalid/u);
    }
    assert.throws(() => publicationFormValues({
      ...defaultPolicy,
      [name === "publicationTaskDurationMinutes"
        ? "maximumTaskDurationMs"
        : name === "publicationMinIntervalSeconds"
          ? "minimumStartIntervalMs"
          : name === "publicationTaskStarts"
            ? "maximumTaskStarts" : "maximumStartsPerMinute"]: NaN,
    }), /publication-settings-invalid/u);
  }
  assert.throws(() => publicationFormValues({ ...defaultPolicy,
    minimumStartIntervalMs: 2_500 }), /publication-settings-invalid/u);
  assert.throws(() => readPublicationFormValues(() => "60"),
    /publication-settings-invalid/u);
});

test("every publication field is represented once in the local settings page",
  async () => {
  const html = await readFile(new URL(
    "../../../../src/ui/teacher-workspace/adapter-inbound/index.html",
    import.meta.url,
  ), "utf8");
  const app = await readFile(new URL(
    "../../../../src/ui/teacher-workspace/adapter-inbound/app.js",
    import.meta.url,
  ), "utf8");
  const names = Object.keys(publicationFormValues(defaultPolicy));
  for (const name of names) {
    assert.equal(html.split('name="' + name + '"').length, 2, name);
  }
  assert.match(app, /publicationFormValues\(settings\.publication\)/u);
  assert.match(app, /preferences\.publication = readPublicationFormValues/u);
  assert.match(html, /data-i18n="publicationRestartHelp"/u);
});
