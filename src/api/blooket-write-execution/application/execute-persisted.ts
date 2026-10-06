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
//   - Load/execute/persist composition for one resumable Blooket write step.
// - Must-Not:
//   - Loop, auto-retry confirmed writes, or hide post-write
//     persistence failure.
// - Allows:
//   - Inputs: Trusted checkpoint path plus one plan and execution dependencies.
//   - Outputs: One-step execution results or explicit recovery-required
//     failure.
//   - Side effects: Checkpoint reads/writes and at most one remote write
//     attempt.
// - Split-When:
//   - Crash-intent journaling requires an independently versioned workflow.
// - Merge-When:
//   - Write execution and checkpoint persistence become one lower-level port.
// - Summary:
//   - Persists confirmed progress before reporting an advanced write as
//     durable.
// - Description:
//   - Post-confirmation save failure is never classified as safe to retry.
// - Usage:
//   - Prefer this composition when local resumability is required.
// - Defaults:
//   - Missing checkpoint files begin at operation index zero.
//
import type { BlooketWritePlan } from
  "../../../projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../security/host-secrets/domain/host-secret.ts";
import {
  loadWriteCheckpointFile,
  saveWriteCheckpointFile,
  type WriteCheckpointFileLoadResult,
  type WriteCheckpointFileSaveResult,
} from
  "../../../platforms/write-checkpoint-files/adapter-outbound/file.ts";
import type { BlooketBrowserSessionPort } from
  "../../blooket-session/contract/browser-session.ts";
import {
  executeNextBlooketWrite,
  type ExecuteNextBlooketWriteResult,
} from "./execute-next.ts";
import type { BlooketWriteExecutionPort } from
  "../contract/write-execution.ts";

type ExecuteNonAdvanced = Exclude<
  ExecuteNextBlooketWriteResult,
  {
    readonly ok: true;
    readonly kind: "advanced";
  }
>;

export type ExecutePersistedBlooketWriteResult =
  | ExecuteNonAdvanced
  | Extract<
      ExecuteNextBlooketWriteResult,
      {
        readonly ok: true;
        readonly kind: "advanced";
      }
    >
  | {
      readonly ok: false;
      readonly stage: "checkpoint-load";
      readonly code: "checkpoint-load-failed";
      readonly cause: Exclude<
        WriteCheckpointFileLoadResult,
        { readonly ok: true }
      >;
    }
  | {
      readonly ok: false;
      readonly stage: "checkpoint-save-after-confirmed-write";
      readonly code: "confirmed-write-not-persisted";
      readonly operationId: string;
      readonly checkpoint: Extract<
        ExecuteNextBlooketWriteResult,
        {
          readonly ok: true;
          readonly kind: "advanced";
        }
      >["checkpoint"];
      readonly cause: Exclude<
        WriteCheckpointFileSaveResult,
        { readonly ok: true }
      >;
    };

export async function executePersistedBlooketWrite(
  checkpointPath: string,
  plan: BlooketWritePlan,
  browser: BlooketBrowserSessionPort,
  secrets: HostSecretStore,
  writes: BlooketWriteExecutionPort,
): Promise<ExecutePersistedBlooketWriteResult> {
  const loaded = await loadWriteCheckpointFile(
    checkpointPath,
    plan,
  );
  if (!loaded.ok) {
    return {
      ok: false,
      stage: "checkpoint-load",
      code: "checkpoint-load-failed",
      cause: loaded,
    };
  }

  const executed = await executeNextBlooketWrite(
    plan,
    loaded.checkpoint,
    browser,
    secrets,
    writes,
  );
  if (!executed.ok || executed.kind !== "advanced") {
    return executed;
  }

  const saved = await saveWriteCheckpointFile(
    checkpointPath,
    plan,
    executed.checkpoint,
  );
  if (!saved.ok) {
    return {
      ok: false,
      stage: "checkpoint-save-after-confirmed-write",
      code: "confirmed-write-not-persisted",
      operationId: executed.operationId,
      checkpoint: executed.checkpoint,
      cause: saved,
    };
  }

  return executed;
}
