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
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createTeacherAuthorization } from
  "../../teacher-authorization/adapter-inbound/authorization.ts";
import {
  listTeacherTools,
  callTeacherTool,
} from "../../teacher-tools/adapter-inbound/tools.ts";

import { PRODUCT_VERSION } from
  "../../../cli/json-command-process/adapter-inbound/execute.ts";

export async function startMcpGateway(options: {
  publicUrl: string;
  dataRoot: string;
  port: number;
}) {
  const auth = createTeacherAuthorization(options.publicUrl);
  const publicHost = new URL(options.publicUrl).host;
  let active = 0;
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent)
        send(response, 400, { error: "invalid_request" });
      else response.end();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (
      request.headers.host !== publicHost ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== auth.issuer)
    ) {
      send(response, 403, { error: "invalid_origin" });
      return;
    }
    const url = new URL(request.url ?? "/", auth.issuer);
    if (
      request.method === "GET" &&
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ].includes(url.pathname)
    ) {
      send(response, 200, auth.resourceMetadata);
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      send(response, 200, auth.metadata);
      return;
    }
    if (url.pathname === "/oauth/register" && request.method === "POST") {
      send(response, 201, auth.register(JSON.parse(await textBody(request))));
      return;
    }
    if (url.pathname === "/oauth/token" && request.method === "POST") {
      send(
        response,
        200,
        auth.exchange(new URLSearchParams(await textBody(request))),
      );
      return;
    }
    if (url.pathname === "/oauth/authorize" && request.method === "GET") {
      const grant = auth.authorize(url.searchParams);
      response.setHeader(
        "Set-Cookie",
        "blooket-consent=" +
          grant.ticket +
          "; HttpOnly; Secure; SameSite=Lax; Path=/oauth; Max-Age=300",
      );
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; " +
          "frame-ancestors 'none'; form-action 'self'; " +
          "base-uri 'none'",
      );
      response.setHeader("Refresh", "3;url=/oauth/wait");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><meta " +
          "charset=utf-8><title>Connect Blooket " +
          "Studio</title><body style='font:18px " +
          "system-ui;max-width:600px;margin:80px " +
          "auto'><h1>Connect Blooket Studio</h1><p>Open the " +
          "local app on your Mac and approve this " +
          "connection:</p><p><strong>" +
          grant.id +
          ("</strong></p><p>This page will continue when you " +
            "approve it. / Abre la app local y aprueba esta " +
            "conexión.</p></body></html>"),
      );
      return;
    }
    if (url.pathname === "/oauth/wait" && request.method === "GET") {
      const ticket = request.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("blooket-consent="))
        ?.slice(16);
      if (!ticket) {
        send(response, 400, { error: "invalid_request" });
        return;
      }
      const redirect = auth.redirect(ticket);
      if (redirect) {
        response.writeHead(302, { Location: redirect });
        response.end();
      } else {
        response.setHeader("Refresh", "3;url=/oauth/wait");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          "<!doctype html><html><meta " +
            "charset=utf-8><title>Waiting for " +
            "approval</title><body>Waiting for approval in the " +
            "local app. / Esperando aprobación en la app " +
            "local.</body></html>",
        );
      }
      return;
    }
    if (url.pathname !== "/mcp") {
      send(response, 404, { error: "not_found" });
      return;
    }
    if (!auth.authenticate(request.headers.authorization)) {
      response.setHeader(
        "WWW-Authenticate",
        'Bearer resource_metadata="' +
          auth.issuer +
          '/.well-known/oauth-protected-resource/mcp"',
      );
      send(response, 401, { error: "unauthorized" });
      return;
    }
    if (request.method !== "POST") {
      send(response, 405, { error: "method_not_allowed" });
      return;
    }
    const version = request.headers["mcp-protocol-version"];
    if (
      version !== undefined &&
      !["2025-03-26", "2025-06-18", "2025-11-25"].includes(String(version))
    ) {
      send(response, 400, { error: "unsupported_protocol" });
      return;
    }
    if (
      !request.headers["content-type"]?.startsWith("application/json") ||
      !request.headers.accept?.includes("application/json") ||
      !request.headers.accept.includes("text/event-stream")
    ) {
      send(response, 406, { error: "invalid_content_type" });
      return;
    }
    if (active >= 2) {
      send(response, 429, { error: "busy" });
      return;
    }
    active += 1;
    try {
      const parsed: unknown = JSON.parse(await textBody(request, 1_000_000));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("invalid-json-rpc");
      const message = parsed as Record<string, unknown>;
      if (message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string")
        throw new Error("invalid-json-rpc");
      if (!("id" in message)) {
        response.writeHead(202);
        response.end();
        return;
      }
      const id = message["id"];
      if (typeof id !== "number" && typeof id !== "string")
        throw new Error("invalid-json-rpc");
      let result: unknown;
      switch (message["method"]) {
        case "initialize": {
          const params = message["params"] as
            | { protocolVersion?: string }
            | undefined;
          result = {
            protocolVersion:
              params?.protocolVersion &&
              ["2025-03-26", "2025-06-18", "2025-11-25"].includes(
                params.protocolVersion,
              )
                ? params.protocolVersion
                : "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "blooket-api", version: PRODUCT_VERSION },
            instructions:
              "Read personal skills before authoring. Use stable " +
              "media IDs. Original text and filenames belong to " +
              "the teacher. Drafts are not published quizzes. " +
              "Remote access cannot change credentials or " +
              "settings.",
          };
          break;
        }
        case "ping":
          result = {};
          break;
        case "tools/list":
          result = { tools: listTeacherTools() };
          break;
        case "tools/call": {
          const params = message["params"] as
            | { name?: unknown; arguments?: unknown }
            | undefined;
          if (typeof params?.name !== "string")
            throw new Error("invalid-tool-call");
          result = await callTeacherTool(
            params.name,
            params.arguments ?? {},
            options.dataRoot,
          );
          break;
        }
        default:
          send(response, 200, {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "Method not found" },
          });
          return;
      }
      send(response, 200, { jsonrpc: "2.0", id, result });
    } finally {
      active -= 1;
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return {
    server,
    pending: auth.pending,
    approve: auth.approve,
    reject: auth.reject,
    connections: auth.connections,
    revoke: auth.revoke,
    revokeAll: auth.revokeAll,
  };
}
async function textBody(
  request: IncomingMessage,
  limit = 10_000,
): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const data = Buffer.from(chunk as Uint8Array);
    size += data.length;
    if (size > limit) throw new Error("request-too-large");
    chunks.push(data);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}
