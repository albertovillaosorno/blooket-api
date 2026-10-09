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
//   - Authenticated Streamable HTTP and OAuth discovery routes.
// - Must-Not:
//   - Expose the local settings UI or general API routes.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Only those admitted by this owning boundary.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Authenticated Streamable HTTP and OAuth discovery routes.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";
import { startMcpGateway } from
  "../../../../src/mcp/streamable-gateway/adapter-inbound/gateway.ts";

test(
  "remote gateway authenticates calls and projects " +
    "tools through the canonical CLI",
  async t => {
    const root = await mkdtemp(join(tmpdir(), "mcp-gateway-"));
    const gateway = await startMcpGateway({
      publicUrl: "https://teacher.example/mcp",
      dataRoot: root,
      port: 0,
    });
    const address = gateway.server.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    const send = async (
      path: string,
      method = "GET",
      body = "",
      headers: Record<string, string> = {},
    ) =>
      await new Promise<{
        status: number;
        headers: Record<string, unknown>;
        body: string;
      }>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method,
            headers: { Host: "teacher.example", ...headers },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (data: Buffer) => chunks.push(data));
            res.on("end", () =>
              resolve({
                status: res.statusCode!,
                headers: res.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        req.once("error", reject);
        req.end(body);
      });
    try {
      const unauthenticated = await send("/mcp", "POST", "{}");
      assert.equal(unauthenticated.status, 401);
      assert.ok(unauthenticated.headers["www-authenticate"]);
      assert.equal((await send("/api/settings")).status, 404);
      assert.equal(
        (
          await send("/.well-known/oauth-authorization-server", "GET", "", {
            Origin: "https://evil.example",
          })
        ).status,
        403,
      );
      const metadata = JSON.parse(
        (await send("/.well-known/oauth-protected-resource/mcp")).body,
      ) as { resource: string };
      assert.equal(metadata.resource, "https://teacher.example/mcp");
      const registered = JSON.parse(
        (
          await send(
            "/oauth/register",
            "POST",
            JSON.stringify({
              client_name: "Test",
              redirect_uris: ["https://client.example/callback"],
              token_endpoint_auth_method: "none",
            }),
            { "Content-Type": "application/json" },
          )
        ).body,
      ) as { client_id: string };
      const verifier = "z".repeat(64),
        challenge = createHash("sha256").update(verifier).digest("base64url");
      const authorization = await send(
        "/oauth/authorize?" +
          new URLSearchParams({
            response_type: "code",
            client_id: registered.client_id,
            redirect_uri: "https://client.example/callback",
            resource: metadata.resource,
            code_challenge: challenge,
            code_challenge_method: "S256",
          }),
      );
      const cookie = (
        authorization.headers["set-cookie"] as string[]
      )[0]!.split(";")[0]!;
      assert.equal(
        (await send("/oauth/wait", "GET", "", { Cookie: cookie })).status,
        200,
      );
      gateway.approve(gateway.pending()[0]!.id);
      const redirected = await send("/oauth/wait", "GET", "", {
        Cookie: cookie,
      });
      assert.equal(redirected.status, 302);
      const code = new URL(
        redirected.headers["location"] as string,
      ).searchParams.get("code")!;
      const exchanged = await send(
        "/oauth/token",
        "POST",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: registered.client_id,
          redirect_uri: "https://client.example/callback",
          resource: metadata.resource,
          code,
          code_verifier: verifier,
        }).toString(),
        { "Content-Type": "application/x-www-form-urlencoded" },
      );
      const token = (JSON.parse(exchanged.body) as { access_token: string })
        .access_token;
      const rpcHeaders = {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      };
      const call = async (method: string, params: unknown) =>
        await send(
          "/mcp",
          "POST",
          JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          rpcHeaders,
        );
      assert.equal(
        (await call("initialize", { protocolVersion: "2025-11-25" })).status,
        200,
      );
      const listed = JSON.parse((await call("tools/list", {})).body) as {
        result: {
          tools: {
            name: string;
            inputSchema: {
              required?: string[];
              properties?: Record<string, unknown>;
            };
          }[];
        };
      };
      assert.ok(
        listed.result.tools.some((tool) => tool.name === "instructions_get"),
      );
      assert.ok(listed.result.tools.some((tool) => tool.name === "skills_put"));
      const enrichment = listed.result.tools.find(
        (tool) => tool.name === "library_enrich",
      );
      assert.ok(enrichment);
      assert.ok(enrichment.inputSchema.required?.includes("language"));
      assert.ok(enrichment.inputSchema.properties?.["language"]);
      assert.equal(
        listed.result.tools.some((tool) =>
          /settings|password|shell/u.test(tool.name),
        ),
        false,
      );
      const instructions = JSON.parse(
        (
          await call("tools/call", {
            name: "instructions_get",
            arguments: {},
          })
        ).body,
      ) as { result: { isError: boolean; content: { text: string }[] } };
      assert.equal(instructions.result.isError, false);
      const instructionEnvelope = JSON.parse(
        instructions.result.content[0]!.text,
      ) as { ok: boolean; value: { text: string } };
      assert.equal(instructionEnvelope.ok, true);
      assert.match(
        instructionEnvelope.value.text,
        /Teacher agent instructions/u,
      );
      assert.doesNotMatch(
        instructionEnvelope.value.text,
        /reference\/curated/u,
      );
      const executed = JSON.parse(
        (await call("tools/call", { name: "skills_list", arguments: {} })).body,
      ) as { result: { isError: boolean; content: { text: string }[] } };
      assert.equal(executed.result.isError, false);
      const envelope = JSON.parse(executed.result.content[0]!.text) as {
        ok: boolean;
        value: unknown[];
        operationId: string;
      };
      assert.equal(envelope.ok, true);
      assert.deepEqual(envelope.value, []);
      assert.match(envelope.operationId, /^mcp:/u);
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      let childOperation = "";
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), kill: () => true,
      });
      child.stdin.once("data", data => {
        const command = JSON.parse(data.toString());
        assert.equal(command.command, "skills.put");
        childOperation = command.operationId;
        entered();
      });
      const spawn = t.mock.method(childProcess, "spawn", () => child);
      syncBuiltinESMExports();
      try {
        const pendingCall = call("tools/call", { name: "skills_put",
          arguments: { id: "synthetic-guidance", text: "Synthetic",
            expectedRevision: null },
        }).catch(() => undefined);
        await started;
        gateway.revokeAll();
        assert.equal((await call("tools/list", {})).status, 401);
        let stopped = false;
        const draining = gateway.quiesce();
        assert.equal(gateway.quiesce(), draining);
        void draining.then(() => { stopped = true; });
        await nextTurn();
        assert.equal(stopped, false);
        assert.deepEqual(gateway.connections(), []);
        child.stdout.emit("data", Buffer.from(JSON.stringify({
          version: 1, operationId: childOperation, ok: true, value: {},
        })));
        child.emit("exit", 0);
        await nextTurn();
        assert.equal(stopped, false);
        child.emit("close", 0);
        await draining;
        await pendingCall;
        assert.equal(stopped, true);
        assert.equal(gateway.server.listening, false);
      } finally {
        child.emit("close", 0);
        spawn.mock.restore();
        syncBuiltinESMExports();
      }
    } finally {
      await gateway.quiesce();
      await rm(root, { recursive: true, force: true });
    }
  },
);
