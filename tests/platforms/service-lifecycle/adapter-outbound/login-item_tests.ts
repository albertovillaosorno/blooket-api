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
//   - Portable native login-control admission regression coverage.
// - Must-Not:
//   - Expose configuration through the online MCP gateway.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Portable native login-control admission regression coverage.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile, realpath } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createPackagedLoginItemControl } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/login-item.ts";

async function fixture(work: (root: string, node: string, app: string) =>
  Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "login-control-")));
  const contents = join(root, "Blooket API.app/Contents");
  const node = join(contents, "Resources/runtime/node");
  const app = join(contents, "MacOS/Blooket API");
  await mkdir(dirname(node), { recursive: true });
  await mkdir(dirname(app), { recursive: true });
  await writeFile(node, "synthetic runtime");
  await writeFile(app, "synthetic native executable");
  try { await work(root, node, app); }
  finally { await rm(root, { recursive: true, force: true }); }
}
test("native login control admits only the owned app and exact commands",
  async () => { await fixture(async (_root, node, app) => {
    const calls: string[][] = [];
    const control = createPackagedLoginItemControl({
      platform: "darwin", executable: node,
      execute: async (file, args) => {
        calls.push([file, ...args]);
        return { stdout: JSON.stringify({ schemaVersion: 1,
          state: args[0] === "--login-enable" ? "requires-approval"
            : "not-registered" }) };
      },
    });
    assert.equal((await control.inspect()).state, "not-registered");
    assert.equal((await control.setEnabled(true)).state, "requires-approval");
    assert.equal((await control.setEnabled(false)).state, "not-registered");
    assert.deepEqual(calls, [[app, "--login-status"], [app, "--login-enable"],
      [app, "--login-disable"]]);
  }); });

test("foreign runtimes and symbolic launchers stop before process execution",
  async () => { await fixture(async (root, node, app) => {
    let calls = 0;
    const execute = async () => { calls++;
      return { stdout: '{"schemaVersion":1,"state":"enabled"}' }; };
    const foreign = createPackagedLoginItemControl({
      platform: "darwin", executable: join(root, "node"), execute,
    });
    assert.equal((await foreign.inspect()).state, "unavailable");
    await rm(app);
    await symlink(node, app);
    const symbolic = createPackagedLoginItemControl({
      platform: "darwin", executable: node, execute,
    });
    assert.equal((await symbolic.inspect()).state, "unavailable");
    assert.equal(calls, 0);
  }); });

test("Linux remains an explicit stub and malformed native results fail closed",
  async () => { await fixture(async (_root, node) => {
    let calls = 0;
    const execute = async () => { calls++;
      return { stdout: '{"schemaVersion":1,"state":"enabled","secret":1}' };
    };
    const linux = createPackagedLoginItemControl({
      platform: "linux", execute,
    });
    assert.equal((await linux.inspect()).state, "unsupported");
    assert.equal((await linux.setEnabled(true)).state, "unsupported");
    assert.equal(calls, 0);
    const invalid = createPackagedLoginItemControl({
      platform: "darwin", executable: node, execute,
    });
    assert.equal((await invalid.inspect()).state, "unavailable");
    await assert.rejects(invalid.setEnabled(true));
    assert.equal(calls, 2);
  }); });
