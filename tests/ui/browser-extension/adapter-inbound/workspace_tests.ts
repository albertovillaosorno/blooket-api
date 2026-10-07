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
//   - Admission checks for automatic local workspace announcements.
// - Must-Not:
//   - Contact a real service or expose connection tokens to page scripts.
// - Allows:
//   - Inputs: Synthetic page origins, bootstrap replies, and runtime messages.
//   - Outputs: Assertions on bounded private transport messages.
//   - Side effects: One isolated VM and short fixture timers.
// - Split-When:
//   - Another browser host needs different content-script semantics.
// - Merge-When:
//   - Workspace discovery no longer uses an isolated page relay.
// - Summary:
//   - Verifies discovery never forwards ordinary configuration or credentials.
// - Description:
//   - Only a valid local application capsule may activate the worker.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Foreign pages and malformed or oversized bootstraps are ignored.
//
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { setTimeout as pause } from "node:timers/promises";

const source = await readFile(new URL(
  "../../../../src/ui/browser-extension/adapter-inbound/workspace.js",
  import.meta.url,
), "utf8");
const token = "a".repeat(43);
async function fixture(body, page = "http://127.0.0.1:4567/") {
  const url = new URL(page);
  const messages = [];
  let fetches = 0;
  const globals = {
    location: { protocol: url.protocol, pathname: url.pathname,
      hostname: url.hostname, origin: url.origin },
    chrome: { runtime: { sendMessage: async (value) => {
      messages.push(value); return { ok: true };
    } } },
    fetch: async (route, options) => {
      fetches++;
      assert.equal(route, "/api/bootstrap");
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      return typeof body === "string"
        ? new Response(body) : Response.json(body);
    },
    AbortSignal, TextDecoder, setInterval: () => 1,
  };
  runInNewContext(source, globals);
  await pause(10);
  return { messages, fetches };
}
test("automatic workspace relay forwards only its private capability",
  async () => {
  const result = await fixture({
    browserBridge: { application: "blooket-studio", schemaVersion: 1, token },
    preferences: { email: "synthetic-private@example.invalid" },
    csrf: "synthetic-local-csrf",
  });
  assert.equal(result.fetches, 1);
  assert.equal(result.messages.length, 1);
  const message = JSON.parse(JSON.stringify(result.messages[0]));
  assert.deepEqual(message, {
    kind: "workspace-ready", origin: "http://127.0.0.1:4567", token,
  });
  assert.equal(JSON.stringify(message).includes("email"), false);
  assert.equal(JSON.stringify(message).includes("csrf"), false);
});
test("automatic workspace relay ignores unrelated origins and bootstraps",
  async () => {
  for (const page of [
    "https://evil.invalid/", "http://127.0.0.1:4567/api/bootstrap",
    "http://localhost:4567/", "https://127.0.0.1:4567/",
  ]) {
    const result = await fixture({}, page);
    assert.equal(result.fetches, 0);
    assert.equal(result.messages.length, 0);
  }
  for (const body of [
    {}, {browserBridge: {application:"another-app",schemaVersion:1,token}},
    {browserBridge: {application:"blooket-studio",schemaVersion:2,token}},
    {browserBridge: {application:"blooket-studio",schemaVersion:1,token:"bad"}},
    "{invalid", "x".repeat(1_000_001),
  ]) assert.equal((await fixture(body)).messages.length, 0);
});

