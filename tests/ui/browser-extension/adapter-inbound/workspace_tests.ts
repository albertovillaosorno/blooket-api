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
    browserBridge: { application: "blooket-api", schemaVersion: 1, token },
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
test("workspace recovers after localhost refused the first connection",
  async () => {
  let tick: (() => void) | undefined;
  let attempts = 0;
  const messages: unknown[] = [];
  const freshToken = "b".repeat(43);
  const globals = {
    location: { protocol: "http:", pathname: "/", hostname: "127.0.0.1",
      origin: "http://127.0.0.1:2607" },
    chrome: { runtime: { sendMessage: async (message: unknown) => {
      messages.push(message);
      return { ok: true };
    } } },
    fetch: async (route: string, options: RequestInit) => {
      assert.equal(route, "/api/bootstrap");
      assert.equal(options.credentials, "omit");
      attempts++;
      if (attempts === 1) throw Error("ECONNREFUSED");
      return Response.json({ browserBridge: {
        application: "blooket-api", schemaVersion: 1, token: freshToken,
      } });
    },
    AbortSignal, TextDecoder,
    setInterval: (callback: () => void) => { tick = callback; return 1; },
  };
  runInNewContext(source, globals);
  await pause(0);
  assert.equal(attempts, 1);
  assert.equal(messages.length, 0);
  assert.ok(tick);
  tick();
  await pause(0);
  assert.equal(attempts, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{
    kind: "workspace-ready", origin: "http://127.0.0.1:2607",
    token: freshToken,
  }]);
});

test("workspace advertises a new service token after restart", async () => {
  let poll: (() => void) | undefined;
  const messages: unknown[] = [];
  let requests = 0;
  const globals = {
    location: { protocol: "http:", pathname: "/", hostname: "127.0.0.1",
      origin: "http://127.0.0.1:2607" },
    chrome: { runtime: { sendMessage: async (value: unknown) => {
      messages.push(value); return { ok: true };
    } } },
    fetch: async () => {
      requests++;
      if (requests === 2) return new Response(null, { status: 503 });
      return Response.json({ browserBridge: {
        application: "blooket-api", schemaVersion: 1,
        token: requests === 1 ? "a".repeat(43) : "b".repeat(43),
      } });
    },
    AbortSignal, TextDecoder,
    setInterval: (callback: () => void) => { poll = callback; return 1; },
  };
  runInNewContext(source, globals);
  await pause(0);
  assert.ok(poll);
  poll();
  await pause(0);
  poll();
  await pause(0);
  assert.equal(requests, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { kind: "workspace-ready", origin: "http://127.0.0.1:2607",
      token: "a".repeat(43) },
    { kind: "workspace-ready", origin: "http://127.0.0.1:2607",
      token: "b".repeat(43) },
  ]);
});

test("workspace retries never overlap an unfinished bridge bootstrap",
  async () => {
  let tick: (() => void) | undefined;
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let attempts = 0;
  const messages: unknown[] = [];
  const globals = {
    location: { protocol: "http:", pathname: "/", hostname: "127.0.0.1",
      origin: "http://127.0.0.1:2607" },
    chrome: { runtime: { sendMessage: async (value: unknown) => {
      messages.push(value);
      return { ok: true };
    } } },
    fetch: async () => { attempts++; return await pending; },
    AbortSignal, TextDecoder,
    setInterval: (callback: () => void) => { tick = callback; return 1; },
  };
  runInNewContext(source, globals);
  assert.ok(tick);
  tick();
  tick();
  assert.equal(attempts, 1);
  release(Response.json({ browserBridge: {
    application: "blooket-api", schemaVersion: 1,
    token: "c".repeat(43),
  } }));
  await pause(0);
  assert.equal(messages.length, 1);
  tick();
  await pause(0);
  assert.equal(attempts, 2);
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
    {browserBridge: {application:"blooket-api",schemaVersion:2,token}},
    {browserBridge: {application:"blooket-api",schemaVersion:1,token:"bad"}},
    "{invalid", "x".repeat(1_000_001),
  ]) assert.equal((await fixture(body)).messages.length, 0);
});

