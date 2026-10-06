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
//   - Behavioral tests for one-step resumable Blooket write execution.
// - Must-Not:
//   - Contact Blooket, sleep, retry, or persist checkpoints.
// - Allows:
//   - Inputs: Fixed plans, checkpoints, and in-memory port doubles.
//   - Outputs: Exact advancement, stop-state, and failure verdicts.
//   - Side effects: In-memory call tracking only.
// - Split-When:
//   - Pacing/retry policies gain independent execution tests.
// - Merge-When:
//   - One-step write execution is removed.
// - Summary:
//   - Proves checkpoints advance only after confirmed planned writes.
// - Description:
//   - Mirrors src/api/blooket-write-execution/application/execute-next.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unconfirmed outcomes leave persisted progress unchanged.
//
import assert from "node:assert/strict";
import test from "node:test";

import { executeNextBlooketWrite } from
  "../../../../src/api/blooket-write-execution/application/execute-next.ts";
import type {
  BlooketWriteAttemptResult,
  BlooketWriteExecutionPort,
} from
  "../../../../src/api/blooket-write-execution/contract/write-execution.ts";
import type {
  BlooketBrowserSessionPort,
} from "../../../../src/api/blooket-session/contract/browser-session.ts";
import type { BlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";

const plan: BlooketWritePlan = {
  schemaVersion: 1,
  planId: "plan:test",
  desiredStateSha256: "fixture",
  operations: [{
    operationId: "plan:test:set",
    kind: "set",
    title: "Fractions",
    description: "Review.",
    visibility: "private",
    coverMediaId: null,
  }],
};

function checkpoint(index = 0) {
  return {
    schemaVersion: 2 as const,
    planId: plan.planId,
    nextOperationIndex: index,
    remoteSetId: index === 0 ? null : "remote-set-1",
  };
}

function browser(calls: string[]): BlooketBrowserSessionPort {
  return {
    observe: async () => {
      calls.push("browser:observe");
      return { ok: true, state: "dashboard" };
    },
    authenticate: async () => {
      calls.push("browser:authenticate");
      return { ok: true };
    },
  };
}

function secrets(calls: string[]): HostSecretStore {
  return {
    read: async (name) => {
      calls.push("secret:" + name);
      return { ok: true, kind: "missing" };
    },
    write: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
  };
}

function writePort(
  result: BlooketWriteAttemptResult | "throw",
  calls: string[],
  targets: Array<string | null> = [],
): BlooketWriteExecutionPort {
  return {
    execute: async (operation, target) => {
      calls.push("write:" + operation.operationId);
      targets.push(target.remoteSetId);
      if (result === "throw") {
        throw new Error("fixture write failure");
      }
      return result;
    },
  };
}

test("invalid checkpoints fail before all side effects", async () => {
  const browserCalls: string[] = [];
  const secretCalls: string[] = [];
  const writeCalls: string[] = [];
  const result = await executeNextBlooketWrite(
    plan,
    {
      ...checkpoint(),
      planId: "plan:other",
    },
    browser(browserCalls),
    secrets(secretCalls),
    writePort({
      ok: true,
      receipt: { kind: "set-created", remoteSetId: "remote-set-1" },
    }, writeCalls),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.stage, "checkpoint");
  }
  assert.deepEqual(browserCalls, []);
  assert.deepEqual(secretCalls, []);
  assert.deepEqual(writeCalls, []);
});

test("completed checkpoints cause no remote side effects", async () => {
  const browserCalls: string[] = [];
  const writeCalls: string[] = [];
  const result = await executeNextBlooketWrite(
    plan,
    checkpoint(1),
    browser(browserCalls),
    secrets([]),
    writePort({
      ok: true,
      receipt: { kind: "set-created", remoteSetId: "remote-set-1" },
    }, writeCalls),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "complete",
    checkpoint: checkpoint(1),
  });
  assert.deepEqual(browserCalls, []);
  assert.deepEqual(writeCalls, []);
});

test("confirmed writes bind the created remote set exactly once", async () => {
  const writeCalls: string[] = [];
  const targets: Array<string | null> = [];
  const result = await executeNextBlooketWrite(
    plan,
    checkpoint(),
    browser([]),
    secrets([]),
    writePort({
      ok: true,
      receipt: { kind: "set-created", remoteSetId: "remote-set-1" },
    }, writeCalls, targets),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "advanced",
    operationId: "plan:test:set",
    checkpoint: checkpoint(1),
  });
  assert.deepEqual(writeCalls, ["write:plan:test:set"]);
  assert.deepEqual(targets, [null]);
});

test("set success without a receipt cannot advance", async () => {
  const result = await executeNextBlooketWrite(
    plan,
    checkpoint(),
    browser([]),
    secrets([]),
    writePort({ ok: true, receipt: null }, []),
  );

  assert.deepEqual(result, {
    ok: false,
    stage: "checkpoint",
    code: "checkpoint-invariant",
  });
});

test("rate limiting preserves the original checkpoint", async () => {
  const result = await executeNextBlooketWrite(
    plan,
    checkpoint(),
    browser([]),
    secrets([]),
    writePort({
      ok: false,
      kind: "navigation",
      state: "rate-limited",
    }, []),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "wait",
    state: "rate-limited",
    checkpoint: checkpoint(),
  });
});

test(
  "session expiry requests reauthentication without advancement",
  async () => {
  const result = await executeNextBlooketWrite(
    plan,
    checkpoint(),
    browser([]),
    secrets([]),
    writePort({
      ok: false,
      kind: "navigation",
      state: "expired-session",
    }, []),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "session-required",
    state: "expired-session",
    checkpoint: checkpoint(),
  });
  },
);

test("security challenges stop for human action", async () => {
  const result = await executeNextBlooketWrite(
    plan,
    checkpoint(),
    browser([]),
    secrets([]),
    writePort({
      ok: false,
      kind: "navigation",
      state: "security-challenge",
    }, []),
  );

  assert.deepEqual(result, {
    ok: true,
    kind: "human-action-required",
    state: "security-challenge",
    checkpoint: checkpoint(),
  });
});

test("ready navigation without confirmation does not advance", async () => {
  const result = await executeNextBlooketWrite(
    plan,
    checkpoint(),
    browser([]),
    secrets([]),
    writePort({
      ok: false,
      kind: "navigation",
      state: "dashboard",
    }, []),
  );

  assert.deepEqual(result, {
    ok: false,
    stage: "write",
    code: "blooket-write-not-confirmed",
  });
});

test("write adapter failures and exceptions remain stable", async () => {
  for (const attempted of [
    {
      ok: false,
      kind: "browser",
      code: "blooket-browser-unavailable",
    } as const,
    "throw" as const,
  ]) {
    const result = await executeNextBlooketWrite(
      plan,
      checkpoint(),
      browser([]),
      secrets([]),
      writePort(attempted, []),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "write");
    }
  }
});
