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
//   - Synthetic extension transport and browser admission verification.
// - Must-Not:
//   - Install an extension or contact an actual Blooket account.
// - Allows:
//   - Inputs: Synthetic browser APIs and bounded protocol fixtures.
//   - Outputs: Assertions about authentication, navigation, and read replies.
//   - Side effects: Temporary globals restored after the worker disconnects.
// - Split-When:
//   - A new browser host requires native acceptance fixtures.
// - Merge-When:
//   - Extension delivery becomes an in-process transport.
// - Summary:
//   - Exercises the actual worker without granting browser permissions.
// - Description:
//   - Confirms sender, address, job, and navigation checks before execution.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unsupported operations fail without page scripts or external requests.
//
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";

test(
  "worker admits explicit local reads and refuses arbitrary execution",
  async () => {
  const root = "chrome-extension://synthetic/";
  const origin = "http://127.0.0.1:4567";
  const token = "a".repeat(43);
  let listener;
  let tabUrl = "https://dashboard.blooket.com/my-sets";
  let creates = 0;
  let validStatus = true;
  const jobs = [];
  const replies = [];
  const scripts = [];
  const requests = [];
  const stored = {};
  const priorChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const priorFetch = globalThis.fetch;
  const browser = {
    runtime: {
      getURL: (path) => root + path,
      onMessage: {
        addListener: (callback) => {
          listener = callback;
        },
      },
    },
    tabs: {
      create: async ({ url }) => {
        creates++;
        tabUrl = url;
        return { id: 7, url, status: "complete" };
      },
      get: async (id) => {
        assert.equal(id, 7);
        return { id, url: tabUrl, status: "complete" };
      },
      update: async (id, { url }) => {
        assert.equal(id, 7);
        tabUrl = url;
        return { id, url, status: "complete" };
      },
    },
    storage: {
      session: {
        get: async () => ({ ...stored }),
        set: async (value) => Object.assign(stored, value),
        remove: async (key) => {
          delete stored[key];
        },
      },
    },
    scripting: {
      executeScript: async ({ target, func, args }) => {
        assert.equal(target.tabId, 7);
        scripts.push(func.name);
        if (func.name === "openBlooketDetailPanel") return [{ result: true }];
        assert.equal(func.name, "inspectBlooketPage");
        const operation = args[0];
        return [
          {
            result: {
              ok: true,
              value:
                operation.kind === "session.observe"
                  ? "my-sets"
                  : operation.kind === "sets.list"
                    ? [
                        {
                          schemaVersion: 1,
                          id: "set-fixture",
                          title: "Synthetic",
                        },
                      ]
                    : {
                        schemaVersion: 1,
                        id: operation.setId,
                        title: "Synthetic",
                        description: "",
                        visibility: "private",
                      },
            },
          },
        ];
      },
    },
  };
  Object.defineProperty(globalThis, "chrome", {
    value: browser,
    configurable: true,
  });
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    assert.ok(url.startsWith(origin + "/api/browser-bridge/"));
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer " + token);
    requests.push(url);
    let value;
    if (url.endsWith("/status"))
      value = validStatus ? { ok: true, pending: 0, connected: false } : {};
    else if (url.endsWith("/next"))
      value = { ok: true, job: jobs.shift() ?? null };
    else {
      assert.ok(url.endsWith("/result"));
      replies.push(JSON.parse(options.body));
      value = { ok: true };
    }
    return Response.json(value);
  };
  const popup = root + "src/ui/browser-extension/adapter-inbound/popup.html";
  const message = async (value) =>
    await new Promise((resolve) => {
      assert.equal(listener(value, { url: popup }, resolve), true);
    });
  const job = (command) => ({
    schemaVersion: 1,
    id: randomUUID(),
    command,
  });
  async function expectReply(command) {
    const request = job(command);
    jobs.push(request);
    const deadline = Date.now() + 3000;
    while (!replies.some((reply) => reply.id === request.id)) {
      assert.ok(Date.now() < deadline, "worker did not settle its request");
      await pause(20);
    }
    return replies.find((reply) => reply.id === request.id);
  }
  try {
    await import(
      "../../../../src/service/browser-extension/adapter-inbound/worker.ts"
    );
    assert.equal(typeof listener, "function");
    assert.equal(
      listener(
        { kind: "connect", origin, token },
        { url: "https://untrusted.invalid" },
        () => {
          assert.fail("foreign sender received a reply");
        },
      ),
      false,
    );
    for (const unsafe of [
      "https://127.0.0.1:4567",
      "http://localhost:4567",
      "http://127.0.0.1:4567/path",
      "http://evil.invalid:4567",
    ])
      assert.equal(
        (
          await message({
            kind: "connect",
            origin: unsafe,
            token,
          })
        ).status,
        "invalid-configuration",
      );
    assert.equal(requests.length, 0);
    validStatus = false;
    assert.equal((await message({ kind: "connect", origin, token })).ok, false);
    assert.equal(creates, 0);
    validStatus = true;
    assert.equal((await message({ kind: "connect", origin, token })).ok, true);
    assert.equal(creates, 1);
    assert.equal((await expectReply({ kind: "sets.list" })).ok, true);
    assert.equal(
      (
        await expectReply({
          kind: "sets.get",
          setId: "opaque id/with spaces",
        })
      ).ok,
      true,
    );
    assert.equal(
      tabUrl,
      "https://dashboard.blooket.com/edit?id=opaque%20id%2Fwith%20spaces",
    );
    const before = scripts.length;
    assert.equal(
      (
        await expectReply({
          kind: "session.authenticate",
          loginIdentifier: "teacher@example.invalid",
          password: "synthetic-password",
        })
      ).ok,
      false,
    );
    assert.equal(scripts.length, before);
    tabUrl = "https://id.blooket.com/login";
    assert.equal((await expectReply({ kind: "sets.list" })).ok, false);
    assert.equal(scripts.length, before);
    assert.equal(
      (await message({ kind: "status" })).status,
      "blooket-attention-required",
    );
    assert.equal(
      (await message({ kind: "disconnect" })).status,
      "disconnected",
    );
    assert.deepEqual(stored, {});
  } finally {
    if (listener) await message({ kind: "disconnect" });
    await pause(1100);
    globalThis.fetch = priorFetch;
    if (priorChrome) Object.defineProperty(globalThis, "chrome", priorChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});
