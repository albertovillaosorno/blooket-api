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
//   - Browser-opening environment minimization regression coverage.
// - Must-Not:
//   - Launch a real browser or expose development credentials.
// - Allows:
//   - Inputs: Synthetic process environments.
//   - Outputs: An allowlisted host-session environment.
//   - Side effects: None.
// - Split-When:
//   - Browser launch policy needs another platform-specific contract.
// - Merge-When:
//   - Browser opening no longer owns a child-process boundary.
// - Summary:
//   - Keeps browser launching from inheriting application credentials.
// - Description:
//   - Preserves only host values needed by ordinary graphical launchers.
// - Usage:
//   - Validate environment filtering independently from native browser opening.
// - Defaults:
//   - Unlisted environment variables are excluded.
//
import assert from "node:assert/strict";
import test from "node:test";
import { browserOpeningEnvironment } from
  "../../../../src/platforms/browser-opening/adapter-outbound/open.ts";

test("browser opening excludes application and tunnel credentials", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/fixture",
    DISPLAY: ":1",
    XDG_ACTIVATION_TOKEN: "synthetic-activation",
    DESKTOP_STARTUP_ID: "synthetic-startup",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/fixture",
    BLOOKET_PASSWORD: "do-not-forward",
    CLOUDFLARE_TUNNEL_TOKEN: "do-not-forward",
    MCP_OWNER_PASSWORD: "do-not-forward",
    RANDOM_APPLICATION_SECRET: "do-not-forward",
  };
  assert.deepEqual(browserOpeningEnvironment(source), {
    PATH: "/usr/bin",
    HOME: "/home/fixture",
    DISPLAY: ":1",
    XDG_ACTIVATION_TOKEN: "synthetic-activation",
    DESKTOP_STARTUP_ID: "synthetic-startup",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/fixture",
  });
});
