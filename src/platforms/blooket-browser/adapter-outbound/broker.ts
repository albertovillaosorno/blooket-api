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
//   - Bounded in-memory delivery of local WebExtension browser jobs.
// - Must-Not:
//   - Persist commands, log secrets, retry ambiguous jobs, or trust replies.
// - Allows:
//   - Inputs: Internal bridge commands plus token-authenticated extension
//     replies.
//   - Outputs: One-at-a-time jobs and stable transport results.
//   - Side effects: Timers, random IDs, and in-memory pending-job state only.
// - Split-When:
//   - Multiple independent browser workers need explicit scheduling.
// - Merge-When:
//   - Browser automation no longer crosses a process boundary.
// - Summary:
//   - Correlates local browser jobs without durable secret-bearing queues.
// - Description:
//   - Timeouts and closure fail requests as browser-unavailable without replay.
// - Usage:
//   - Share one broker between browser adapters and loopback bridge routes.
// - Defaults:
//   - Eight pending jobs and a ten-second response deadline.
//
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  BLOOKET_BROWSER_BRIDGE_VERSION,
  decodeBlooketBrowserBridgeRequest,
  decodeBlooketBrowserBridgeResponse,
  type BlooketBrowserBridgeRequest,
} from "../../../ir/blooket-browser-bridge/contract/message.ts";
import type {
  BlooketBrowserBridgeTransport,
  BlooketBrowserBridgeTransportResult,
} from "../contract/bridge-transport.ts";

// The Chrome login host needs seven seconds after receipt. Preserve a separate
// transport margin instead of dispatching stale credential-bearing jobs.
const MIN_AUTH_DISPATCH_MS = 8_000;
// Read hosts can use eight seconds (nine for capability cleanup). A queued
// command must retain those budgets plus transport margin when dispatched.
const MIN_READ_DISPATCH_MS = 8_500;
const MIN_CAPABILITY_DISPATCH_MS = 9_500;
// Browser Create Set and Add Question combine navigation, a single click,
// and independent read-back. Never dispatch close to broker expiry; a form
// can still mutate after the caller has stopped waiting for its reply.
const MIN_WRITE_DISPATCH_MS = 9_500;
// The extension reads each /next JSON response with a four-megabyte cap.
// Account for the actual envelope before leasing any image-backed write.
const MAX_DELIVERY_JSON_BYTES = 4_000_000;

interface PendingJob {
  readonly request: BlooketBrowserBridgeRequest;
  readonly resolve: (result: BlooketBrowserBridgeTransportResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly createdAt: number;
  readonly expiresAt: number;
  dispatched: boolean;
  client?: string;
}

export interface BlooketBrowserBridgeBroker
  extends BlooketBrowserBridgeTransport {
  pairingToken(): string;
  resetPairing(): void;
  authenticated(token: string): boolean;
  compatible(client: string): boolean;
  noteUnidentifiedClient(): void;
  next(token: string, client?: string): BlooketBrowserBridgeRequest | null;
  complete(token: string, value: unknown, client?: string): boolean;
  close(): void;
  status(): {
    readonly pending: number;
    readonly connected: boolean;
    readonly multipleBrowserClients: boolean;
    readonly incompatibleClients: number;
    readonly requiresExtensionUpdate: boolean;
  };
}

export function createBlooketBrowserBridgeBroker(
  options: {
    readonly timeoutMs?: number;
    readonly writeTimeoutMs?: number;
    readonly maxPending?: number;
    readonly token?: string;
    readonly now?: () => number;
  } = {},
): BlooketBrowserBridgeBroker {
  const timeoutMs = options.timeoutMs ?? 10_000;
  // A real Create Set redirect can outlive the ten-second read budget.
  // Explicit test overrides retain their original bounded behavior.
  const writeTimeoutMs = options.writeTimeoutMs ??
    (options.timeoutMs === undefined ? 30_000 : timeoutMs);
  const maxPending = options.maxPending ?? 8;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("invalid-browser-bridge-timeout");
  }
  if (!Number.isSafeInteger(writeTimeoutMs) || writeTimeoutMs < 1 ||
      writeTimeoutMs > 60_000)
    throw new Error("invalid-browser-bridge-write-timeout");
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new Error("invalid-browser-bridge-capacity");
  }
  let token = options.token ?? randomBytes(32).toString("base64url");
  if (Buffer.byteLength(token, "utf8") < 32) {
    throw new Error("invalid-browser-bridge-token");
  }
  const now = options.now ?? Date.now;
  const pending = new Map<string, PendingJob>();
  let closed = false;
  let lastPollAt = 0;
  const activeClients = new Map<string, number>();
  const incompatibleClients = new Set<string>();
  let unidentifiedClient = false;

  function inFlightClient(client: string): boolean {
    return [...pending.values()].some(job => job.dispatched &&
      job.client === client && now() < job.expiresAt);
  }

  function pruneClients() {
    for (const [client, at] of activeClients)
      if (now() - at >= timeoutMs && !inFlightClient(client))
        activeClients.delete(client);
  }

  function authenticated(candidate: string): boolean {
    const left = Buffer.from(token, "utf8");
    const right = Buffer.from(candidate, "utf8");
    return (
      !closed && left.length === right.length && timingSafeEqual(left, right)
    );
  }

  function settle(
    id: string,
    result: BlooketBrowserBridgeTransportResult,
  ): void {
    const job = pending.get(id);
    if (!job) return;
    clearTimeout(job.timer);
    pending.delete(id);
    job.resolve(result);
  }

  return {
    pairingToken: () => token,
    authenticated,
    compatible: (client) => !incompatibleClients.has(client),
    noteUnidentifiedClient: () => { unidentifiedClient = true; },
    resetPairing: () => {
      if (closed) return;
      token = randomBytes(32).toString("base64url");
      lastPollAt = 0;
      activeClients.clear();
      incompatibleClients.clear();
      unidentifiedClient = false;
      for (const id of [...pending.keys()]) {
        settle(id, { ok: false, code: "blooket-browser-unavailable" });
      }
    },

    request: async (command) => {
      pruneClients();
      if (closed || activeClients.size > 1 ||
          pending.size >= maxPending) {
        return {
          ok: false,
          code: "blooket-browser-unavailable",
        };
      }
      const id = randomUUID();
      const decoded = decodeBlooketBrowserBridgeRequest({
        schemaVersion: BLOOKET_BROWSER_BRIDGE_VERSION,
        id,
        command,
      });
      if (!decoded.ok) {
        return { ok: false, code: "blooket-browser-failed" };
      }
      const request: BlooketBrowserBridgeRequest = decoded.value;
      if (Buffer.byteLength(JSON.stringify({ ok: true, job: request })) >
          MAX_DELIVERY_JSON_BYTES)
        return { ok: false, code: "blooket-browser-failed" };
      return await new Promise<BlooketBrowserBridgeTransportResult>(
        (resolve) => {
          const startedAt = now();
          const write = request.command.kind === "sets.create" ||
            request.command.kind === "questions.create";
          const lifetimeMs = write ? writeTimeoutMs : timeoutMs;
          const timer = setTimeout(() => {
            settle(id, {
              ok: false,
              code: "blooket-browser-unavailable",
            });
          }, lifetimeMs);
          timer.unref?.();
          pending.set(id, {
            request,
            resolve,
            timer,
            createdAt: startedAt,
            expiresAt: startedAt + lifetimeMs,
            dispatched: false,
          });
        },
      );
    },

    next: (candidate, client) => {
      if (closed || !authenticated(candidate)) return null;
      if (client !== undefined && incompatibleClients.has(client)) return null;
      lastPollAt = now();
      pruneClients();
      if (client !== undefined &&
          (activeClients.has(client) || activeClients.size < 16))
        activeClients.set(client, lastPollAt);
      // A second distinct extension can represent a different user browser
      // profile with different account cookies. Fail closed instead of
      // dispatching the user's next job to whichever profile polls first.
      if (activeClients.size > 1) return null;
      // Polling can be concurrent after extension reconnection. Expire stale
      // leases first, then keep at most one job in the browser at a time.
      for (const job of pending.values()) {
        if (job.expiresAt <= lastPollAt) {
          settle(job.request.id, {
            ok: false,
            code: "blooket-browser-unavailable",
          });
        }
      }
      if ([...pending.values()].some((job) => job.dispatched)) return null;
      for (const job of pending.values()) {
        const remainingMs = job.expiresAt - lastPollAt;
        const kind = job.request.command.kind;
        const minimumMs = kind === "session.authenticate"
          ? MIN_AUTH_DISPATCH_MS
          : kind === "capabilities.inspect"
            ? MIN_CAPABILITY_DISPATCH_MS
            : kind === "sets.create" || kind === "questions.create"
              ? Math.max(MIN_WRITE_DISPATCH_MS, writeTimeoutMs - 500)
              : kind === "session.observe" || kind === "sets.list" ||
                kind === "sets.get" || kind === "questions.list"
              ? MIN_READ_DISPATCH_MS
              : 0;
        if (
          remainingMs <= 0 ||
          remainingMs < Math.min(minimumMs,
            job.expiresAt - job.createdAt)
        ) {
          settle(job.request.id, {
            ok: false,
            code: "blooket-browser-unavailable",
          });
          continue;
        }
        job.dispatched = true;
        if (client !== undefined) job.client = client;
        return job.request;
      }
      return null;
    },

    complete: (candidate, value, client) => {
      if (closed || !authenticated(candidate)) return false;
      if (
        typeof value !== "object" ||
        value === null ||
        !("id" in value) ||
        typeof value.id !== "string"
      ) {
        return false;
      }
      const job = pending.get(value.id);
      if (!job || !job.dispatched) return false;
      if (job.client !== undefined && job.client !== client) return false;
      if (now() >= job.expiresAt) {
        settle(job.request.id, {
          ok: false,
          code: "blooket-browser-unavailable",
        });
        return false;
      }
      const decoded = decodeBlooketBrowserBridgeResponse(value, job.request.id);
      if (!decoded.ok) {
        settle(job.request.id, {
          ok: false,
          code: "blooket-browser-failed",
        });
        return false;
      }
      // A legacy list envelope has no collection evidence. Preserve the
      // failed operation for its owning decoder; never replay it here. Stop
      // this identified extension from winning later leases over an updated
      // worker. Unidentified native clients retain ordinary fail-closed reads.
      if (client !== undefined && job.request.command.kind === "sets.list" &&
          decoded.value.ok && Array.isArray(decoded.value.value)) {
        // Bound authenticated client observations as well as pending jobs.
        if (incompatibleClients.size < 16) incompatibleClients.add(client);
        activeClients.delete(client);
        lastPollAt = 0;
      }
      settle(
        job.request.id,
        decoded.value.ok
          ? { ok: true, value: decoded.value.value }
          : { ok: false, code: decoded.value.code },
      );
      return true;
    },

    close: () => {
      if (closed) return;
      closed = true;
      for (const id of [...pending.keys()]) {
        settle(id, {
          ok: false,
          code: "blooket-browser-unavailable",
        });
      }
    },

    status: () => {
      pruneClients();
      const multipleBrowserClients = activeClients.size > 1;
      return {
      pending: pending.size,
      connected: !closed && !multipleBrowserClients &&
        (lastPollAt > 0 && now() - lastPollAt < timeoutMs ||
          [...pending.values()].some(job => job.dispatched &&
            now() < job.expiresAt)),
      multipleBrowserClients,
      incompatibleClients: incompatibleClients.size,
      requiresExtensionUpdate: unidentifiedClient ||
        incompatibleClients.size > 0,
      };
    },
  };
}
