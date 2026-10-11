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
//   - The same-origin loopback UI and local HTTP boundary.
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
//   - The same-origin loopback UI and local HTTP boundary.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from
  "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { startBrowserService } from
  "../../../../src/api/browser-service/adapter-inbound/server.ts";
import { createBlooketBrowserBridgeBroker } from
  "../../../../src/platforms/blooket-browser/adapter-outbound/broker.ts";
import { loadSharp } from
  "../../../../src/media/sharp-runtime/adapter-outbound/sharp-runtime.ts";
import {
  loadPreferences,
  savePreferences,
} from "../../../../src/platforms/user-storage/adapter-outbound/root.ts";

test("local icons load and image intake requires origin and CSRF", async () => {
  const root = await mkdtemp(join(tmpdir(), "clipboard-service-"));
  const service = await startBrowserService({ root, port: 0 });
  try {
    for (const path of ["/icon.svg", "/mcp-icon.png", "/library.js"]) {
      const response = await fetch(service.origin + path);
      assert.equal(response.status, 200);
      assert.ok((await response.arrayBuffer()).byteLength > 100);
    }
    const boot = await (await fetch(service.origin + "/api/bootstrap")).json();
    const rejected = await fetch(service.origin + "/api/image-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.test/a" }),
    });
    assert.equal(rejected.status, 403);
    const blocked = await fetch(service.origin + "/api/image-source", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: service.origin,
        "X-CSRF-Token": boot.csrf,
      },
      body: JSON.stringify({ url: "http://127.0.0.1/private" }),
    });
    assert.equal(blocked.status, 400);
    assert.equal((await blocked.json()).code, "image-url-not-public");
  } finally {
    service.server.close();
    service.server.closeAllConnections();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "fixed collisions stop; automatic ports honor " + "and persist loopback",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "browser-port-"));
    const occupied = createServer();
    await new Promise<void>((resolve) =>
      occupied.listen(0, "127.0.0.2", resolve),
    );
    const address = occupied.address();
    assert.ok(address && typeof address !== "string");
    let service: Awaited<ReturnType<typeof startBrowserService>> | undefined;
    try {
      const preferences = await loadPreferences(root);
      const fixed = {
        ...preferences,
        service: {
          ...preferences.service,
          bindAddress: "127.0.0.2",
          port: address.port,
        },
      };
      await savePreferences(root, fixed);
      await assert.rejects(
        startBrowserService({ root }),
        /configured-port-in-use/u,
      );
      await savePreferences(root, {
        ...fixed,
        service: { ...fixed.service, portMode: "automatic" },
      });
      let gatewayLocalPort = 0;
      service = await startBrowserService({
        root,
        online: {
          status: () => ({ state: "disabled" }),
          pending: () => [],
          approve: async () => {},
          connections: () => [],
          reject: () => {},
          revoke: () => {},
          stop: async () => {},
          reload: async (port) => {
            gatewayLocalPort = port!;
          },
        },
      });
      assert.notEqual(service.port, address.port);
      assert.equal(service.origin, "http://127.0.0.2:" + service.port);
      const saved = await loadPreferences(root);
      assert.equal(saved.service.port, service.port);
      const boot = (await (
        await fetch(service.origin + "/api/bootstrap")
      ).json()) as { csrf: string };
      const rerun = await fetch(service.origin + "/api/diagnostics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": boot.csrf,
          Origin: service.origin,
        },
        body: "{}",
      });
      assert.equal(rerun.status, 200);
      const rerunState = await rerun.json() as {
        checks: { name: string; status: string; code: string }[];
      };
      assert.deepEqual(
        rerunState.checks.find((check) => check.name === "settings"),
        { name: "settings", status: "passed", code: "settings-valid" },
      );
      const response = await fetch(service.origin + "/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": boot.csrf,
          Origin: service.origin,
        },
        body: JSON.stringify({
          preferences: {
            ...saved,
            service: { ...saved.service, port: address.port },
          },
          password: "",
          tunnelToken: "",
        }),
      });
      assert.equal(response.status, 200);
      assert.equal(gatewayLocalPort, service.port);
    } finally {
      occupied.close();
      if (service) {
        await new Promise<void>((resolve) => {
          service!.server.close(() => resolve());
          service!.server.closeAllConnections();
        });
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "same-origin UI handles image import/export and " +
    "denies CSRF and oversized prepared files",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "browser-service-"));
    const service = await startBrowserService({ root, port: 0 });
    try {
      const html = await (await fetch(service.origin)).text();
      assert.match(html, /Blooket API/u);
      assert.doesNotMatch(html, /id="importDialog"/u);
      assert.equal((html.match(/id="canvas"/gu) ?? []).length, 1);
      assert.match(
        html,
        /name="width"[\s\S]{0,120}readonly/u,
      );
      assert.match(
        html,
        /name="height"[\s\S]{0,120}readonly/u,
      );
      assert.match(html, /data-i18n="canvasGlobal"/u);
      assert.match(html, /id="qualityState"/u);
      for (const id of ["checkBlooketReadiness", "focusBlooketTab",
        "openBlooketBrowser", "blooketReadinessState"])
        assert.match(html, new RegExp(`id="${id}"`, "u"));
      assert.doesNotMatch(html, /data-i18n="limit"/u);
      const app = await (await fetch(service.origin + "/app.js")).text();
      assert.match(app, /URL\.createObjectURL\(file\)/u);
      assert.match(app, /edit: selected\.edit/u);
      assert.match(app, /preparedDirty = true/u);
      assert.match(app, /preparing = true/u);
      assert.match(app, /effective\.detailScale/u);
      assert.match(app, /effective\.gifFps/u);
      assert.match(app, /effective\.compression/u);
      assert.match(app, /editorSession \+= 1/u);
      assert.match(app, /preparationController[?]\.abort\(\)/u);
      assert.match(app, /\/api\/blooket-readiness-check/u);
      assert.match(app, /readInterrupted/u);
      assert.match(app, /debug\.blooket\.com/u);
      assert.match(app, /pestaña nueva del Chrome conectado/u);
      assert.match(app, /connected Chrome profile/u);
      assert.match(app, /rerun them in a new/u);
      assert.match(app, /controller\.signal/u);
      assert.match(app, /\/api\/media-admission/u);
      assert.match(app, /schedulePreparationAdmission\(\)/u);
      assert.match(app, /higherQuality\.disabled/u);
      assert.doesNotMatch(app, /selected\.prepared = null/u);
      assert.doesNotMatch(app, /t\("limit"\)/u);
      const boot = (await (
        await fetch(service.origin + "/api/bootstrap")
      ).json()) as {
        csrf: string;
        diagnostic: { checks: { name: string; status: string }[] };
      };
      assert.equal(
        boot.diagnostic.checks.find((check) => check.name === "native-image")!
          .status,
        "passed",
      );
      const post = (path: string, body: unknown, origin = service.origin) =>
        fetch(service.origin + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": boot.csrf,
            Origin: origin,
          },
          body: JSON.stringify(body),
        });
      assert.equal(
        (await post(
          "/api/prepare",
          { id: "missing", revision: 1 },
          "https://evil.example",
        ))
          .status,
        403,
      );
      const sharp = await loadSharp();
      const source = await sharp(new Uint8Array([40, 50, 90, 255]), {
        raw: { width: 1, height: 1, channels: 4 },
      })
        .png()
        .toBuffer();
      const imported = (await (
        await post("/api/import", {
          name: "Sample",
          description: "Sample image",
          base64: Buffer.from(source).toString("base64"),
          edit: {
            panX: 0.2,
            panY: -0.2,
            zoom: 0.7,
            contrast: 1,
            saturation: 1,
            background: { mode: "solid", color: "#123456" },
            width: 1280,
            height: 720,
            gifFps: 10,
            compression: "compact",
          },
        })
      ).json()) as {
        id: string;
        asset: string;
        revision: number;
        edit: { zoom: number };
      };
      assert.ok(imported.id);
      assert.equal(imported.edit.zoom, 0.7);
      const missingPrepareRevision = await post("/api/prepare", {
        id: imported.id,
      });
      assert.equal(missingPrepareRevision.status, 400);
      assert.deepEqual(await missingPrepareRevision.json(), {
        ok: false,
        code: "invalid-prepare-request",
      });
      const stalePrepareRevision = await post("/api/prepare", {
        id: imported.id,
        revision: imported.revision + 1,
      });
      assert.equal(stalePrepareRevision.status, 400);
      assert.deepEqual(await stalePrepareRevision.json(), {
        ok: false,
        code: "prepared-revision-conflict",
      });
      const admission = (await (
        await post("/api/media-admission", {
          id: imported.id,
          edit: {
            panX: 0.2,
            panY: -0.2,
            zoom: 0.7,
            contrast: 1,
            saturation: 1,
            background: { mode: "solid", color: "#123456" },
            width: 1280,
            height: 720,
            gifFps: 10,
            compression: "compact",
          },
        })
      ).json()) as {
        feasible: boolean;
        highQuality: boolean;
        effective: { compression: string };
      };
      assert.equal(admission.feasible, true);
      assert.equal(admission.highQuality, true);
      assert.equal(admission.effective.compression, "lossless");
      const samples = (await (
        await post("/api/media-color-samples", { id: imported.id })
      ).json()) as { rgba: number[] };
      assert.equal(samples.rgba.length, 8 * 8 * 4);
      assert.ok(samples.rgba.every((value) => value >= 0 && value <= 255));
      const media = (await (
        await fetch(service.origin + "/api/media")
      ).json()) as { id: string; normalizationStatus: string }[];
      assert.equal(media.length, 1);
      assert.equal(media[0]!.id, imported.id);
      assert.equal(media[0]!.normalizationStatus, "pending");
      // Never commit a 200 response until the owned asset was bounded.
      const mediaRoot = (await loadPreferences(root)).mediaRoot;
      const sourcePath = join(mediaRoot, imported.asset);
      const sourceBytes = await readFile(sourcePath);
      const originalResponse = await fetch(service.origin +
        "/media/" + imported.id);
      assert.equal(originalResponse.status, 200);
      assert.deepEqual(Buffer.from(await originalResponse.arrayBuffer()),
        sourceBytes);
      await truncate(sourcePath, 25_000_001);
      const oversizedSource = await fetch(service.origin +
        "/media/" + imported.id);
      assert.equal(oversizedSource.status, 400);
      assert.equal((await readFile(sourcePath)).byteLength, 25_000_001);
      await rm(sourcePath);
      const outsideSource = join(root, "unrelated-source.webp");
      await writeFile(outsideSource, Uint8Array.of(7, 8, 9));
      await symlink(outsideSource, sourcePath);
      assert.equal((await fetch(service.origin +
        "/media/" + imported.id)).status, 400);
      assert.deepEqual(await readFile(outsideSource), Buffer.from([7, 8, 9]));
      await rm(sourcePath);
      await writeFile(sourcePath, sourceBytes);
      const prepared = (await (
        await post("/api/prepare", {
          id: imported.id,
          revision: imported.revision,
        })
      ).json()) as { prepared: { file: string; bytes: number } };
      assert.ok(prepared.prepared.bytes < 2_500_000);
      assert.match(prepared.prepared.file, /[.]jpg$/u);
      const preparedResponse = await fetch(
        service.origin + "/media/" + imported.id + "?variant=prepared",
      );
      assert.equal(preparedResponse.status, 200);
      assert.equal(preparedResponse.headers.get("content-type"), "image/jpeg");
      assert.equal(
        (
          await fetch(
            service.origin +
              "/media/" +
              imported.id +
              "?variant=prepared&revision=2",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await fetch(
            service.origin +
              "/media/" +
              imported.id +
              "?variant=prepared&revision=1.0",
          )
        ).status,
        400,
      );
      await writeFile(
        join((await loadPreferences(root)).mediaRoot, prepared.prepared.file),
        Buffer.alloc(2_500_000),
      );
      assert.equal(
        (
          await fetch(
            service.origin + "/media/" + imported.id + "?variant=prepared",
          )
        ).status,
        400,
      );
      const command = (await (
        await post("/api/command", {
          version: 1,
          operationId: "test:search",
          command: "library.list",
          payload: { query: "Sample" },
        })
      ).json()) as {
        ok: boolean;
        value: { normalizationStatus: string }[];
      };
      assert.equal(command.ok, true);
      assert.equal(command.value.length, 1);
      assert.equal(command.value[0]!.normalizationStatus, "pending");
    } finally {
      await new Promise<void>((resolve) => {
        service.server.close(() => resolve());
        service.server.closeAllConnections();
      });
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("configured canvas is enforced across local media routes", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-canvas-"));
  const service = await startBrowserService({ root, port: 0 });
  try {
    const boot = (await (
      await fetch(service.origin + "/api/bootstrap")
    ).json()) as { csrf: string };
    const post = (path: string, body: unknown) =>
      fetch(service.origin + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": boot.csrf,
          Origin: service.origin,
        },
        body: JSON.stringify(body),
      });
    const sharp = await loadSharp();
    const source = await sharp(new Uint8Array([80, 40, 120, 255]), {
      raw: { width: 1, height: 1, channels: 4 },
    })
      .png()
      .toBuffer();
    const imported = (await (
      await post("/api/import", {
        name: "Canvas fixture",
        description: "",
        base64: Buffer.from(source).toString("base64"),
        edit: {
          panX: 0,
          panY: 0,
          zoom: 1,
          contrast: 1,
          saturation: 1,
          background: { mode: "solid", color: "#ffffff" },
          width: 1280,
          height: 720,
          gifFps: 10,
          compression: "compact",
        },
      })
    ).json()) as { id: string; revision: number };
    assert.equal(
      (
        await post("/api/prepare", {
          id: imported.id,
          revision: imported.revision,
        })
      ).status,
      200,
    );

    const preferences = await loadPreferences(root);
    await savePreferences(root, {
      ...preferences,
      defaults: {
        ...preferences.defaults,
        width: 640,
        height: 360,
      },
    });

    const media = (await (
      await fetch(service.origin + "/api/media")
    ).json()) as {
      id: string;
      edit: { width: number; height: number };
      prepared: unknown;
    }[];
    assert.equal(media[0]!.id, imported.id);
    assert.equal(media[0]!.edit.width, 640);
    assert.equal(media[0]!.edit.height, 360);
    assert.equal(media[0]!.prepared, null);

    const stalePrepared = await fetch(
      service.origin + "/media/" + imported.id + "?variant=prepared",
    );
    assert.equal(stalePrepared.status, 400);
    assert.deepEqual(await stalePrepared.json(), {
      ok: false,
      code: "prepared-settings-conflict",
    });

    const stalePrepare = await post("/api/prepare", {
      id: imported.id,
      revision: imported.revision,
    });
    assert.equal(stalePrepare.status, 400);
    assert.deepEqual(await stalePrepare.json(), {
      ok: false,
      code: "canvas-settings-conflict",
    });

    const command = (await (
      await post("/api/command", {
        version: 1,
        operationId: "test:canvas-view",
        command: "library.get",
        payload: { id: imported.id },
      })
    ).json()) as {
      ok: boolean;
      value: {
        edit: { width: number; height: number };
        prepared: unknown;
      };
    };
    assert.equal(command.ok, true);
    assert.equal(command.value.edit.width, 640);
    assert.equal(command.value.edit.height, 360);
    assert.equal(command.value.prepared, null);
  } finally {
    await new Promise<void>((resolve) => {
      service.server.close(() => resolve());
      service.server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "extension bridge requires its bearer token and correlates one job",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-extension-bridge-"));
  const service = await startBrowserService({ root, port: 0 });
  try {
    const boot = (await (
      await fetch(service.origin + "/api/bootstrap")
    ).json()) as {
      csrf: string;
      browserBridge: {
        schemaVersion: number;
        token: string;
        connected: boolean;
      };
    };
    assert.equal(boot.browserBridge.schemaVersion, 1);
    assert.equal(boot.browserBridge.connected, false);
    assert.ok(boot.browserBridge.token.length >= 32);

    const extensionOrigin = "chrome-extension://fixture-extension";
    const foreign = await fetch(service.origin + "/api/browser-bridge/next", {
      headers: {
        Authorization: "Bearer " + boot.browserBridge.token,
        Origin: "https://evil.example",
      },
    });
    assert.equal(foreign.status, 403);

    const wrong = await fetch(service.origin + "/api/browser-bridge/next", {
      headers: {
        Authorization: "Bearer wrong-token",
        Origin: extensionOrigin,
      },
    });
    assert.equal(wrong.status, 401);

    const pending = service.browserBridge.request({ kind: "sets.list" });
    const missingClient = await fetch(
      service.origin + "/api/browser-bridge/next",
      { headers: { Authorization: "Bearer " + boot.browserBridge.token } },
    );
    assert.equal(missingClient.status, 426);
    assert.equal(service.browserBridge.status().pending, 1);
    assert.equal(service.browserBridge.status().connected, false);
    assert.equal(service.browserBridge.status().requiresExtensionUpdate, true);
    const identifiedHeaders = {
      Authorization: "Bearer " + boot.browserBridge.token,
      "x-blooket-browser-client": extensionOrigin + "/",
    };
    const statusOnly = await fetch(
      service.origin + "/api/browser-bridge/status",
      { headers: identifiedHeaders },
    );
    assert.equal(statusOnly.status, 200);
    const response = await fetch(service.origin + "/api/browser-bridge/next", {
      // Chrome omits Origin on GET but supplies it on result POST.
      headers: identifiedHeaders,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const next = (await response.json()) as {
      job: { id: string; command: { kind: string } };
    };
    assert.equal(next.job.command.kind, "sets.list");

    const completed = await fetch(
      service.origin + "/api/browser-bridge/result",
      {
        method: "POST",
        headers: {
          ...identifiedHeaders,
          "Content-Type": "application/json",
          Origin: extensionOrigin,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          id: next.job.id,
          ok: true,
          value: [{ schemaVersion: 1, id: "set-a", title: "Synthetic" }],
        }),
      },
    );
    assert.equal(completed.status, 200);
    assert.deepEqual(await pending, {
      ok: true,
      value: [{ schemaVersion: 1, id: "set-a", title: "Synthetic" }],
    });
    const oldWorker = await fetch(
      service.origin + "/api/browser-bridge/next",
      { headers: {
        ...identifiedHeaders,
        Origin: extensionOrigin,
      } },
    );
    assert.equal(oldWorker.status, 426);
    assert.deepEqual(await oldWorker.json(), {
      ok: false, code: "blooket-browser-incompatible",
    });
    const freshPending = service.browserBridge.request({ kind: "sets.list" });
    const currentOrigin = "chrome-extension://current-fixture";
    const currentHeaders = {
      Authorization: "Bearer " + boot.browserBridge.token,
      "Content-Type": "application/json",
      Origin: currentOrigin,
      "x-blooket-browser-client": currentOrigin + "/",
    };
    const contradictory = await fetch(
      service.origin + "/api/browser-bridge/next",
      { headers: { ...currentHeaders, Origin: extensionOrigin } },
    );
    assert.equal(contradictory.status, 403);
    assert.equal(service.browserBridge.status().pending, 1);
    const freshPoll = await fetch(
      service.origin + "/api/browser-bridge/next",
      { headers: currentHeaders },
    );
    const freshJob = (await freshPoll.json()).job;
    assert.ok(freshJob);
    const reply = {
      schemaVersion: 1, id: freshJob.id, ok: true,
      value: { items: [], completeness: "complete" },
    };
    const wrongWorker = await fetch(
      service.origin + "/api/browser-bridge/result",
      {
        method: "POST",
        headers: {
          ...currentHeaders, Origin: "chrome-extension://other",
          "x-blooket-browser-client": "chrome-extension://other/",
        },
        body: JSON.stringify(reply),
      },
    );
    assert.equal(wrongWorker.status, 400);
    assert.equal(service.browserBridge.status().pending, 1);
    const freshResult = await fetch(
      service.origin + "/api/browser-bridge/result",
      {
        method: "POST", headers: currentHeaders,
        body: JSON.stringify(reply),
      },
    );
    assert.equal(freshResult.status, 200);
    assert.deepEqual(await freshPending, { ok: true, value: reply.value });
    const withoutCsrf = await fetch(
      service.origin + "/api/browser-pairing-reset",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(withoutCsrf.status, 403);
    const reset = await fetch(service.origin + "/api/browser-pairing-reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": boot.csrf,
        Origin: service.origin,
      },
      body: "{}",
    });
    assert.equal(reset.status, 200);
    assert.equal(service.browserBridge.status().requiresExtensionUpdate, false);
    const revoked = await fetch(service.origin + "/api/browser-bridge/status", {
      headers: { Authorization: "Bearer " + boot.browserBridge.token },
    });
    assert.equal(revoked.status, 401);
  } finally {
    await new Promise<void>((resolve) => {
      service.server.close(() => resolve());
      service.server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
});


test("Safari extension setup is same-origin and package-owned", async () => {
  const root = await mkdtemp(join(tmpdir(), "safari-extension-service-"));
  let opened = 0;
  const service = await startBrowserService({
    root,
    port: 0,
    safariExtension: {
      available: async () => true,
      open: async () => {
        opened++;
        return { ok: true };
      },
    },
  });
  try {
    const boot = (await (
      await fetch(service.origin + "/api/bootstrap")
    ).json()) as {
      csrf: string;
      safariExtension: { available: boolean };
    };
    assert.deepEqual(boot.safariExtension, { available: true });
    const denied = await fetch(
      service.origin + "/api/safari-extension-open",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(denied.status, 403);
    assert.equal(opened, 0);

    const response = await fetch(
      service.origin + "/api/safari-extension-open",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": boot.csrf,
          Origin: service.origin,
        },
        body: "{}",
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(opened, 1);
  } finally {
    await new Promise<void>((resolve) => {
      service.server.close(() => resolve());
      service.server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
});


test("local login controls require CSRF and preserve actual approval status",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "login-service-"));
    const changes: boolean[] = [];
    let stopped = false;
    let state: "requires-approval" | "not-registered" = "not-registered";
    const service = await startBrowserService({ root, port: 0,
      stop: async () => { stopped = true; },
      loginItem: {
        inspect: async () => ({ schemaVersion: 1, state }),
        setEnabled: async enabled => {
          changes.push(enabled);
          state = enabled ? "requires-approval" : "not-registered";
          return { schemaVersion: 1, state };
        },
      },
    });
    try {
      const bootstrap = await (await fetch(service.origin +
        "/api/bootstrap")).json();
      assert.equal(bootstrap.service.loginItem.state, "not-registered");
      assert.equal(bootstrap.service.canStop, true);
      const post = (body: unknown, csrf = bootstrap.csrf) => fetch(
        service.origin + "/api/login-item", {
          method: "POST", headers: { Origin: service.origin,
            "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify(body),
        },
      );
      assert.equal((await post({ enabled: true }, "foreign")).status, 403);
      assert.equal((await post({ enabled: true, path: "/tmp" })).status, 400);
      assert.deepEqual(changes, []);
      const enabled = await (await post({ enabled: true })).json();
      assert.equal(enabled.ok, true);
      assert.equal(enabled.loginItem.state, "requires-approval");
      const fresh = await (await fetch(service.origin +
        "/api/bootstrap")).json();
      assert.equal(fresh.preferences.service.launchAtLogin, true);
      assert.equal(fresh.service.loginItem.state, "requires-approval");
      const disabled = await (await post({ enabled: false })).json();
      assert.equal(disabled.ok, true);
      assert.equal(disabled.loginItem.state, "not-registered");
      assert.deepEqual(changes, [true, false]);
      const page = await (await fetch(service.origin)).text();
      assert.ok(page.includes('id="launchAtLogin"'));
      assert.ok(page.includes('id="stopService"'));
      const stop = (csrf: string) => fetch(service.origin +
        "/api/service-stop", { method: "POST",
          headers: { Origin: service.origin,
            "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: "{}" });
      assert.equal((await stop("foreign")).status, 403);
      assert.equal(stopped, false);
      const accepted = await stop(bootstrap.csrf);
      assert.equal(accepted.status, 202);
      await accepted.text();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(stopped, true);
    } finally {
      service.server.close();
      service.server.closeAllConnections();
      await rm(root, { recursive: true, force: true });
    }
  });

test("bridge transfers a bounded prepared image beyond one-megabyte JSON",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "image-bridge-envelope-"));
  const service = await startBrowserService({ root, port: 0 });
  try {
    // The largest admitted prepared file must still fit the four-megabyte
    // extension job response and preserve every byte of its base64 payload.
    const bytes = new Uint8Array(2_499_999);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const image = { format: "png" as const,
      base64: Buffer.from(bytes).toString("base64") };
    const command = {
      kind: "questions.create" as const,
      setId: "synthetic-set", number: 1,
      question: "Synthetic picture prompt",
      answers: [{ text: "Answer", correct: true }],
      qType: "typing" as const, random: true,
      answerTypes: ["exactly" as const], timeLimit: 15, image,
    };
    const bootstrap = await (
      await fetch(service.origin + "/api/bootstrap")
    ).json() as { browserBridge: { token: string } };
    const headers = {
      Authorization: "Bearer " + bootstrap.browserBridge.token,
      "x-blooket-browser-client": "chrome-extension://fixture-media/",
    };
    const pending = service.browserBridge.request(command);
    const reply = await fetch(service.origin + "/api/browser-bridge/next", {
      headers,
    });
    assert.equal(reply.status, 200);
    const raw = await reply.text();
    assert.ok(Buffer.byteLength(raw) > 1_000_000);
    assert.ok(Buffer.byteLength(raw) < 4_000_000);
    const payload = JSON.parse(raw) as {
      job: { id: string; command: typeof command };
    };
    assert.equal(payload.job.command.image.base64, image.base64);
    assert.equal(payload.job.command.image.format, "png");
    // This is a transport-only test, not a real Blooket mutation.
    const settled = await fetch(
      service.origin + "/api/browser-bridge/result", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1,
          id: payload.job.id, ok: false, code: "blooket-browser-failed" }),
      },
    );
    assert.equal(settled.status, 200);
    assert.deepEqual(await pending, {
      ok: false, code: "blooket-browser-failed",
    });
  } finally {
    service.browserBridge.close();
    await new Promise<void>((resolve) => {
      service.server.close(() => resolve());
      service.server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
  },
);

test("teacher-only local action opens a regular browser without URL input",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "blooket-browser-action-"));
    let opens = 0;
    const service = await startBrowserService({
      root, port: 0,
      openBlooketBrowser: async () => { opens++; },
    });
    try {
      const bootstrap = await (
        await fetch(service.origin + "/api/bootstrap")
      ).json() as { csrf: string };
      const post = (body: unknown, options: {
        csrf?: string; origin?: string;
      } = {}) => fetch(service.origin + "/api/blooket-browser-open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: options.origin ?? service.origin,
          "X-CSRF-Token": options.csrf ?? bootstrap.csrf,
        },
        body: JSON.stringify(body),
      });
      assert.equal((await fetch(service.origin +
        "/api/blooket-browser-open")).status, 404);
      assert.equal((await post({}, { csrf: "wrong" })).status, 403);
      assert.equal((await post({}, {
        origin: "https://foreign.invalid",
      })).status, 403);
      for (const invalid of [
        { url: "https://foreign.invalid/" },
        { profile: "untrusted" },
        { userAgent: "spoofed" },
        { debug: true }, null, [],
      ]) assert.equal((await post(invalid)).status, 400);
      assert.equal(opens, 0);
      assert.equal((await post({})).status, 200);
      assert.equal(opens, 1);
      assert.deepEqual(await (await post({})).json(), { ok: true });
      assert.equal(opens, 2);
    } finally {
      service.server.close();
      service.server.closeAllConnections();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("connected-tab focus acts only through the paired extension",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "blooket-tab-focus-"));
  const broker = createBlooketBrowserBridgeBroker({
    token: "synthetic-tab-focus-token-has-sufficient-entropy-length",
  });
  const service = await startBrowserService({
    root, port: 0, browserBridge: broker,
  });
  try {
    const bootstrap = await (
      await fetch(service.origin + "/api/bootstrap")
    ).json() as { csrf: string };
    const client = "chrome-extension://fixture-focus/";
    const post = (body: unknown, origin = service.origin,
      csrf = bootstrap.csrf) => fetch(
      service.origin + "/api/blooket-connected-tab-focus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin, "X-CSRF-Token": csrf,
        },
        body: JSON.stringify(body),
      },
    );
    assert.equal((await post({})).status, 409);
    assert.equal((await post({}, service.origin, "invalid")).status, 403);
    assert.equal((await post({}, "https://other.invalid")).status, 403);
    for (const invalid of [{ url: "https://other.invalid" },
      { spoofUserAgent: true }, null, []])
      assert.equal((await post(invalid)).status, 400);
    assert.equal(broker.next(broker.pairingToken(), client), null);
    const pending = post({});
    let job = broker.next(broker.pairingToken(), client);
    for (let attempt = 0; !job && attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 15));
      job = broker.next(broker.pairingToken(), client);
    }
    assert.ok(job);
    assert.deepEqual(job.command, { kind: "browser.activate" });
    assert.equal(broker.complete(broker.pairingToken(), {
      schemaVersion: 1, id: job.id, ok: true,
      value: { focused: true },
    }, client), true);
    assert.deepEqual(await (await pending).json(), { ok: true });
    assert.equal(broker.status().pending, 0);
  } finally {
    service.server.close();
    service.server.closeAllConnections();
    broker.close();
    await rm(root, { recursive: true, force: true });
  }
  },
);

test("readiness checks the paired session, then My Sets without writes",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "blooket-readiness-"));
    const broker = createBlooketBrowserBridgeBroker({
      token: "synthetic-readiness-token-has-sufficient-entropy-length",
    });
    const service = await startBrowserService({
      root, port: 0, browserBridge: broker,
    });
    try {
      const boot = await (
        await fetch(service.origin + "/api/bootstrap")
      ).json() as { csrf: string };
      const client = "chrome-extension://fixture-readiness/";
      const post = (body: unknown, csrf = boot.csrf,
        origin = service.origin) => fetch(
        service.origin + "/api/blooket-readiness-check", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", "X-CSRF-Token": csrf,
            Origin: origin,
          },
          body: JSON.stringify(body),
        },
      );
      assert.equal((await post({})).status, 409);
      assert.equal((await post({}, "invalid")).status, 403);
      assert.equal((await post({}, boot.csrf,
        "https://foreign.invalid")).status, 403);
      for (const bad of [null, [], { id: "set-fixture" },
        { kind: "sets.create" }, { userAgent: "modified" }])
        assert.equal((await post(bad)).status, 400);
      assert.equal(broker.status().pending, 0);
      broker.next(broker.pairingToken(), client);
      const next = async (kind: string, value: unknown) => {
        let job = broker.next(broker.pairingToken(), client);
        for (let attempt = 0; !job && attempt < 50; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          job = broker.next(broker.pairingToken(), client);
        }
        assert.ok(job, "expected an isolated browser job");
        assert.equal(job.command.kind, kind);
        assert.equal(broker.complete(broker.pairingToken(), {
          schemaVersion: 1, id: job.id, ok: true, value,
        }, client), true);
      };
      for (const state of ["security-challenge", "signed-out",
        "organization-prompt", "unexpected-page"] as const) {
        const response = post({});
        await next("session.observe", state);
        assert.deepEqual(await (await response).json(), {
          ok: true, state, read: "not-attempted",
        });
        assert.equal(broker.next(broker.pairingToken(), client), null);
      }
      const complete = post({});
      await next("session.observe", "my-sets");
      await next("sets.list", { items: [], completeness: "complete" });
      assert.deepEqual(await (await complete).json(), {
        ok: true, state: "my-sets", read: "observed",
        completeness: "complete", count: 0,
      });
      const partial = post({});
      await next("session.observe", "my-sets");
      await next("sets.list", { completeness: "unknown", items: [{
        schemaVersion: 1, id: "synthetic-set", title: "Synthetic",
      }] });
      assert.deepEqual(await (await partial).json(), {
        ok: true, state: "my-sets", read: "observed",
        completeness: "unknown", count: 1,
      });
      const malformed = post({});
      await next("session.observe", "edit");
      await next("sets.list", { completeness: "unknown", items: [{
        id: "private", title: "not-versioned",
      }] });
      assert.deepEqual(await (await malformed).json(), {
        ok: true, state: "edit", read: "unconfirmed",
      });
      const interrupted = post({});
      await next("session.observe", "my-sets");
      let failedJob = broker.next(broker.pairingToken(), client);
      for (let attempt = 0; !failedJob && attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        failedJob = broker.next(broker.pairingToken(), client);
      }
      assert.ok(failedJob);
      assert.deepEqual(failedJob.command, { kind: "sets.list" });
      assert.equal(broker.complete(broker.pairingToken(), {
        schemaVersion: 1, id: failedJob.id,
        ok: false, code: "blooket-browser-failed",
      }, client), true);
      await next("session.observe", "security-challenge");
      assert.deepEqual(await (await interrupted).json(), {
        ok: true, state: "security-challenge", read: "interrupted",
      });
      assert.equal(broker.next(broker.pairingToken(), client), null);
      for (const stop of ["signed-out", "organization-prompt",
        "unexpected-page"] as const) {
        const request = post({});
        await next("session.observe", "my-sets");
        let failed = broker.next(broker.pairingToken(), client);
        for (let attempt = 0; !failed && attempt < 50; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          failed = broker.next(broker.pairingToken(), client);
        }
        assert.ok(failed);
        assert.equal(failed.command.kind, "sets.list");
        assert.equal(broker.complete(broker.pairingToken(), {
          schemaVersion: 1, id: failed.id,
          ok: false, code: "blooket-browser-failed",
        }, client), true);
        await next("session.observe", stop);
        assert.deepEqual(await (await request).json(), {
          ok: true, state: stop, read: "interrupted",
        });
      }
      const unexplained = post({});
      await next("session.observe", "my-sets");
      let unexplainedJob = broker.next(broker.pairingToken(), client);
      for (let attempt = 0; !unexplainedJob && attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        unexplainedJob = broker.next(broker.pairingToken(), client);
      }
      assert.ok(unexplainedJob);
      assert.equal(unexplainedJob.command.kind, "sets.list");
      assert.equal(broker.complete(broker.pairingToken(), {
        schemaVersion: 1, id: unexplainedJob.id,
        ok: false, code: "blooket-browser-failed",
      }, client), true);
      await next("session.observe", "my-sets");
      assert.deepEqual(await (await unexplained).json(), {
        ok: true, state: "my-sets", read: "unconfirmed",
      });
      assert.equal(broker.next(broker.pairingToken(), client), null);
      const unavailable = post({});
      await next("session.observe", "my-sets");
      let unavailableJob = broker.next(broker.pairingToken(), client);
      for (let attempt = 0; !unavailableJob && attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        unavailableJob = broker.next(broker.pairingToken(), client);
      }
      assert.ok(unavailableJob);
      assert.equal(unavailableJob.command.kind, "sets.list");
      assert.equal(broker.complete(broker.pairingToken(), {
        schemaVersion: 1, id: unavailableJob.id,
        ok: false, code: "blooket-browser-unavailable",
      }, client), true);
      assert.deepEqual(await (await unavailable).json(), {
        ok: true, state: "my-sets", read: "unconfirmed",
      });
      assert.equal(broker.next(broker.pairingToken(), client), null);
      const falseCompleteness = post({});
      await next("session.observe", "my-sets");
      await next("sets.list", { completeness: "complete", items: [{
        schemaVersion: 1, id: "synthetic-set", title: "Synthetic",
      }] });
      assert.deepEqual(await (await falseCompleteness).json(), {
        ok: true, state: "my-sets", read: "unconfirmed",
      });
      const unknown = post({});
      await next("session.observe", "fabricated-state");
      assert.deepEqual(await (await unknown).json(), {
        ok: false, code: "blooket-session-unconfirmed",
      });
      assert.equal(broker.status().pending, 0);
    } finally {
      service.server.close();
      service.server.closeAllConnections();
      broker.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("two paired browsers cannot silently redirect teacher reads or focus",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "two-browser-profiles-"));
  let tick = 100_000;
  const broker = createBlooketBrowserBridgeBroker({
    token: "synthetic-conflicting-profiles-bridge-authenticated-token",
    now: () => tick,
  });
  const service = await startBrowserService({
    root, port: 0, browserBridge: broker,
  });
  try {
    const boot = await (
      await fetch(service.origin + "/api/bootstrap")
    ).json() as { csrf: string };
    const post = (route: string) => fetch(service.origin + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-CSRF-Token": boot.csrf,
        Origin: service.origin,
      },
      body: "{}",
    });
    broker.next(broker.pairingToken(),
      "chrome-extension://synthetic-chrome-profile/");
    tick += 250;
    broker.next(broker.pairingToken(),
      "chrome-extension://synthetic-safari-profile/");
    const status = (await (
      await fetch(service.origin + "/api/bootstrap")
    ).json() as { browserBridge: {
      connected: boolean; multipleBrowserClients: boolean;
    } }).browserBridge;
    assert.equal(status.connected, false);
    assert.equal(status.multipleBrowserClients, true);
    for (const route of [
      "/api/blooket-connected-tab-focus",
      "/api/blooket-readiness-check",
    ]) {
      const response = await post(route);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        ok: false, code: "blooket-browser-multiple-clients",
      });
    }
    assert.equal(broker.status().pending, 0);
    tick += 10_100;
    broker.next(broker.pairingToken(),
      "chrome-extension://synthetic-chrome-profile/");
    assert.equal(broker.status().connected, true);
    assert.equal(broker.status().multipleBrowserClients, false);
  } finally {
    service.server.close();
    service.server.closeAllConnections();
    broker.close();
    await rm(root, { recursive: true, force: true });
  }
  },
);

test("same extension ID with different browser profiles remains distinct",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "distinct-browser-profiles-"));
  const broker = createBlooketBrowserBridgeBroker({
    token: "synthetic-per-profile-extension-identification-token",
  });
  const service = await startBrowserService({
    root, port: 0, browserBridge: broker,
  });
  try {
    const extensionOrigin = "chrome-extension://same-fixture-extension";
    const headers = (profile: string) => ({
      Authorization: "Bearer " + broker.pairingToken(),
      Origin: extensionOrigin,
      "x-blooket-browser-client": extensionOrigin + "/#" + profile,
    });
    const first = headers("89aa67d6-4253-4013-9a54-68c37ce9e2af");
    const second = headers("d861f680-3afd-444a-9994-12058e349f18");
    const pending = broker.request({ kind: "browser.activate" });
    const next = await fetch(service.origin + "/api/browser-bridge/next",
      { headers: first });
    assert.equal(next.status, 200);
    const job = (await next.json() as { job: {
      id: string; command: { kind: string };
    } }).job;
    assert.equal(job.command.kind, "browser.activate");
    const wrongProfile = await fetch(
      service.origin + "/api/browser-bridge/result", {
        method: "POST",
        headers: { ...second, "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1, id: job.id, ok: true,
          value: { focused: true },
        }),
      },
    );
    assert.equal(wrongProfile.status, 400);
    const rightProfile = await fetch(
      service.origin + "/api/browser-bridge/result", {
        method: "POST",
        headers: { ...first, "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1, id: job.id, ok: true,
          value: { focused: true },
        }),
      },
    );
    assert.equal(rightProfile.status, 200);
    assert.deepEqual(await pending, {
      ok: true, value: { focused: true },
    });
    const secondPoll = await fetch(
      service.origin + "/api/browser-bridge/next", { headers: second },
    );
    assert.equal(secondPoll.status, 200);
    assert.equal(broker.status().multipleBrowserClients, true);
    assert.equal(broker.status().connected, false);
    assert.equal(broker.status().pending, 0);
  } finally {
    service.server.close();
    service.server.closeAllConnections();
    broker.close();
    await rm(root, { recursive: true, force: true });
  }
  },
);
