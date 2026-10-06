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
      assert.match(
        await (await fetch(service.origin)).text(),
        /Blooket Studio/u,
      );
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
          filename: "Sample.png",
          name: "Sample",
          description: "Sample image",
          language: "en",
          topics: [],
          base64: Buffer.from(source).toString("base64"),
        })
      ).json()) as { id: string };
      assert.ok(imported.id);
      const prepared = (await (
        await post("/api/prepare", { id: imported.id })
      ).json()) as { prepared: { file: string; bytes: number } };
      assert.ok(prepared.prepared.bytes < 2_500_000);
      assert.equal(
        (
          await fetch(
            service.origin + "/media/" + imported.id + "?variant=prepared",
          )
        ).status,
        200,
      );
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
      ).json()) as { ok: boolean; value: unknown[] };
      assert.equal(command.ok, true);
      assert.equal(command.value.length, 1);
    } finally {
      await new Promise<void>((resolve) => {
        service.server.close(() => resolve());
        service.server.closeAllConnections();
      });
      await rm(root, { recursive: true, force: true });
    }
  },
);
