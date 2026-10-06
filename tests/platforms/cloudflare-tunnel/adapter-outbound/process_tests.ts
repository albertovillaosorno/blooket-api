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
//   - Synthetic connector failure and process cleanup regression tests.
// - Must-Not:
//   - Put credentials in argv or forward raw connector logs.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Synthetic connector failure and process cleanup regression tests.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startCloudflareTunnel } from
  "../../../../src/platforms/cloudflare-tunnel/adapter-outbound/process.ts";

test("missing connector retains its useful failure after close", async () => {
  const root = await mkdtemp(join(tmpdir(), "connector-missing-"));
  const states: string[] = [];
  try {
    let observed!: () => void;
    const failure = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const tunnel = startCloudflareTunnel(
      "synthetic-token",
      (state) => {
        states.push(state);
        if (state === "cloudflared-unavailable") observed();
      },
      join(root, "absent"),
    );
    await failure;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(states.at(-1), "cloudflared-unavailable");
    await tunnel.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("connector stop waits for a resistant child & excludes token argv",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "connector-stop-"));
  const fixture = join(root, "connector.cjs");
  const receipt = join(root, "receipt.json");
  const states: string[] = [];
  await writeFile(
    fixture,
    "#!/usr/bin/env node\n" +
      'const {writeFileSync}=require("node:fs");\n' +
      'process.on("SIGTERM",()=>{});\n' +
      "writeFileSync(" +
      JSON.stringify(receipt) +
      ",JSON.stringify({" +
      "pid:process.pid,hasToken:process.env.TUNNEL_TOKEN===" +
      '"synthetic-token",tokenInArgs:process.argv.includes("synthetic-token")' +
      "}));\n" +
      'process.stderr.write("Registered tunnel connection\\n");\n' +
      "setInterval(()=>{},1000);\n",
    { mode: 0o755 },
  );
  let observed!: () => void;
  const connected = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const tunnel = startCloudflareTunnel(
    "synthetic-token",
    (state) => {
      states.push(state);
      if (state === "connected") observed();
    },
    fixture,
  );
  try {
    await connected;
    const record = JSON.parse(await readFile(receipt, "utf8"));
    assert.equal(record.hasToken, true);
    assert.equal(record.tokenInArgs, false);
    await tunnel.stop();
    assert.throws(() => process.kill(record.pid, 0), { code: "ESRCH" });
    assert.equal(states.at(-1), "connected");
  } finally {
    await tunnel.stop();
    await rm(root, { recursive: true, force: true });
  }
});
