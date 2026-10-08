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
//   - Authenticated, validated Blooket account capability inspection.
// - Must-Not:
//   - Return raw invalid probe data, credentials, or guessed capability facts.
// - Allows:
//   - Inputs: Browser-session, host-secret, and capability-inspection ports.
//   - Outputs: Validated snapshots, wait/human states, or stable failures.
//   - Side effects: Session reuse/login plus one capability probe when ready.
// - Split-When:
//   - Capability inspection needs independently versioned account scopes.
// - Merge-When:
//   - Capabilities no longer require authenticated browser evidence.
// - Summary:
//   - Ensures a session before decoding untrusted capability observations.
// - Description:
//   - Invalid adapter output fails at the versioned IR snapshot boundary.
// - Usage:
//   - Inspect immediately before capability-dependent planning or execution.
// - Defaults:
//   - Wait and human-action states stop before any capability probe.
//
import {
  decodeBlooketCapabilitySnapshot,
  type BlooketCapabilitySnapshot,
} from "../../../ir/capability-snapshots/contract/blooket-capabilities.ts";
import type { ValidationIssue } from
  "../../../ir/runtime-decoding/domain/decode-result.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import {
  ensureBlooketSession,
  inspectReadyBlooketSession,
  type EnsureBlooketSessionResult,
} from "../../blooket-session/application/ensure-session.ts";
import type {
  BlooketBrowserFailureCode,
  BlooketBrowserSessionPort,
} from "../../blooket-session/contract/browser-session.ts";
import type {
  BlooketCapabilityInspectionPort,
  BlooketCapabilityProbeResult,
} from "../contract/capability-inspection.ts";

type SessionFailure = Extract<
  EnsureBlooketSessionResult,
  { readonly ok: false }
>;

export type InspectBlooketCapabilitiesResult =
  | {
      readonly ok: true;
      readonly kind: "capabilities";
      readonly session: {
        readonly state: "dashboard" | "my-sets" | "create" | "edit";
        readonly reused: boolean;
      };
      readonly value: BlooketCapabilitySnapshot;
    }
  | Extract<
      EnsureBlooketSessionResult,
      {
        readonly ok: true;
        readonly kind: "wait" | "human-action-required";
      }
    >
  | {
      readonly ok: false;
      readonly stage: "session";
      readonly code: SessionFailure["code"];
    }
  | {
      readonly ok: false;
      readonly stage: "inspection";
      readonly code: BlooketBrowserFailureCode;
    }
  | {
      readonly ok: false;
      readonly stage: "validation";
      readonly code: "invalid-capability-snapshot";
      readonly issues: readonly ValidationIssue[];
    };

export async function inspectBlooketCapabilities(
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  inspection: BlooketCapabilityInspectionPort,
  options: { readonly readOnly?: boolean } = {},
): Promise<InspectBlooketCapabilitiesResult> {
  const session = options.readOnly
    ? await inspectReadyBlooketSession(browser)
    : await ensureBlooketSession(browser, secrets);
  if (!session.ok) {
    return {
      ok: false,
      stage: "session",
      code: session.code,
    };
  }
  if (session.kind !== "ready") {
    return session;
  }

  const probed = await safeInspect(inspection);
  if (!probed.ok) {
    // An authenticated tab may become challenged while the probe is running.
    // Only re-observe; never replay the failed probe or initiate login here.
    if (probed.code === "blooket-browser-failed") {
      const observed = await inspectReadyBlooketSession(browser);
      if (observed.ok &&
          (observed.kind === "wait" ||
            observed.kind === "human-action-required"))
        return observed;
      if (!observed.ok &&
          observed.code === "blooket-authentication-required")
        return { ok: false, stage: "session", code: observed.code };
    }
    return {
      ok: false,
      stage: "inspection",
      code: probed.code,
    };
  }

  const decoded = decodeBlooketCapabilitySnapshot(probed.value);
  if (!decoded.ok) {
    return {
      ok: false,
      stage: "validation",
      code: "invalid-capability-snapshot",
      issues: decoded.issues,
    };
  }

  return {
    ok: true,
    kind: "capabilities",
    session: {
      state: session.state,
      reused: session.reused,
    },
    value: decoded.value,
  };
}

async function safeInspect(
  inspection: BlooketCapabilityInspectionPort,
): Promise<BlooketCapabilityProbeResult> {
  try {
    const result = await inspection.inspect();
    if (!result || typeof result !== "object" || Array.isArray(result))
      return capabilityFailure();
    const keys = Object.keys(result).sort().join();
    if (result.ok === true && keys === "ok,value")
      return { ok: true, value: result.value };
    if (result.ok === false && keys === "code,ok" &&
        (result.code === "blooket-browser-unavailable" ||
          result.code === "blooket-browser-failed"))
      return { ok: false, code: result.code };
    return capabilityFailure();
  } catch {
    return capabilityFailure();
  }
}

function capabilityFailure(): Extract<
  BlooketCapabilityProbeResult, { readonly ok: false }
> {
  return { ok: false, code: "blooket-browser-failed" };
}
