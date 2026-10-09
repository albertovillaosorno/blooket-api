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
import type { ObservedBlooketNavigationStateKind } from
  "../../../ir/blooket-navigation/domain/navigation-state.ts";
import type { BlooketCapabilityInspectionPort } from
  "../../blooket-capability-inspection/contract/capability-inspection.ts";
import type { BlooketBrowserSessionPort } from
  "../../blooket-session/contract/browser-session.ts";
import type { BlooketQuestionReadPort } from
  "../../blooket-set-reads/contract/question-reads.ts";
import type { BlooketBrowserWriteSurfacePort } from
  "../../blooket-write-execution/contract/browser-write-surface.ts";
import type { BlooketSetReadPort } from
  "../../blooket-set-reads/contract/set-reads.ts";
import type { BlooketBrowserBridgeTransport } from
  "../../../platforms/blooket-browser/contract/bridge-transport.ts";
import {
  decodeBlooketPreparedImage, type BlooketPreparedImage,
} from "../../../ir/blooket-browser-bridge/contract/prepared-image.ts";

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
  readonly writes: BlooketBrowserWriteSurfacePort;
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
      list: async () => {
        const result = await safeRequest(transport, { kind: "sets.list" });
        if (!result.ok) return result;
        // Older workers returned a bare array without collection evidence.
        // Refuse it, but distinguish protocol drift from a provider page stop.
        if (Array.isArray(result.value))
          return { ok: false, code: "blooket-browser-incompatible" };
        if (
          !result.value ||
          typeof result.value !== "object" ||
          Array.isArray(result.value) ||
          Object.keys(result.value).sort().join() !== "completeness,items" ||
          !("items" in result.value) ||
          !Array.isArray(result.value.items) ||
          !("completeness" in result.value) ||
          (result.value.completeness !== "complete" &&
            result.value.completeness !== "unknown") ||
          (result.value.completeness === "complete" &&
            result.value.items.length !== 0)
        )
          return browserFailure();
        return {
          ok: true,
          value: result.value.items,
          completeness: result.value.completeness,
        };
      },
      get: async (setId) =>
        await safeRequest(transport, { kind: "sets.get", setId }),
    },

    questions: {
      list: async (setId) =>
        await safeRequest(transport, { kind: "questions.list", setId }),
    },

    writes: {
      createSet: async (submission, media) => {
        if (submission.coverImage !== null || media.length !== 0)
          return browserFailureWithKind();
        const result = await safeRequest(transport, {
          kind: "sets.create",
          title: submission.title,
          description: submission.description,
          private: submission.private,
        });
        if (!result.ok) return browserFailureWithKind(result.code);
        return decodeCreateSetSurfaceResult(result.value);
      },
      addQuestion: async (submission, media) => {
        if (submission.answers.some((answer) => answer.kind !== "text"))
          return browserFailureWithKind();
        let image: BlooketPreparedImage | undefined;
        if (submission.image !== null) {
          const file = media[0];
          if (media.length !== 1 || !file ||
              file.mediaId !== submission.image.mediaId ||
              !Number.isSafeInteger(file.revision) || file.revision < 1 ||
              !(file.bytes instanceof Uint8Array) || file.bytes.length < 1 ||
              file.bytes.length >= 2_500_000) return browserFailureWithKind();
          const decoded = decodeBlooketPreparedImage({
            format: file.format,
            base64: Buffer.from(file.bytes).toString("base64"),
          });
          if (!decoded.ok) return browserFailureWithKind();
          image = decoded.value;
        } else if (media.length !== 0) return browserFailureWithKind();
        const result = await safeRequest(transport, {
          kind: "questions.create",
          setId: submission.remoteSetId,
          number: submission.number,
          question: submission.question,
          answers: submission.answers.map((answer) => ({
            text: answer.kind === "text" ? answer.text : "",
            correct: answer.correct,
          })),
          qType: submission.qType,
          random: submission.random,
          answerTypes: submission.answerTypes,
          timeLimit: submission.timeLimit,
          ...(image ? { image } : {}),
        });
        if (!result.ok) return browserFailureWithKind(result.code);
        return decodeAddQuestionSurfaceResult(result.value);
      },
    },
  };
}

async function safeRequest(
  transport: BlooketBrowserBridgeTransport,
  command: Parameters<BlooketBrowserBridgeTransport["request"]>[0],
) {
  try {
    const result = await transport.request(command);
    if (!result || typeof result !== "object" || Array.isArray(result))
      return browserFailure();
    const keys = Object.keys(result).sort().join();
    if (result.ok === true && keys === "ok,value")
      return { ok: true as const, value: result.value };
    if (result.ok === false && keys === "code,ok" &&
        (result.code === "blooket-browser-failed" ||
          result.code === "blooket-browser-unavailable"))
      return { ok: false as const, code: result.code };
    return browserFailure();
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

function browserFailureWithKind(
  code:
    | "blooket-browser-unavailable"
    | "blooket-browser-failed" = "blooket-browser-failed",
) {
  return {
    ok: false as const,
    kind: "browser" as const,
    code,
  };
}

function decodeCreateSetSurfaceResult(value: unknown) {
  if (!value || typeof value !== "object") return browserFailureWithKind();
  const result = value as Record<string, unknown>;
  if (
    result["ok"] === true &&
    Object.keys(result).sort().join() === "ok,remoteSetId" &&
    Object.prototype.hasOwnProperty.call(result, "remoteSetId")
  )
    return {
      ok: true as const,
      remoteSetId: result["remoteSetId"],
    };
  if (
    result["ok"] === false &&
    result["kind"] === "navigation" &&
    typeof result["state"] === "string" &&
    OBSERVED_STATES.has(result["state"]) &&
    Object.keys(result).sort().join() === "kind,ok,state"
  )
    return {
      ok: false as const,
      kind: "navigation" as const,
      state: result["state"] as ObservedBlooketNavigationStateKind,
    };
  if (
    result["ok"] === false &&
    result["kind"] === "browser" &&
    (
      result["code"] === "blooket-browser-unavailable" ||
      result["code"] === "blooket-browser-failed"
    ) &&
    Object.keys(result).sort().join() === "code,kind,ok"
  )
    return browserFailureWithKind(result["code"]);
  return browserFailureWithKind();
}

function decodeAddQuestionSurfaceResult(value: unknown) {
  if (!value || typeof value !== "object") return browserFailureWithKind();
  const result = value as Record<string, unknown>;
  if (
    result["ok"] === true &&
    Object.keys(result).sort().join() === "ok"
  )
    return { ok: true as const };
  if (
    result["ok"] === false &&
    result["kind"] === "navigation" &&
    typeof result["state"] === "string" &&
    OBSERVED_STATES.has(result["state"]) &&
    Object.keys(result).sort().join() === "kind,ok,state"
  )
    return {
      ok: false as const,
      kind: "navigation" as const,
      state: result["state"] as ObservedBlooketNavigationStateKind,
    };
  if (
    result["ok"] === false &&
    result["kind"] === "browser" &&
    (
      result["code"] === "blooket-browser-unavailable" ||
      result["code"] === "blooket-browser-failed"
    ) &&
    Object.keys(result).sort().join() === "code,kind,ok"
  )
    return browserFailureWithKind(result["code"]);
  return browserFailureWithKind();
}
