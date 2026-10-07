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
//   - Native ARM64 Safari smoke acceptance for an assembled Mac archive.
// - Must-Not:
//   - Use production data, Blooket credentials, or mutate a remote account.
// - Allows:
//   - Inputs: The current darwin-arm64 distribution and system Safari.
//   - Outputs: A passing native browser/system smoke result or process failure.
//   - Side effects: Temporary app extraction, local service, Safari automation.
// - Split-When:
//   - Another native platform needs independent browser automation.
// - Merge-When:
//   - Native distribution verification directly owns Safari WebDriver.
// - Summary:
//   - Exercises the delivered app UI in Safari on the ARM64 CI host.
// - Description:
//   - Uses Safari's W3C WebDriver API without a third-party browser
//     dependency.
// - Usage:
//   - Run only on a macOS ARM64 GitHub runner after package assembly.
// - Defaults:
//   - Wrong architecture, stale package, UI overflow, or WebDriver failure
//     stops.
//
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const zip = join(repo, ".temp/distributions/darwin-arm64.zip");
const root = await mkdtemp(join(repo, ".temp/macos-safari-smoke-"));
const data = join(root, "data");
const app = join(root, "Blooket Studio.app");
const launcher = join(app, "Contents/MacOS/Blooket Studio");
const driverPort = 4444;
const driverOrigin = "http://127.0.0.1:" + String(driverPort);
const env = {
  PATH: process.env["PATH"],
  HOME: process.env["HOME"],
  BLOOKET_DATA_HOME: data,
};

let driver: ChildProcess | undefined;
let sessionId: string | undefined;
let serviceStarted = false;

try {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const { stdout: machine } = await execute("uname", ["-m"]);
  assert.equal(machine.trim(), "arm64");

  await execute("unzip", ["-q", zip, "-d", root]);
  const { stdout: originText } = await execute(launcher, ["--no-open"], {
    env,
    timeout: 40_000,
    maxBuffer: 1_000_000,
  });
  serviceStarted = true;
  const origin = originText.trim();
  assert.match(origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/u);

  driver = spawn("/usr/bin/safaridriver", ["-p", String(driverPort)], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForDriver();

  const created = await webdriver("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "safari" } },
  });
  assert.ok(created && typeof created === "object");
  const createdRecord = created as Record<string, unknown>;
  sessionId =
    typeof createdRecord["sessionId"] === "string"
      ? createdRecord["sessionId"]
      : undefined;
  assert.ok(sessionId);

  await webdriver("POST", "/session/" + sessionId + "/url", { url: origin });
  await waitForWorkspace(sessionId);

  const desktop = await evaluate(sessionId, [
    "return {",
    "title: document.title,",
    "ready: document.readyState,",
    "width: document.documentElement.scrollWidth,",
    "clientWidth: document.documentElement.clientWidth,",
    "untranslated: Array.from(document.querySelectorAll('[data-i18n]'))",
    ".filter((node) => !node.textContent.trim()).length,",
    "libraryVisible: !document.querySelector('#library').hidden,",
    "settingsVisible: !document.querySelector('#settings').hidden,",
    "diagnostics: document.querySelector('#diagnostics').textContent.trim()",
    ".length,",
    "};",
  ].join("\n"));
  assert.equal(desktop["title"], "Blooket Studio");
  assert.equal(desktop["ready"], "complete");
  assert.equal(desktop["untranslated"], 0);
  assert.equal(desktop["libraryVisible"], true);
  assert.equal(desktop["settingsVisible"], false);
  assert.ok(Number(desktop["diagnostics"]) > 0);
  assert.ok(Number(desktop["width"]) <= Number(desktop["clientWidth"]) + 1);

  const interaction = await evaluate(sessionId, [
    "const settings = document.querySelector('[data-tab=\"settings\"]');",
    "settings.click();",
    "const theme = document.querySelector('#settingsForm [name=\"theme\"]');",
    "theme.value = 'dark';",
    "theme.dispatchEvent(new Event('change', { bubbles: true }));",
    "return {",
    "settingsVisible: !document.querySelector('#settings').hidden,",
    "theme: document.documentElement.dataset.theme,",
    "saveVisible: !!document.querySelector(",
    "'#settingsForm button[type=\"submit\"]:not([hidden])'),",
    "};",
  ].join("\n"));
  assert.deepEqual(interaction, {
    settingsVisible: true,
    theme: "dark",
    saveVisible: true,
  });

  await webdriver("POST", "/session/" + sessionId + "/window/rect", {
    width: 390,
    height: 844,
  });
  const mobile = await evaluate(sessionId, [
    "return {",
    "width: document.documentElement.scrollWidth,",
    "clientWidth: document.documentElement.clientWidth,",
    "settingsVisible: !document.querySelector('#settings').hidden,",
    "buttons: Array.from(document.querySelectorAll('nav button'))",
    ".filter((button) => button.getClientRects().length > 0).length,",
    "};",
  ].join("\n"));
  assert.equal(mobile["settingsVisible"], true);
  assert.ok(Number(mobile["buttons"]) >= 3);
  assert.ok(Number(mobile["width"]) <= Number(mobile["clientWidth"]) + 1);

  console.log("macOS ARM64 packaged Safari smoke passed.");
} finally {
  if (sessionId) {
    await fetch(driverOrigin + "/session/" + sessionId, {
      method: "DELETE",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }
  driver?.kill("SIGTERM");
  if (serviceStarted) {
    await execute(launcher, ["--stop"], {
      env,
      timeout: 20_000,
      maxBuffer: 1_000_000,
    }).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
}

async function waitForDriver(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(driverOrigin + "/status", {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // SafariDriver may need a few moments to bind its local WebDriver port.
    }
    await pause(100);
  }
  throw new Error("safaridriver-unavailable");
}

async function waitForWorkspace(id: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state: Record<string, unknown> = await evaluate(id, [
      "return {",
      "ready: document.readyState,",
      "title: document.title,",
      "diagnostics: document.querySelector('#diagnostics')?.textContent",
      "?.trim().length ?? 0,",
      "};",
    ].join("\n")).catch(() => ({}));
    if (
      state["ready"] === "complete" &&
      state["title"] === "Blooket Studio" &&
      Number(state["diagnostics"]) > 0
    )
      return;
    await pause(100);
  }
  throw new Error("safari-workspace-not-ready");
}

async function evaluate(
  id: string,
  script: string,
): Promise<Record<string, unknown>> {
  const value = await webdriver(
    "POST",
    "/session/" + id + "/execute/sync",
    { script, args: [] },
  );
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function webdriver(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(driverOrigin + path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as { value?: unknown };
  if (!response.ok)
    throw new Error("webdriver-command-failed:" + String(response.status));
  return payload.value;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
