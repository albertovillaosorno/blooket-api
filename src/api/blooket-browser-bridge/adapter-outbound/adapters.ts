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
//   - Concrete Blooket application ports over the local browser bridge.
// - Must-Not:
//   - Persist browser state, decode set/question payloads, or log credentials.
// - Allows:
//   - Inputs: One authenticated local bridge transport.
//   - Outputs: Session, capability, set, and question browser ports.
//   - Side effects: Delegated local WebExtension requests only.
// - Split-When:
//   - One port family needs independent browser lifecycle management.
// - Merge-When:
//   - Application ports directly consume bridge commands.
// - Summary:
//   - Maps semantic Blooket ports onto versioned local extension requests.
// - Description:
//   - Session states are validated here; read payloads stay unknown for IR.
// - Usage:
//   - Compose one adapter set with the service-owned bridge broker.
// - Defaults:
//   - Malformed bridge values become stable browser failures.
//
import { BLOOKET_NAVIGATION_STATE_KINDS } from
  "../../../ir/blooket-navigation/domain/navigation-state.ts";
import type { BlooketCapabilityInspectionPort } from
  "../../blooket-capability-inspection/contract/capability-inspection.ts";
import type { BlooketBrowserSessionPort } from
  "../../blooket-session/contract/browser-session.ts";
import type { BlooketQuestionReadPort } from
  "../../blooket-set-reads/contract/question-reads.ts";
import type { BlooketSetReadPort } from
  "../../blooket-set-reads/contract/set-reads.ts";
import type { BlooketBrowserBridgeTransport } from
  "../../../platforms/blooket-browser/contract/bridge-transport.ts";

const OBSERVED_STATES: ReadonlySet<string> = new Set(
  BLOOKET_NAVIGATION_STATE_KINDS.filter(
    (state) =>
      state !== "authenticating"
      && state !== "authenticated"
      && state !== "human-action-required",
  ),
);

export function createBlooketBrowserBridgeAdapters(
  transport: BlooketBrowserBridgeTransport,
): {
  readonly session: BlooketBrowserSessionPort;
  readonly capabilities: BlooketCapabilityInspectionPort;
  readonly sets: BlooketSetReadPort;
  readonly questions: BlooketQuestionReadPort;
} {
  return {
    session: {
      observe: async () => {
        const result = await safeRequest(transport, {
          kind: "session.observe",
        });
        if (!result.ok) return result;
        if (
          typeof result.value !== "string"
          || !OBSERVED_STATES.has(
            result.value as typeof BLOOKET_NAVIGATION_STATE_KINDS[number],
          )
        ) {
          return browserFailure();
        }
        return {
          ok: true,
          state: result.value as Exclude<
            typeof BLOOKET_NAVIGATION_STATE_KINDS[number],
            "authenticating" | "authenticated" | "human-action-required"
          >,
        };
      },
      authenticate: async (credentials) => {
        const result = await safeRequest(transport, {
          kind: "session.authenticate",
          loginIdentifier: credentials.loginIdentifier,
          password: credentials.password,
        });
        return result.ok ? { ok: true } : result;
      },
    },

    capabilities: {
      inspect: async () =>
        await safeRequest(transport, { kind: "capabilities.inspect" }),
    },

    sets: {
      list: async () =>
        await safeRequest(transport, { kind: "sets.list" }),
      get: async (setId) =>
        await safeRequest(transport, { kind: "sets.get", setId }),
    },

    questions: {
      list: async (setId) =>
        await safeRequest(transport, { kind: "questions.list", setId }),
    },
  };
}

async function safeRequest(
  transport: BlooketBrowserBridgeTransport,
  command: Parameters<BlooketBrowserBridgeTransport["request"]>[0],
) {
  try {
    return await transport.request(command);
  } catch {
    return browserFailure();
  }
}

function browserFailure() {
  return {
    ok: false as const,
    code: "blooket-browser-failed" as const,
  };
}
