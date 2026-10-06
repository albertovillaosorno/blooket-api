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
import type { OnlineConnectionController } from
  "../../online-connection/contract/controller.ts";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decodeCommandEnvelope } from
  "../../../ir/wire-envelopes/contract/command-envelope.ts";
import { executeCommand } from
  "../../command-execution/application/execute-command.ts";
import {
  loadPreferences,
  userDataRoot,
} from "../../../platforms/user-storage/adapter-outbound/root.ts";
import {
  initializeLibrary,
  listLibrary,
  safeLibraryPath,
} from "../../../platforms/user-library/adapter-outbound/files.ts";
import {
  importLibraryImage,
  editLibraryImage,
  prepareLibraryImage,
  safeCode,
} from "../../teacher-library/application/library.ts";
import {
  configurationStatus,
  saveConfiguration,
  chooseMediaFolder,
  runFirstUseDiagnostics,
} from "../../teacher-configuration/application/configuration.ts";
import { createHostSecretStore } from
  "../../../platforms/host-secret-store/adapter-outbound/host-secret-store.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";

export async function readBody(
  request: IncomingMessage,
  limit = 1_000_000,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > limit) throw new Error("request-too-large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function json(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
export async function startBrowserService(
  options: {
    root?: string;
    port?: number;
    online?: OnlineConnectionController;
    secrets?: HostSecretStore;
  } = {},
) {
  const root = options.root ?? userDataRoot();
  const secrets = options.secrets ?? createHostSecretStore();
  const preferences = await loadPreferences(root);
  await initializeLibrary(preferences.mediaRoot);
  const diagnostic = await runFirstUseDiagnostics(root);
  const csrf = randomBytes(32).toString("base64url");
  let origin = "";
  const staticRoot = new URL(
    "../../../ui/teacher-workspace/adapter-inbound/",
    import.meta.url,
  );
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent)
        json(response, 400, { ok: false, code: safeCode(error) });
      else response.end();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  let active = 0;
  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src " +
        "'self' 'unsafe-inline'; img-src 'self' blob: " +
        "data:; connect-src 'self'; frame-ancestors 'none'; " +
        "base-uri 'none'; form-action 'self'",
    );
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== origin)
    ) {
      json(response, 403, { ok: false, code: "invalid-origin" });
      return;
    }
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "GET") {
      const files: Record<string, [string, string]> = {
        "/": ["index.html", "text/html"],
        "/app.js": ["app.js", "text/javascript"],
        "/style.css": ["style.css", "text/css"],
      };
      const asset = files[url.pathname];
      if (asset) {
        response.writeHead(200, {
          "Content-Type": asset[1] + "; charset=utf-8",
        });
        response.end(
          await readFile(fileURLToPath(new URL(asset[0], staticRoot))),
        );
        return;
      }
      if (url.pathname === "/api/bootstrap") {
        json(response, 200, {
          csrf,
          ...(await configurationStatus(root, secrets)),
          diagnostic,
          onlineStatus: options.online?.status() ?? {
            state: "disabled",
            gatewayPort: 2608,
          },
        });
        return;
      }
      if (url.pathname === "/api/connections") {
        json(response, 200, {
          requests: options.online?.pending() ?? [],
          status: options.online?.status() ?? { state: "disabled" },
        });
        return;
      }
      if (url.pathname === "/api/media") {
        json(
          response,
          200,
          await listLibrary((await loadPreferences(root)).mediaRoot),
        );
        return;
      }
      if (url.pathname.startsWith("/media/")) {
        const id = url.pathname.slice(7);
        const library = (await loadPreferences(root)).mediaRoot;
        const record = (await listLibrary(library)).find(
          (entry) => entry.id === id,
        );
        if (!record) {
          json(response, 404, { code: "media-not-found" });
          return;
        }
        const prepared = url.searchParams.get("variant") === "prepared";
        if (prepared && record.prepared === null) {
          json(response, 409, { code: "media-not-prepared" });
          return;
        }
        const file = prepared ? record.prepared!.file : record.asset;
        const path = await safeLibraryPath(library, file);
        const size = (await lstat(path)).size;
        if (size > (prepared ? 2_499_999 : 25_000_000))
          throw new Error("media-byte-limit-exceeded");
        response.writeHead(200, {
          "Content-Type": file.endsWith(".gif")
            ? "image/gif"
            : file.endsWith(".png")
              ? "image/png"
              : file.endsWith(".webp")
                ? "image/webp"
                : "image/jpeg",
        });
        response.end(await readFile(path));
        return;
      }
      json(response, 404, { code: "not-found" });
      return;
    }
    if (request.method !== "POST") {
      json(response, 405, { code: "method-not-allowed" });
      return;
    }
    if (
      request.headers["x-csrf-token"] !== csrf ||
      request.headers.origin !== origin ||
      !request.headers["content-type"]?.startsWith("application/json")
    ) {
      json(response, 403, { code: "invalid-local-request" });
      return;
    }
    if (active >= 2) {
      json(response, 429, { code: "service-busy" });
      return;
    }
    active += 1;
    try {
      const body = await readBody(
        request,
        url.pathname === "/api/import" ? 36_000_000 : 1_000_000,
      );
      if (url.pathname === "/api/settings") {
        const saved = await saveConfiguration(root, body, secrets);
        if (saved.ok) await options.online?.reload();
        json(response, 200, {
          ...saved,
          onlineStatus: options.online?.status() ?? { state: "disabled" },
        });
        return;
      }
      if (url.pathname === "/api/connection-approve") {
        if (
          !body ||
          typeof body !== "object" ||
          Object.keys(body).join() !== "id" ||
          !("id" in body) ||
          typeof body.id !== "string"
        )
          throw new Error("invalid-connection-request");
        if (!options.online) throw new Error("online-unavailable");
        options.online.approve(body.id);
        json(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/online-retry") {
        await options.online?.reload();
        json(response, 200, options.online?.status() ?? { state: "disabled" });
        return;
      }
      if (url.pathname === "/api/stop") {
        json(response, 200, { ok: true });
        await options.online?.stop();
        server.close();
        server.closeAllConnections();
        return;
      }
      if (url.pathname === "/api/folder") {
        json(response, 200, { path: await chooseMediaFolder() });
        return;
      }
      if (url.pathname === "/api/diagnostics") {
        json(response, 200, await runFirstUseDiagnostics(root, true));
        return;
      }
      if (url.pathname === "/api/import") {
        json(response, 200, await importLibraryImage(root, body));
        return;
      }
      if (url.pathname === "/api/edit") {
        json(response, 200, await editLibraryImage(root, body));
        return;
      }
      if (url.pathname === "/api/prepare") {
        if (
          typeof body !== "object" ||
          body === null ||
          Object.keys(body).join() !== "id" ||
          !("id" in body) ||
          typeof body.id !== "string"
        )
          throw new Error("invalid-prepare-request");
        json(response, 200, await prepareLibraryImage(root, body.id));
        return;
      }
      if (url.pathname === "/api/command") {
        const decoded = decodeCommandEnvelope(body);
        if (!decoded.ok) {
          json(response, 400, decoded);
          return;
        }
        json(response, 200, await executeCommand(decoded.value, root));
        return;
      }
      json(response, 404, { code: "not-found" });
    } finally {
      active -= 1;
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? preferences.service.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("invalid-service-address");
  origin = "http://127.0.0.1:" + address.port;
  return { server, origin, root, operationId: () => "http:" + randomUUID() };
}
