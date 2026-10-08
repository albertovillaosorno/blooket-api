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
//   - Browser broker authentication, correlation, timeout, and close tests.
// - Must-Not:
//   - Launch a browser, persist commands, or use real credentials.
// - Allows:
//   - Inputs: Synthetic commands, tokens, and extension responses.
//   - Outputs: Deterministic stable transport outcomes.
//   - Side effects: Short local timers only.
// - Split-When:
//   - Dispatch and completion gain separate broker lifecycles.
// - Merge-When:
//   - Browser jobs become in-process calls.
// - Summary:
//   - Proves one reply can resolve only its exact authenticated pending job.
// - Description:
//   - Invalid replies settle their owning request without raw error details.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - A fixed synthetic token avoids secret-store involvement.
//
import assert from "node:assert/strict";
import test from "node:test";

import { createBlooketBrowserBridgeBroker } from
  "../../../../src/platforms/blooket-browser/adapter-outbound/broker.ts";

const TOKEN = "synthetic-browser-bridge-token-32-bytes-minimum";

test("pairing reset revokes old access and settles pending jobs", async () => {
  const broker = createBlooketBrowserBridgeBroker({ token: TOKEN });
  const pending = broker.request({ kind: "sets.list" });
  const dispatched = broker.next(TOKEN);
  assert.ok(dispatched);
  assert.equal(broker.status().connected, true);
  broker.resetPairing();
  const replacement = broker.pairingToken();
  assert.notEqual(replacement, TOKEN);
  assert.equal(broker.authenticated(TOKEN), false);
  assert.equal(broker.authenticated(replacement), true);
  assert.equal(broker.status().connected, false);
  assert.equal(
    broker.complete(TOKEN, {
      schemaVersion: 1,
      id: dispatched.id,
      ok: true,
      value: [],
    }),
    false,
  );
  assert.deepEqual(await pending, {
    ok: false,
    code: "blooket-browser-unavailable",
  });
  broker.close();
  assert.equal(broker.authenticated(replacement), false);
});

test(
  "authenticated completion resolves only the dispatched request",
  async () => {
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN,
    timeoutMs: 250,
  });
  const pending = broker.request({ kind: "sets.list" });

  assert.equal(broker.authenticated("wrong-token"), false);
  assert.equal(broker.authenticated(TOKEN), true);
  assert.equal(broker.next("wrong-token"), null);
  const request = broker.next(TOKEN);
  assert.ok(request);
  assert.equal(request.command.kind, "sets.list");
  assert.equal(broker.next(TOKEN), null);

  assert.equal(
    broker.complete(TOKEN, {
      schemaVersion: 1,
      id: "another-request",
      ok: true,
      value: [],
    }),
    false,
  );
  assert.equal(
    broker.complete(TOKEN, {
      schemaVersion: 1,
      id: request.id,
      ok: true,
      value: [{ opaque: true }],
    }),
    true,
  );
  assert.deepEqual(await pending, {
    ok: true,
    value: [{ opaque: true }],
  });
  assert.equal(
    broker.complete(TOKEN, {
      schemaVersion: 1,
      id: request.id,
      ok: true,
      value: [],
    }),
    false,
  );
  broker.close();
});

test("malformed extension replies fail the owning request closed", async () => {
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN,
    timeoutMs: 250,
  });
  const pending = broker.request({ kind: "session.observe" });
  const request = broker.next(TOKEN);
  assert.ok(request);

  assert.equal(
    broker.complete(TOKEN, {
      schemaVersion: 1,
      id: request.id,
      ok: true,
      value: "dashboard",
      extra: "untrusted",
    }),
    false,
  );
  assert.deepEqual(await pending, {
    ok: false,
    code: "blooket-browser-failed",
  });
  broker.close();
});

test("timeouts and close never replay pending browser jobs", async () => {
  const timed = createBlooketBrowserBridgeBroker({
    token: TOKEN,
    timeoutMs: 20,
  });
  assert.deepEqual(await timed.request({ kind: "sets.list" }), {
    ok: false,
    code: "blooket-browser-unavailable",
  });
  assert.equal(timed.status().pending, 0);

  const closing = createBlooketBrowserBridgeBroker({
    token: TOKEN,
    timeoutMs: 250,
  });
  const pending = closing.request({
    kind: "questions.list",
    setId: "set-a",
  });
  assert.ok(closing.next(TOKEN));
  closing.close();
  assert.deepEqual(await pending, {
    ok: false,
    code: "blooket-browser-unavailable",
  });
  assert.equal(closing.next(TOKEN), null);
});

test("invalid browser commands fail before extension dispatch", async () => {
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN,
    timeoutMs: 25,
  });
  for (const invalid of [
    { kind: "session.authenticate" },
    { kind: "sets.get" },
    { kind: "sets.list", extraneous: true },
  ]) {
    assert.deepEqual(await broker.request(invalid as never), {
      ok: false,
      code: "blooket-browser-failed",
    });
    assert.equal(broker.status().pending, 0);
    assert.equal(broker.next(TOKEN), null);
  }
  broker.close();
});

test(
  "valid credential commands preserve bounded broker correlation",
  async () => {
    const broker = createBlooketBrowserBridgeBroker({ token: TOKEN });
    const command = {
      kind: "session.authenticate" as const,
      loginIdentifier: "synthetic@example.invalid",
      password: "test-only-no-account",
    };
    const pending = broker.request(command);
    const job = broker.next(TOKEN);
    assert.ok(job);
    assert.deepEqual(job.command, command);
    assert.equal(broker.complete(TOKEN, {
      schemaVersion: job.schemaVersion,
      id: job.id,
      ok: true,
      value: null,
    }), true);
    assert.deepEqual(await pending, { ok: true, value: null });
    assert.equal(broker.status().pending, 0);
    broker.close();
  },
);

test(
  "stale credential jobs fail before dispatch after a queued delay",
  async () => {
  let tick = 10_000;
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN,
    now: () => tick,
  });
  const pending = broker.request({
    kind: "session.authenticate",
    loginIdentifier: "synthetic@example.invalid",
    password: "test-only-no-account",
  });
  tick += 3_000;
  assert.equal(broker.next(TOKEN), null);
  assert.deepEqual(await pending, {
    ok: false, code: "blooket-browser-unavailable",
  });
  assert.equal(broker.status().pending, 0);
  broker.close();
  },
);

test(
  "stale authentication is skipped but a fresh read remains dispatchable",
  async () => {
  let tick = 10_000;
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN,
    now: () => tick,
  });
  const stale = broker.request({
    kind: "session.authenticate",
    loginIdentifier: "synthetic@example.invalid",
    password: "test-only-no-account",
  });
  tick += 3_000;
  const fresh = broker.request({ kind: "sets.list" });
  const job = broker.next(TOKEN);
  assert.ok(job);
  assert.equal(job.command.kind, "sets.list");
  assert.deepEqual(await stale, {
    ok: false, code: "blooket-browser-unavailable",
  });
  assert.equal(broker.complete(TOKEN, {
    schemaVersion: 1, id: job.id, ok: true,
    value: { completeness: "complete", items: [] },
  }), true);
  assert.deepEqual(await fresh, {
    ok: true, value: { completeness: "complete", items: [] },
  });
  broker.close();
  },
);

test(
  "expired jobs never dispatch despite a delayed timeout callback",
  async () => {
  let tick = 10_000;
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN,
    now: () => tick,
  });
  const pending = broker.request({ kind: "sets.list" });
  tick += 10_001;
  assert.equal(broker.next(TOKEN), null);
  assert.deepEqual(await pending, {
    ok: false, code: "blooket-browser-unavailable",
  });
  broker.close();
  },
);

test(
  "an expired dispatched browser reply never establishes success",
  async () => {
  let tick = 10_000;
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN, now: () => tick,
  });
  const pending = broker.request({ kind: "session.observe" });
  const request = broker.next(TOKEN);
  assert.ok(request);
  tick += 10_001;
  assert.equal(broker.complete(TOKEN, {
    schemaVersion: 1, id: request.id,
    ok: true, value: "my-sets",
  }), false);
  assert.deepEqual(await pending, {
    ok: false, code: "blooket-browser-unavailable",
  });
  assert.equal(broker.status().pending, 0);
  broker.close();
  },
);

test(
  "fresh authentication retains exactly one broker dispatch",
  async () => {
  let tick = 10_000;
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN, now: () => tick,
  });
  const pending = broker.request({
    kind: "session.authenticate",
    loginIdentifier: "synthetic@example.invalid",
    password: "test-only-no-account",
  });
  tick += 2_000;
  const job = broker.next(TOKEN);
  assert.ok(job);
  assert.equal(job.command.kind, "session.authenticate");
  assert.equal(broker.next(TOKEN), null);
  assert.equal(broker.complete(TOKEN, {
    schemaVersion: 1, id: job.id,
    ok: true, value: null,
  }), true);
  assert.deepEqual(await pending, { ok: true, value: null });
  broker.close();
  },
);

test("concurrent polls cannot dispatch two browser jobs at once", async () => {
  const broker = createBlooketBrowserBridgeBroker({ token: TOKEN });
  const first = broker.request({ kind: "session.observe" });
  const second = broker.request({ kind: "sets.list" });
  const active = broker.next(TOKEN);
  assert.ok(active);
  assert.equal(active.command.kind, "session.observe");
  assert.equal(broker.next(TOKEN), null);
  assert.equal(broker.status().pending, 2);
  assert.equal(broker.complete(TOKEN, {
    schemaVersion: 1, id: active.id,
    ok: true, value: "my-sets",
  }), true);
  assert.deepEqual(await first, { ok: true, value: "my-sets" });
  const next = broker.next(TOKEN);
  assert.ok(next);
  assert.equal(next.command.kind, "sets.list");
  assert.equal(broker.complete(TOKEN, {
    schemaVersion: 1, id: next.id,
    ok: true, value: { completeness: "complete", items: [] },
  }), true);
  assert.deepEqual(await second, {
    ok: true, value: { completeness: "complete", items: [] },
  });
  broker.close();
});

test(
  "a timed-out active lease frees the next queued browser read",
  async () => {
  let tick = 10_000;
  const broker = createBlooketBrowserBridgeBroker({
    token: TOKEN, now: () => tick,
  });
  const first = broker.request({ kind: "session.observe" });
  const active = broker.next(TOKEN);
  assert.ok(active);
  tick += 8_000;
  const second = broker.request({ kind: "sets.list" });
  assert.equal(broker.next(TOKEN), null);
  tick += 2_100;
  const next = broker.next(TOKEN);
  assert.ok(next);
  assert.equal(next.command.kind, "sets.list");
  assert.deepEqual(await first, {
    ok: false, code: "blooket-browser-unavailable",
  });
  assert.equal(broker.complete(TOKEN, {
    schemaVersion: 1, id: active.id,
    ok: true, value: "my-sets",
  }), false);
  assert.equal(broker.complete(TOKEN, {
    schemaVersion: 1, id: next.id,
    ok: true, value: { completeness: "complete", items: [] },
  }), true);
  assert.deepEqual(await second, {
    ok: true, value: { completeness: "complete", items: [] },
  });
  broker.close();
  },
);

test("pairing reset settles both active and queued jobs", async () => {
  const broker = createBlooketBrowserBridgeBroker({ token: TOKEN });
  const active = broker.request({ kind: "session.observe" });
  const waiting = broker.request({ kind: "sets.list" });
  const first = broker.next(TOKEN);
  assert.ok(first);
  assert.equal(broker.next(TOKEN), null);
  broker.resetPairing();
  assert.deepEqual(await active, {
    ok: false, code: "blooket-browser-unavailable",
  });
  assert.deepEqual(await waiting, {
    ok: false, code: "blooket-browser-unavailable",
  });
  assert.equal(broker.next(TOKEN), null);
  assert.equal(broker.complete(TOKEN, {
    schemaVersion: 1, id: first.id, ok: true, value: "my-sets",
  }), false);
  assert.equal(broker.status().pending, 0);
  broker.close();
});
