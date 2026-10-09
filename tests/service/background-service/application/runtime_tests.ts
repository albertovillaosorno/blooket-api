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
//   - Managed service lock and owned shutdown regression coverage.
// - Must-Not:
//   - Expose secrets or trust unvalidated host configuration.
// - Allows:
//   - Inputs: Explicit host configuration and bounded lifecycle inputs.
//   - Outputs: Validated local status, artifacts, or stable failure codes.
//   - Side effects: Owned filesystem, process, or browser operations.
// - Split-When:
//   - Host admission needs an independent platform boundary.
// - Merge-When:
//   - This host capability no longer needs a separate boundary.
// - Summary:
//   - Keeps explicit host operations outside product semantics.
// - Description:
//   - Uses reviewed paths and explicit process boundaries.
// - Usage:
//   - Call from trusted host composition after input validation.
// - Defaults:
//   - Unsupported hosts and invalid lifecycle inputs fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPreferences,
  savePreferences,
} from "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import { startManagedBackgroundService } from
  "../../../../src/service/background-service/application/runtime.ts";
import { existingService } from
  "../../../../src/platforms/service-lifecycle/adapter-outbound/runtime.ts";
import { createHostSecretStore } from
// jig-ignore-next-line: Preserve the exact mirrored source module path.
  "../../../../src/platforms/host-secret-store/adapter-outbound/host-secret-store.ts";
test("managed shutdown rejects cross-origin calls and releases ownership",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-service-"));
  const settings = await loadPreferences(root);
  await savePreferences(root, {
    ...settings,
    service: {
      ...settings.service,
      portMode: "automatic",
      port: 1,
    },
  });
  const secrets = createHostSecretStore();
  const service = await startManagedBackgroundService(root, secrets);
  try {
    assert.equal((await existingService(root))?.instance, service.instance);
    await assert.rejects(
      startManagedBackgroundService(root, secrets),
      /service-busy/u,
    );
    const denied = await fetch(service.origin + "/api/service-stop", {
      method: "POST",
      headers: {
        Origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(denied.status, 403);
    const boot = (await (
      await fetch(service.origin + "/api/bootstrap")
    ).json()) as { csrf: string };
    const closed = new Promise<void>((resolve) =>
      service.server.once("close", resolve),
    );
    const response = await fetch(service.origin + "/api/service-stop", {
      method: "POST",
      headers: {
        Origin: service.origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": boot.csrf,
      },
      body: "{}",
    });
    assert.equal(response.status, 202);
    await closed;
    await service.stop();
    assert.equal(await existingService(root), undefined);
    await assert.rejects(readFile(join(root, "service-runtime.json")));
    const restarted = await startManagedBackgroundService(root, secrets);
    await restarted.stop();
  } finally {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup closes the service even when online shutdown fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-stop-failure-"));
  const settings = await loadPreferences(root);
  await savePreferences(root, {
    ...settings,
    service: {
      ...settings.service,
      portMode: "automatic",
      port: 1,
    },
  });
  const secrets = createHostSecretStore();
  const online = {
    status: () => ({ state: "synthetic" }),
    pending: () => [],
    connections: () => [],
    approve: async () => undefined,
    reject: () => undefined,
    revoke: () => undefined,
    reload: async () => undefined,
    stop: async () => {
      throw new Error("synthetic-online-stop-failure");
    },
  };
  const service = await startManagedBackgroundService(root, secrets, {
    online,
  });
  await assert.rejects(service.stop(), /synthetic-online-stop-failure/u);
  assert.equal(service.server.listening, false);
  assert.equal(await existingService(root), undefined);
  await assert.rejects(readFile(join(root, "service-runtime.json")));
  const restarted = await startManagedBackgroundService(root, secrets);
  await restarted.stop();
  await rm(root, { recursive: true, force: true });
});


test("shutdown retains ownership until an admitted settings writer finishes",
  { timeout: 10_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-drain-"));
    const settings = await loadPreferences(root);
    await savePreferences(root, { ...settings,
      service: { ...settings.service, portMode: "automatic", port: 1 } });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const secrets = {
      read: async () => ({ ok: true as const, kind: "missing" as const }),
      write: async () => {
        entered.resolve();
        await release.promise;
        return { ok: true as const };
      },
      delete: async () => ({ ok: true as const }),
    };
    const service = await startManagedBackgroundService(root, secrets);
    let saving: Promise<unknown> | undefined;
    let stopping: Promise<void> | undefined;
    try {
      const boot = await (await fetch(
        service.origin + "/api/bootstrap")).json();
      const preferences = await loadPreferences(root);
      saving = fetch(service.origin + "/api/settings", {
        method: "POST", headers: { Origin: service.origin,
          "Content-Type": "application/json", "X-CSRF-Token": boot.csrf },
        body: JSON.stringify({ preferences: { ...preferences, locale: "es" },
          password: "synthetic-test-value", tunnelToken: "" }),
      }).then(response => response.json(), () => undefined);
      await entered.promise;
      stopping = service.stop();
      const outcome = await Promise.race([
        stopping.then(() => "released"),
        new Promise<string>(resolve => setTimeout(() => resolve("pending"),
          100)),
      ]);
      assert.equal(outcome, "pending");
      await assert.rejects(startManagedBackgroundService(root, secrets),
        /service-busy/);
      await readFile(join(root, ".service.lock"));
      release.resolve();
      await stopping;
      await saving;
      assert.equal((await loadPreferences(root)).locale, "es");
      await assert.rejects(readFile(join(root, ".service.lock")));
      const next = await startManagedBackgroundService(root, secrets);
      await next.stop();
    } finally {
      release.resolve();
      await stopping;
      await saving;
      await service.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
