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
//   - Canonical read admission and transport regression coverage.
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
//   - Canonical read admission and transport regression coverage.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startBrowserService } from
  "../../../../src/api/browser-service/adapter-inbound/server.ts";
import { createBlooketBrowserBridgeBroker } from
  "../../../../src/platforms/blooket-browser/adapter-outbound/broker.ts";
import { executeLocalBlooketRead } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/command.ts";
import { executeJsonCommand } from
  "../../../../src/cli/json-command-process/adapter-inbound/execute.ts";
import {
  callTeacherTool,
  listTeacherTools,
} from "../../../../src/mcp/teacher-tools/adapter-inbound/tools.ts";
import { decodeResultEnvelope } from
  "../../../../src/ir/wire-envelopes/contract/result-envelope.ts";

const command = {
  version: 1 as const,
  operationId: "cli:local-read",
  command: "blooket.sets.list",
  payload: {},
};

test("local reads and MCP traverse the real CLI and service bridge",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "canonical-browser-read-"));
  const bridge = createBlooketBrowserBridgeBroker();
  const instance = randomUUID();
  const service = await startBrowserService({
    root,
    port: 0,
    instance,
    browserBridge: bridge,
  });
  const poll = setInterval(() => {
    const job = bridge.next(bridge.pairingToken());
    if (!job) return;
    const value =
      job.command.kind === "session.observe"
        ? "my-sets"
        : job.command.kind === "sets.get"
          ? {
              schemaVersion: 1,
              id: job.command.setId,
              title: "Synthetic quiz",
              description: "Synthetic fixture",
              visibility: "private",
            }
          : [{ schemaVersion: 1, id: "fixture", title: "Synthetic quiz" }];
    assert.ok(
      bridge.complete(bridge.pairingToken(), {
        schemaVersion: 1,
        id: job.id,
        ok: true,
        value,
      }),
    );
  }, 5);
  try {
    await writeFile(
      join(root, "service-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        instance,
        origin: service.origin,
      }),
    );
    const direct = await executeLocalBlooketRead(command, root);
    assert.equal(direct.ok, true);
    const cli = await executeJsonCommand(
      command.command,
      command.payload,
      command.operationId,
      root,
    );
    assert.deepEqual(cli, direct);
    const mcp = await callTeacherTool("blooket_sets_list", {}, root);
    assert.equal(mcp.isError, false);
    const result = decodeResultEnvelope(JSON.parse(mcp.content[0]!.text));
    assert.equal(result.ok, true);
    if (result.ok && result.value.ok && direct.ok)
      assert.deepEqual(result.value.value, direct.value);
    const detail = await callTeacherTool(
      "blooket_sets_get",
      { setId: "fixture" },
      root,
    );
    assert.equal(detail.isError, false);
    assert.equal(
      listTeacherTools().filter((tool) => tool.name.startsWith("blooket_"))
        .length,
      3,
    );
    assert.equal(JSON.stringify(mcp).includes(bridge.pairingToken()), false);
  } finally {
    clearInterval(poll);
    bridge.close();
    service.server.close();
    service.server.closeAllConnections();
    await rm(root, { recursive: true, force: true });
  }
});

test("local read discovery rejects stale and non-loopback runtimes",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "read-offline-"));
  try {
    const offline = await executeLocalBlooketRead(command, root);
    assert.equal(offline.ok, false);
    await writeFile(
      join(root, "service-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        instance: randomUUID(),
        origin: "https://example.invalid",
      }),
    );
    assert.deepEqual(await executeLocalBlooketRead(command, root), offline);
    const invalid = await executeLocalBlooketRead(
      { ...command, payload: { password: "not-admitted" } },
      root,
    );
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.issues[0]?.code, "unknown-field");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
