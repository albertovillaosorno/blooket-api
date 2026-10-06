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
import {
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  BLOOKET_BROWSER_BRIDGE_VERSION,
  decodeBlooketBrowserBridgeResponse,
  type BlooketBrowserBridgeRequest,
} from "../../../ir/blooket-browser-bridge/contract/message.ts";
import type {
  BlooketBrowserBridgeTransport,
  BlooketBrowserBridgeTransportResult,
} from "../contract/bridge-transport.ts";

interface PendingJob {
  readonly request: BlooketBrowserBridgeRequest;
  readonly resolve: (result: BlooketBrowserBridgeTransportResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  dispatched: boolean;
}

export interface BlooketBrowserBridgeBroker
  extends BlooketBrowserBridgeTransport {
  pairingToken(): string;
  authenticated(token: string): boolean;
  next(token: string): BlooketBrowserBridgeRequest | null;
  complete(token: string, value: unknown): boolean;
  close(): void;
  status(): {
    readonly pending: number;
    readonly connected: boolean;
  };
}

export function createBlooketBrowserBridgeBroker(
  options: {
    readonly timeoutMs?: number;
    readonly maxPending?: number;
    readonly token?: string;
    readonly now?: () => number;
  } = {},
): BlooketBrowserBridgeBroker {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxPending = options.maxPending ?? 8;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("invalid-browser-bridge-timeout");
  }
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new Error("invalid-browser-bridge-capacity");
  }
  const token = options.token ?? randomBytes(32).toString("base64url");
  if (Buffer.byteLength(token, "utf8") < 32) {
    throw new Error("invalid-browser-bridge-token");
  }
  const now = options.now ?? Date.now;
  const pending = new Map<string, PendingJob>();
  let closed = false;
  let lastPollAt = 0;

  function authenticated(candidate: string): boolean {
    const left = Buffer.from(token, "utf8");
    const right = Buffer.from(candidate, "utf8");
    return left.length === right.length && timingSafeEqual(left, right);
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

    request: async (command) => {
      if (closed || pending.size >= maxPending) {
        return {
          ok: false,
          code: "blooket-browser-unavailable",
        };
      }
      const id = randomUUID();
      const request: BlooketBrowserBridgeRequest = {
        schemaVersion: BLOOKET_BROWSER_BRIDGE_VERSION,
        id,
        command,
      };
      return await new Promise<BlooketBrowserBridgeTransportResult>(
        (resolve) => {
          const timer = setTimeout(() => {
            settle(id, {
              ok: false,
              code: "blooket-browser-unavailable",
            });
          }, timeoutMs);
          timer.unref?.();
          pending.set(id, {
            request,
            resolve,
            timer,
            dispatched: false,
          });
        },
      );
    },

    next: (candidate) => {
      if (closed || !authenticated(candidate)) return null;
      lastPollAt = now();
      for (const job of pending.values()) {
        if (job.dispatched) continue;
        job.dispatched = true;
        return job.request;
      }
      return null;
    },

    complete: (candidate, value) => {
      if (closed || !authenticated(candidate)) return false;
      if (
        typeof value !== "object"
        || value === null
        || !("id" in value)
        || typeof value.id !== "string"
      ) {
        return false;
      }
      const job = pending.get(value.id);
      if (!job || !job.dispatched) return false;
      const decoded = decodeBlooketBrowserBridgeResponse(
        value,
        job.request.id,
      );
      if (!decoded.ok) {
        settle(job.request.id, {
          ok: false,
          code: "blooket-browser-failed",
        });
        return false;
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

    status: () => ({
      pending: pending.size,
      connected: lastPollAt > 0 && now() - lastPollAt <= timeoutMs,
    }),
  };
}
