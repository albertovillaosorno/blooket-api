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
//   - Portable consent and online lifecycle regression tests.
// - Must-Not:
//   - Use real credentials, connect a tunnel, or mutate Blooket.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Disposable local listeners/files and fake tunnels.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Portable consent and online lifecycle regression tests.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { createOnlineConnection } from
  "../../../../src/service/online-service/application/connection.ts";
import { startMcpGateway } from
  "../../../../src/mcp/streamable-gateway/adapter-inbound/gateway.ts";
import { createOwnerPasswordVerifier } from
  "../../../../src/security/owner-password/domain/verifier.ts";
import {
  loadPreferences,
  savePreferences,
} from "../../../../src/platforms/user-storage/adapter-outbound/root.ts";

test(
  "composition checks owner consent before " + "approving and serializes stop",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "online-owner-"));
    const verifier = await createOwnerPasswordVerifier("owner-fixture");
    let ownerConfigured = false;
    let stopped = 0;
    let gateway: Awaited<ReturnType<typeof startMcpGateway>> | undefined;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pauseStartup = false;
    const controller = createOnlineConnection(
      root,
      {
        read: async (name) =>
          name === "mcp.owner-verifier"
            ? ownerConfigured
              ? { ok: true, kind: "found", secret: verifier }
              : { ok: true, kind: "missing" }
            : { ok: true, kind: "found", secret: "synthetic-tunnel-token" },
        write: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
      },
      {
        startGateway: async (options) => {
          if (pauseStartup) {
            entered();
            await paused;
          }
          gateway = await startMcpGateway({ ...options, port: 0 });
          return gateway;
        },
        startTunnel: (_token, update) => {
          update("connected");
          return {
            stop: async () => {
              stopped++;
            },
          };
        },
      },
    );
    try {
      const preferences = await loadPreferences(root);
      await savePreferences(root, {
        ...preferences,
        online: {
          ...preferences.online,
          enabled: true,
          publicUrl: "https://teacher.example/mcp",
        },
      });
      await controller.reload(35100);
      assert.equal(
        (controller.status() as { state: string }).state,
        "owner-password-missing",
      );
      assert.equal(gateway, undefined);
      ownerConfigured = true;
      await controller.reload(35100);
      assert.equal(
        (controller.status() as { gatewayPort: number }).gatewayPort,
        35101,
      );
      assert.ok(gateway);
      const address = gateway.server.address();
      assert.ok(address && typeof address !== "string");
      const send = (path: string, method = "GET", body = "") =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = request(
            {
              hostname: "127.0.0.1",
              port: address.port,
              path,
              method,
              headers: {
                Host: "teacher.example",
                "Content-Type": "application/json",
              },
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on("data", (chunk: Buffer) => chunks.push(chunk));
              response.on("end", () =>
                resolve({
                  status: response.statusCode!,
                  body: Buffer.concat(chunks).toString("utf8"),
                }),
              );
            },
          );
          req.on("error", reject);
          req.end(body);
        });
      const registration = await send(
        "/oauth/register",
        "POST",
        JSON.stringify({
          client_name: "Untrusted fixture name",
          redirect_uris: ["https://client.example/callback"],
          token_endpoint_auth_method: "none",
        }),
      );
      assert.equal(registration.status, 201);
      const registered = JSON.parse(registration.body) as { client_id: string };
      const params = new URLSearchParams({
        response_type: "code",
        client_id: registered.client_id,
        redirect_uri: "https://client.example/callback",
        resource: "https://teacher.example/mcp",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update("v".repeat(64))
          .digest("base64url"),
      });
      assert.equal((await send("/oauth/authorize?" + params)).status, 200);
      const pending = controller.pending() as { id: string }[];
      await assert.rejects(controller.approve(pending[0]!.id, "wrong"));
      assert.equal((controller.pending() as unknown[]).length, 1);
      await controller.approve(pending[0]!.id, "owner-fixture");
      assert.deepEqual(controller.pending(), []);
      pauseStartup = true;
      const reload = controller.reload(35100);
      await started;
      const stop = controller.stop();
      release();
      await Promise.all([reload, stop]);
      assert.equal(
        (controller.status() as { state: string }).state,
        "disabled",
      );
      assert.equal(stopped, 2);
    assert.equal(gateway.server.listening, false);
    await controller.reload(35100);
    assert.equal(gateway.server.listening, false);
    } finally {
      release();
      await controller.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("tunnel stop failure still closes the authenticated gateway", async () => {
  const root = await mkdtemp(join(tmpdir(), "online-stop-failure-"));
  const verifier = await createOwnerPasswordVerifier("owner-fixture");
  let gateway: Awaited<ReturnType<typeof startMcpGateway>> | undefined;
  const controller = createOnlineConnection(
    root,
    {
      read: async (name) =>
        name === "mcp.owner-verifier"
          ? { ok: true, kind: "found", secret: verifier }
          : { ok: true, kind: "found", secret: "synthetic-tunnel-token" },
      write: async () => ({ ok: true }),
      delete: async () => ({ ok: true }),
    },
    {
      startGateway: async (options) => {
        gateway = await startMcpGateway({ ...options, port: 0 });
        return gateway;
      },
      startTunnel: (_token, update) => {
        update("connected");
        return {
          stop: async () => {
            throw new Error("synthetic-tunnel-stop-failure");
          },
        };
      },
    },
  );
  try {
    const preferences = await loadPreferences(root);
    await savePreferences(root, {
      ...preferences,
      online: {
        ...preferences.online,
        enabled: true,
        publicUrl: "https://teacher.example/mcp",
      },
    });
    await controller.reload(35200);
    assert.ok(gateway?.server.listening);
    await assert.rejects(
      controller.stop(),
      /synthetic-tunnel-stop-failure/u,
    );
    assert.equal(gateway.server.listening, false);
    assert.equal(
      (controller.status() as { state: string }).state,
      "disabled",
    );
  } finally {
    await controller.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "missing tunnel token and gateway bounds stop before disablement cleanup",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "online-prerequisites-"));
    let tokenConfigured = false;
    let tunnelStarts = 0;
    let tunnelStops = 0;
    let gateway: Awaited<ReturnType<typeof startMcpGateway>> | undefined;
    const controller = createOnlineConnection(
      root,
      {
        read: async (name) =>
          name === "mcp.owner-verifier"
            ? { ok: true, kind: "found", secret: "fixture-owner" }
            : tokenConfigured
              ? { ok: true, kind: "found", secret: "fixture-token" }
              : { ok: true, kind: "missing" },
        write: async () => ({ ok: true }),
        delete: async () => ({ ok: true }),
      },
      {
        startGateway: async (options) => {
          gateway = await startMcpGateway({ ...options, port: 0 });
          return gateway;
        },
        startTunnel: (_token, update) => {
          tunnelStarts++;
          update("connected");
          return {
            stop: async () => {
              tunnelStops++;
            },
          };
        },
      },
    );
    try {
      const preferences = await loadPreferences(root);
      await savePreferences(root, {
        ...preferences,
        online: {
          ...preferences.online,
          enabled: true,
          publicUrl: "https://teacher.example/mcp",
        },
      });

      await controller.reload(35300);
      assert.equal(
        (controller.status() as { state: string }).state,
        "tunnel-token-missing",
      );
      assert.equal(gateway, undefined);
      assert.equal(tunnelStarts, 0);

      tokenConfigured = true;
      await controller.reload(65535);
      assert.equal(
        (controller.status() as { state: string }).state,
        "gateway-port-unavailable",
      );
      assert.equal(gateway, undefined);
      assert.equal(tunnelStarts, 0);

      await controller.reload(35300);
      assert.equal(
        (controller.status() as { state: string }).state,
        "connected",
      );
      assert.equal(tunnelStarts, 1);
      assert.ok(gateway?.server.listening);

      await savePreferences(root, {
        ...preferences,
        online: {
          ...preferences.online,
          enabled: false,
          publicUrl: "",
        },
      });
      await controller.reload(35300);
      assert.equal(
        (controller.status() as { state: string }).state,
        "disabled",
      );
      assert.equal(tunnelStops, 1);
      assert.equal(gateway.server.listening, false);
    } finally {
      await controller.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
);
