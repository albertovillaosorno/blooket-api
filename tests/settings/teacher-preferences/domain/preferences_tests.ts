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
    assert.equal(decoded.schemaVersion, 3);
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
