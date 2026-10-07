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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { startBrowserService } from
  "../../../../src/api/browser-service/adapter-inbound/server.ts";
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
      assert.match(html, /Blooket Studio/u);
      assert.doesNotMatch(html, /id="importDialog"/u);
      assert.equal((html.match(/id="canvas"/gu) ?? []).length, 1);
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
      assert.match(app, /controller\.signal/u);
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
        (await post("/api/prepare", { id: "missing" }, "https://evil.example"))
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
      ).json()) as { id: string; edit: { zoom: number } };
      assert.ok(imported.id);
      assert.equal(imported.edit.zoom, 0.7);
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
      const prepared = (await (
        await post("/api/prepare", { id: imported.id })
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
      (await post("/api/prepare", { id: imported.id })).status,
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

    const stalePrepare = await post("/api/prepare", { id: imported.id });
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
    const statusOnly = await fetch(
      service.origin + "/api/browser-bridge/status",
      { headers: { Authorization: "Bearer " + boot.browserBridge.token } },
    );
    assert.equal(statusOnly.status, 200);
    const response = await fetch(service.origin + "/api/browser-bridge/next", {
      headers: {
        Authorization: "Bearer " + boot.browserBridge.token,
        Origin: extensionOrigin,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      extensionOrigin,
    );
    const next = (await response.json()) as {
      job: { id: string; command: { kind: string } };
    };
    assert.equal(next.job.command.kind, "sets.list");

    const completed = await fetch(
      service.origin + "/api/browser-bridge/result",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + boot.browserBridge.token,
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
