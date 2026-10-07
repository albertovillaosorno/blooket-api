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
import { createBlooketBrowserBridgeAdapters } from
  "../../blooket-browser-bridge/adapter-outbound/adapters.ts";
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
  savePreferences,
  userDataRoot,
} from "../../../platforms/user-storage/adapter-outbound/root.ts";
import {
  initializeLibrary,
  withLibraryLock,
  exists,
  listLibrary,
  safeLibraryPath,
} from "../../../platforms/user-library/adapter-outbound/files.ts";
import {
  importLibraryImage,
  editLibraryImage,
  prepareLibraryImage,
  readPreparedLibraryImage,
  sampleLibraryImageColors,
  libraryRecordView,
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
import { resolveConfiguredTcpPort } from
  "../../../platforms/tcp-ports/adapter-outbound/tcp-port.ts";
import { installInitialSkills } from
  "../../teacher-library/application/initial-skills.ts";
import { decodeImageSourceRequest } from
  "../../../ir/image-intake/contract/request.ts";
import { downloadImage } from
  "../../../platforms/remote-images/adapter-outbound/download.ts";
import {
  createBlooketBrowserBridgeBroker,
  type BlooketBrowserBridgeBroker,
} from "../../../platforms/blooket-browser/adapter-outbound/broker.ts";

import {
  migrateLegacyLibrary,
  renameLibraryImage,
} from "../../teacher-library/application/transfers.ts";

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
    instance?: string;
    stop?: () => Promise<void>;
    browserBridge?: BlooketBrowserBridgeBroker;
  } = {},
) {
  const root = options.root ?? userDataRoot();
  const secrets = options.secrets ?? createHostSecretStore();
  const preferences = await loadPreferences(root);
  let selectedPort = options.port;
  if (selectedPort === undefined) {
    const resolved = await resolveConfiguredTcpPort(preferences.service);
    if (!resolved.ok) throw new Error(resolved.code);
    selectedPort = resolved.settings.port;
  }
  const bindAddress = preferences.service.bindAddress;
  await initializeLibrary(preferences.mediaRoot);
  await withLibraryLock(preferences.mediaRoot, async () => {});
  await installInitialSkills(root);
  const diagnostic = await runFirstUseDiagnostics(root);
  const csrf = randomBytes(32).toString("base64url");
  const browserBridge =
    options.browserBridge ?? createBlooketBrowserBridgeBroker();
  const blooket = {
    ...createBlooketBrowserBridgeAdapters(browserBridge),
    secrets,
  };
  let origin = "";
  const staticRoot = new URL(
    "../../../ui/teacher-workspace/adapter-inbound/",
    import.meta.url,
  );
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.destroyed) return;
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
    const requestPath = new URL(request.url ?? "/", "http://loopback.invalid")
      .pathname;
    if (requestPath.startsWith("/api/browser-bridge/")) {
      await handleBrowserBridgeRequest(
        request,
        response,
        origin,
        browserBridge,
      );
      return;
    }
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
        "/library.js": ["library.js", "text/javascript"],
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
      const icons: Record<string, [string, string]> = {
        "/icon.svg": ["blooket.svg", "image/svg+xml"],
        "/mcp-icon.png": ["blooket-mcp.png", "image/png"],
      };
      const icon = icons[url.pathname];
      if (icon) {
        const bytes = await readFile(
          new URL("../../../../assets/icon/" + icon[0], import.meta.url),
        );
        response.writeHead(200, { "Content-Type": icon[1] });
        response.end(bytes);
        return;
      }
      if (url.pathname === "/api/service-status" && options.instance) {
        json(response, 200, {
          version: 1,
          pid: process.pid,
          instance: options.instance,
          origin,
        });
        return;
      }
      if (url.pathname === "/api/bootstrap") {
        json(response, 200, {
          csrf,
          ...(await configurationStatus(root, secrets)),
          diagnostic,
          service: {
            origin,
            lifecycle: "explicit-background-process",
            launchAtLogin: preferences.service.launchAtLogin
              ? "not-implemented"
              : "disabled",
          },
          onlineStatus: options.online?.status() ?? {
            state: "disabled",
            gatewayPort: 2608,
          },
          browserBridge: {
            application: "blooket-studio",
            schemaVersion: 1,
            token: browserBridge.pairingToken(),
            ...browserBridge.status(),
          },
        });
        return;
      }
      if (url.pathname === "/api/connections") {
        json(response, 200, {
          requests: options.online?.pending() ?? [],
          connections: options.online?.connections() ?? [],
          status: options.online?.status() ?? { state: "disabled" },
        });
        return;
      }
      if (url.pathname === "/api/library-status") {
        const library = (await loadPreferences(root)).mediaRoot;
        json(response, 200, {
          legacyAvailable: await exists(
            await safeLibraryPath(library, "media.jsonl"),
          ),
        });
        return;
      }
      if (url.pathname === "/api/media") {
        json(
          response,
          200,
          (await listLibrary(
            (await loadPreferences(root)).mediaRoot,
          )).map(libraryRecordView),
        );
        return;
      }
      if (url.pathname.startsWith("/media/")) {
        const id = url.pathname.slice(7);
        const library = (await loadPreferences(root)).mediaRoot;
        if (url.searchParams.get("variant") === "prepared") {
          const revision = url.searchParams.get("revision");
          if (revision !== null && !/^[1-9][0-9]{0,15}$/u.test(revision))
            throw new Error("invalid-prepared-revision");
          const image = await readPreparedLibraryImage(
            library,
            id,
            revision === null ? undefined : Number(revision),
          );
          response.writeHead(200, {
            "Content-Type": image.file.endsWith(".gif")
              ? "image/gif"
              : image.file.endsWith(".jpg")
                ? "image/jpeg"
                : "image/png",
          });
          response.end(image.bytes);
          return;
        }
        const record = (await listLibrary(library)).find(
          (entry) => entry.id === id,
        );
        if (!record) {
          json(response, 404, { code: "media-not-found" });
          return;
        }
        const file = record.asset;
        const path = await safeLibraryPath(library, file);
        const size = (await lstat(path)).size;
        if (size > 25_000_000) throw new Error("media-byte-limit-exceeded");
        response.writeHead(200, {
          "Content-Type": file.toLowerCase().endsWith(".gif")
            ? "image/gif"
            : file.toLowerCase().endsWith(".png")
              ? "image/png"
              : file.toLowerCase().endsWith(".webp")
                ? "image/webp"
                : file.toLowerCase().endsWith(".avif")
                  ? "image/avif"
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
      if (url.pathname === "/api/service-stop" && options.stop) {
        const body = await readBody(request);
        if (
          typeof body !== "object" ||
          body === null ||
          Array.isArray(body) ||
          Object.keys(body).length !== 0
        )
          throw new Error("invalid-service-stop");
        response.once("finish", () => {
          void options.stop!();
        });
        json(response, 202, { ok: true });
        return;
      }
      const body = await readBody(
        request,
        ["/api/import", "/api/media-color-samples"].includes(url.pathname)
          ? 36_000_000
          : 1_000_000,
      );
      if (url.pathname === "/api/browser-pairing-reset") {
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).length !== 0
        )
          throw new Error("invalid-browser-pairing-request");
        browserBridge.resetPairing();
        json(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/settings") {
        const saved = await saveConfiguration(root, body, secrets);
        if (saved.ok || saved.secretsSaved.includes("ownerPassword"))
          await options.online?.reload(localPort);
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
          Object.keys(body).sort().join() !== "id,password" ||
          !("id" in body) ||
          typeof body.id !== "string" ||
          !("password" in body) ||
          typeof body.password !== "string" ||
          Buffer.byteLength(body.password, "utf8") > 2048
        )
          throw new Error("invalid-connection-request");
        if (!options.online) throw new Error("online-unavailable");
        await options.online.approve(body.id, body.password);
        json(response, 200, { ok: true });
        return;
      }
      if (
        ["/api/connection-reject", "/api/connection-revoke"].includes(
          url.pathname,
        )
      ) {
        if (
          !body ||
          typeof body !== "object" ||
          Object.keys(body).join() !== "id" ||
          !("id" in body) ||
          typeof body.id !== "string"
        )
          throw new Error("invalid-connection-request");
        if (!options.online) throw new Error("online-unavailable");
        if (url.pathname === "/api/connection-reject")
          options.online.reject(body.id);
        else options.online.revoke(body.id);
        json(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/online-retry") {
        await options.online?.reload();
        json(response, 200, options.online?.status() ?? { state: "disabled" });
        return;
      }
      if (url.pathname === "/api/stop") {
        response.once("finish", () => {
          if (options.stop) void options.stop();
          else
            void Promise.resolve(options.online?.stop()).finally(() => {
              server.close();
              server.closeAllConnections();
            });
        });
        json(response, 200, { ok: true });
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
      if (url.pathname === "/api/library-migrate") {
        if (
          !body ||
          typeof body !== "object" ||
          Object.keys(body).join() !== "confirm" ||
          !("confirm" in body) ||
          body.confirm !== true
        )
          throw new Error("migration-confirmation-required");
        json(response, 200, await migrateLegacyLibrary(root));
        return;
      }
      if (url.pathname === "/api/media-rename") {
        json(response, 200, await renameLibraryImage(root, body));
        return;
      }
      if (url.pathname === "/api/media-color-samples") {
        json(response, 200, await sampleLibraryImageColors(root, body));
        return;
      }
      if (url.pathname === "/api/import") {
        json(response, 200, await importLibraryImage(root, body));
        return;
      }
      if (url.pathname === "/api/image-source") {
        const image = await downloadImage(decodeImageSourceRequest(body));
        response.writeHead(200, {
          "Content-Type": image.type,
          "X-Content-Type-Options": "nosniff",
        });
        response.end(image.bytes);
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
        const controller = new AbortController();
        const cancel = () => controller.abort();
        request.once("aborted", cancel);
        response.once("close", cancel);
        try {
          const prepared = await prepareLibraryImage(root, body.id, {
            signal: controller.signal,
          });
          if (!response.destroyed) json(response, 200, prepared);
        } finally {
          request.removeListener("aborted", cancel);
          response.removeListener("close", cancel);
        }
        return;
      }
      if (url.pathname === "/api/command") {
        const decoded = decodeCommandEnvelope(body);
        if (!decoded.ok) {
          json(response, 400, decoded);
          return;
        }
        json(response, 200, await executeCommand(decoded.value, root, blooket));
        return;
      }
      json(response, 404, { code: "not-found" });
    } finally {
      active -= 1;
    }
  }
  async function listen(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        server.removeListener("listening", ready);
        reject(error);
      };
      const ready = () => {
        server.removeListener("error", failed);
        resolve();
      };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen({ port, host: bindAddress, exclusive: true });
    });
  }
  try {
    await listen(selectedPort);
  } catch (error) {
    if (
      options.port === undefined &&
      preferences.service.portMode === "automatic" &&
      error instanceof Error &&
      "code" in error &&
      error.code === "EADDRINUSE"
    )
      await listen(0);
    else throw new Error("configured-port-unavailable");
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("invalid-service-address");
  const localPort = address.port;
  origin =
    "http://" +
    (bindAddress === "::1" ? "[::1]" : bindAddress) +
    ":" +
    localPort;
  try {
    if (options.port === undefined && localPort !== preferences.service.port)
      await savePreferences(root, {
        ...preferences,
        service: { ...preferences.service, port: localPort },
      });
  } catch {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    throw new Error("settings-save-failed");
  }
  server.once("close", () => browserBridge.close());
  return {
    server,
    origin,
    root,
    port: localPort,
    browserBridge,
    operationId: () => "http:" + randomUUID(),
  };
}

async function handleBrowserBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  serviceOrigin: string,
  bridge: BlooketBrowserBridgeBroker,
): Promise<void> {
  if (request.headers.host !== new URL(serviceOrigin).host) {
    json(response, 403, { ok: false, code: "invalid-origin" });
    return;
  }
  const extensionOrigin = request.headers.origin;
  const allowedOrigin =
    extensionOrigin === undefined ||
    extensionOrigin.startsWith("chrome-extension://") ||
    extensionOrigin.startsWith("safari-web-extension://");
  if (!allowedOrigin) {
    json(response, 403, { ok: false, code: "invalid-origin" });
    return;
  }
  if (extensionOrigin !== undefined) {
    response.setHeader("Access-Control-Allow-Origin", extensionOrigin);
    response.setHeader("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.writeHead(204);
    response.end();
    return;
  }

  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!bridge.authenticated(token)) {
    json(response, 401, { ok: false, code: "invalid-browser-bridge-token" });
    return;
  }
  const path = new URL(request.url ?? "/", "http://loopback.invalid").pathname;
  if (path === "/api/browser-bridge/status" && request.method === "GET") {
    json(response, 200, { ok: true, ...bridge.status() });
    return;
  }
  if (path === "/api/browser-bridge/next" && request.method === "GET") {
    json(response, 200, { ok: true, job: bridge.next(token) });
    return;
  }
  if (path === "/api/browser-bridge/result" && request.method === "POST") {
    const body = await readBody(request, 1_000_000);
    if (!bridge.complete(token, body)) {
      json(response, 400, {
        ok: false,
        code: "invalid-browser-bridge-result",
      });
      return;
    }
    json(response, 200, { ok: true });
    return;
  }
  json(response, 404, { ok: false, code: "not-found" });
}
