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
//   - Ordinary teacher settings and explicit legacy migrations.
// - Must-Not:
//   - Store secrets or individual image adjustments.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Ordinary teacher settings and explicit legacy migrations.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultTeacherPreferences,
  decodeTeacherPreferences,
  defaultPublicationPreferences,
} from "../../../../src/settings/teacher-preferences/domain/preferences.ts";
import { defaultLocalServiceSettings } from
  "../../../../src/settings/local-service/domain/local-service-settings.ts";

test(
  "legacy preferences migrate without adding " + "per-image adjustments",
  () => {
    const decoded = decodeTeacherPreferences(
      defaultLocalServiceSettings(),
      "/tmp/media",
    );
    assert.equal(decoded.schemaVersion, 4);
    assert.equal(decoded.defaults.gifFps, 10);
    assert.equal(decoded.service.port, 2607);
    assert.equal("zoom" in decoded.defaults, false);
  },
);
test(
  "settings reject secrets, remote URLs, coercion and " +
    "per-image transforms",
  () => {
    const defaults = defaultTeacherPreferences("/tmp/media");
    assert.deepEqual(
      decodeTeacherPreferences(defaults, "/tmp/media"),
      defaults,
    );
    for (const value of [
      { ...defaults, password: "secret" },
      { ...defaults, locale: ["es"] },
      { ...defaults, mediaRoot: "../elsewhere" },
      { ...defaults, defaults: { ...defaults.defaults, gifFps: "10" } },
      {
        ...defaults,
        defaults: { ...defaults.defaults, compression: ["compact"] },
      },
      { ...defaults, defaults: { ...defaults.defaults, saturation: 2 } },
      {
        ...defaults,
        online: {
          ...defaults.online,
          enabled: true,
          publicUrl: "http://example.com/mcp",
        },
      },
      {
        ...defaults,
        online: {
          ...defaults.online,
          enabled: true,
          publicUrl: "https://example.com/api",
        },
      },
    ])
      assert.throws(() => decodeTeacherPreferences(value, "/tmp/media"));
  },
);

test("MCP URLs require an exact credential-free HTTPS resource", () => {
  const defaults = defaultTeacherPreferences("/tmp/media");
  for (const publicUrl of [
    "example.test",
    "https://example.test",
    "http://example.test/mcp",
    "https://user:pass@example.test/mcp",
    "https://example.test/mcp/",
    "https://example.test/mcp?token=x",
    "https://example.test/mcp#x",
    "https://example.test/other",
    "javascript:alert(1)",
  ])
    assert.throws(() =>
      decodeTeacherPreferences(
        {
          ...defaults,
          online: { ...defaults.online, enabled: true, publicUrl },
        },
        "/tmp/media",
      ),
    );
  assert.equal(
    decodeTeacherPreferences(
      {
        ...defaults,
        online: {
          ...defaults.online,
          enabled: true,
          publicUrl: "https://example.test/mcp",
        },
      },
      "/tmp/media",
    ).online.enabled,
    true,
  );
});


test("version-three preferences migrate publication limits conservatively",
  () => {
  const current = defaultTeacherPreferences("/tmp/media");
  const { publication: _ignored, ...legacy } = current;
  const migrated = decodeTeacherPreferences({ ...legacy, schemaVersion: 3 },
    "/tmp/media");
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.publication, defaultPublicationPreferences());
  assert.equal(migrated.service.port, current.service.port);
  assert.equal(migrated.locale, current.locale);
  assert.throws(() => decodeTeacherPreferences({ ...legacy,
    schemaVersion: 3, publication: current.publication }, "/tmp/media"));
});

test("version-four publication settings reject unsafe limits and additions",
  () => {
  const defaults = defaultTeacherPreferences("/tmp/media");
  const base = defaults.publication;
  const invalid = [
    { ...base, minimumStartIntervalMs: 1_999 },
    { ...base, minimumStartIntervalMs: 60_001 },
    { ...base, minimumStartIntervalMs: 2_001.5 },
    { ...base, minimumStartIntervalMs: 2_001 },
    { ...base, maximumStartsPerMinute: 0 },
    { ...base, maximumStartsPerMinute: 21 },
    { ...base, maximumTaskStarts: 0 },
    { ...base, maximumTaskStarts: 10_001 },
    { ...base, maximumTaskDurationMs: 999 },
    { ...base, maximumTaskDurationMs: 61_000 },
    { ...base, maximumTaskDurationMs: 86_400_001 },
    { ...base, maximumTaskStarts: "20" },
    { ...base, unexpected: true },
  ];
  for (const publication of invalid)
    assert.throws(() => decodeTeacherPreferences({
      ...defaults, publication,
    }, "/tmp/media"));
  const stricter = {
    minimumStartIntervalMs: 10_000,
    maximumStartsPerMinute: 3,
    maximumTaskStarts: 2,
    maximumTaskDurationMs: 600_000,
  };
  assert.deepEqual(decodeTeacherPreferences({
    ...defaults, publication: stricter,
  }, "/tmp/media").publication, stricter);
});


test("publication decoder does not evaluate accessor-controlled policy fields",
  () => {
  const defaults = defaultTeacherPreferences("/tmp/media");
  for (const field of Object.keys(defaults.publication)) {
    let accessed = 0;
    const policy = { ...defaults.publication };
    Object.defineProperty(policy, field, {
      configurable: true, enumerable: true,
      get() { accessed++; throw Error("synthetic untrusted getter"); },
    });
    assert.throws(() => decodeTeacherPreferences({
      ...defaults, publication: policy,
    }, "/tmp/media"));
    assert.equal(accessed, 0, field);
  }
});

test("publication rejects symbol and inherited policy keys", () => {
  const defaults = defaultTeacherPreferences("/tmp/media");
  const symbol = Symbol("fixture-extra");
  const policy = { ...defaults.publication,
    [symbol]: "synthetic-hidden-policy" };
  assert.throws(() => decodeTeacherPreferences({
    ...defaults, publication: policy,
  }, "/tmp/media"));
  const inherited = Object.create({ maximumTaskStarts: 2 });
  Object.assign(inherited, {
    minimumStartIntervalMs: 2_000,
    maximumStartsPerMinute: 20,
    maximumTaskDurationMs: 86_400_000,
  });
  assert.throws(() => decodeTeacherPreferences({
    ...defaults, publication: inherited,
  }, "/tmp/media"));
});
