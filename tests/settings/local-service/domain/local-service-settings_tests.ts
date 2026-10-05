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
//   - Behavioral tests for local service settings validation.
// - Must-Not:
//   - Bind sockets or test desktop lifecycle adapters.
// - Allows:
//   - Inputs: Fixed safe and unsafe settings fixtures.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: None.
// - Split-When:
//   - Startup and network settings gain independent schemas.
// - Merge-When:
//   - Local service settings cease to exist.
// - Summary:
//   - Verifies defaults, loopback safety, and port policy.
// - Description:
//   - Mirrors src/settings/local-service/domain/local-service-settings.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - 127.0.0.1:2607 is the fixed-port default.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeLocalServiceSettings,
  defaultLocalServiceSettings,
  isLoopbackAddress,
} from
  "../../../../src/settings/local-service/domain/local-service-settings.ts";

const defaults = defaultLocalServiceSettings();

test("local service defaults to loopback port 2607", () => {
  assert.deepEqual(defaults, {
    schemaVersion: 2,
    bindAddress: "127.0.0.1",
    port: 2607,
    portMode: "fixed",
    launchAtLogin: false,
    startMinimized: false,
    startServiceOnLaunch: true,
    theme: "system",
  });
});

test("settings accept automatic mode while persisting a concrete port", () => {
  const result = decodeLocalServiceSettings({
    ...defaults,
    port: 43127,
    portMode: "automatic",
  });

  assert.equal(result.ok, true);
});

test("settings reject public wildcard bind addresses", () => {
  const result = decodeLocalServiceSettings({
    ...defaults,
    bindAddress: "0.0.0.0",
  });

  assert.equal(result.ok, false);
});

test("settings accept IPv4 loopback range and IPv6 loopback", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("127.12.34.56"), true);
  assert.equal(isLoopbackAddress("::1"), true);
});

test("settings reject invalid and non-loopback addresses", () => {
  assert.equal(isLoopbackAddress("localhost"), false);
  assert.equal(isLoopbackAddress("127.0.0.999"), false);
  assert.equal(isLoopbackAddress("192.168.1.20"), false);
});

test("settings reject port zero and values beyond TCP range", () => {
  assert.equal(decodeLocalServiceSettings({ ...defaults, port: 0 }).ok, false);
  assert.equal(
    decodeLocalServiceSettings({ ...defaults, port: 65536 }).ok,
    false,
  );
});


test("version-one settings migrate to the current system theme", () => {
  const legacy = {
    schemaVersion: 1,
    bindAddress: "127.0.0.1",
    port: 2607,
    portMode: "fixed",
    launchAtLogin: false,
    startMinimized: false,
    startServiceOnLaunch: true,
  };
  const result = decodeLocalServiceSettings(legacy);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.schemaVersion, 2);
    assert.equal(result.value.theme, "system");
  }
});

test("version-two settings validate explicit theme preferences", () => {
  assert.equal(
    decodeLocalServiceSettings({ ...defaults, theme: "dark" }).ok,
    true,
  );
  assert.equal(
    decodeLocalServiceSettings({ ...defaults, theme: "neon" }).ok,
    false,
  );
});
