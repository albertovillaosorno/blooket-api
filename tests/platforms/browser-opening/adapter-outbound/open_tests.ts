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
import { browserOpeningEnvironment, browserLaunchCommand } from
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

// Opening Firefox explicitly must never interpret an environment value as a
// command, executable path, URL, or injected flag.
test("Firefox preference does not alter Linux's default browser", () => {
  const target = "http://127.0.0.1:2607/";
  assert.deepEqual(browserLaunchCommand("linux", undefined, target), {
    executable: "/usr/bin/xdg-open", args: [target],
  });
  assert.deepEqual(browserLaunchCommand("linux", "firefox", target), {
    executable: "/usr/bin/firefox", args: [target],
  });
  assert.deepEqual(browserLaunchCommand("darwin", "firefox", target), {
    executable: "/usr/bin/open", args: ["-a", "Firefox", target],
  });
  assert.deepEqual(browserLaunchCommand("darwin", "default", target), {
    executable: "/usr/bin/open", args: [target],
  });
  for (const value of ["", " FIREFOX", "firefox --private-window",
    "../firefox", "/usr/bin/firefox", "chrome", "firefox\n--profile", "0"])
    assert.throws(() => browserLaunchCommand("linux", value, target),
      /browser-opening-unsupported-preference/u);
  assert.throws(() => browserLaunchCommand("win32", "firefox", target),
    /browser-opening-unsupported/u);
});
