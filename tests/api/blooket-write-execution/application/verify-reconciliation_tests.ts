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
//   - Behavioral tests for session-gated provider write verification.
// - Must-Not:
//   - Contact Blooket, use credentials, or infer provider-specific evidence.
// - Allows:
//   - Inputs: Temporary persistence and deterministic in-memory browser ports.
//   - Outputs: Verification/reconciliation and evidence-preservation verdicts.
//   - Side effects: Temporary files removed after every test.
// - Split-When:
//   - Concrete provider verification gains integration fixtures.
// - Merge-When:
//   - Provider verification becomes part of remote write execution.
// - Summary:
//   - Proves only explicit verifier outcomes may resolve ambiguous journals.
// - Description:
//   - Session stops and inconclusive evidence preserve durable ambiguity.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Verifier exceptions become stable browser failures.
//
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyPersistedBlooketWrite } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/verify-reconciliation.ts";
import type { BlooketBrowserSessionPort } from
  "../../../../src/api/blooket-session/contract/browser-session.ts";
import type {
  BlooketWriteVerificationPort,
  BlooketWriteVerificationResult,
} from
  "../../../../src/api/blooket-write-execution/contract/write-verification.ts";
import {
  beginWriteAttempt,
  loadWriteAttemptFile,
  writeAttemptExecutionLockPath,
} from
  "../../../../src/platforms/write-attempt-files/adapter-outbound/file.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import type { BlooketWriteOperation } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";
import type { BlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";

const plan: BlooketWritePlan = {
  schemaVersion: 1,
  planId: "plan:verify-test",
  desiredStateSha256: "fixture",
  operations: [
    {
      operationId: "plan:verify-test:set",
      kind: "set",
      title: "Fractions",
      description: "Review.",
      visibility: "private",
      coverMediaId: null,
    },
    {
      operationId: "plan:verify-test:q:0",
      kind: "question",
      localQuestionId: "q1",
      question: {
        type: "typing-answer",
        prompt: "2 + 2",
        timeLimitSeconds: 10,
        imageMediaId: null,
        matchMode: "exact",
        answer: "4",
      },
    },
  ],
};

const SET_RECEIPT = {
  kind: "set-created" as const,
  remoteSetId: "remote-set-1",
};

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-verify-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function paths(directory: string) {
  return {
    checkpoint: join(directory, "checkpoint.json"),
    attempt: join(directory, "attempt.json"),
  };
}

function browser(
  state:
    | "dashboard"
    | "rate-limited"
    | "signed-out"
    | "security-challenge" = "dashboard",
  calls: string[] = [],
): BlooketBrowserSessionPort {
  return {
    observe: async () => {
      calls.push("observe");
      return { ok: true, state };
    },
    authenticate: async () => {
      calls.push("authenticate");
      return { ok: true };
    },
  };
}

function secrets(): HostSecretStore {
  return {
    read: async () => ({ ok: true, kind: "missing" }),
    write: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
  };
}

function verifier(
  result: BlooketWriteVerificationResult | "throw",
  calls: Array<{
    readonly operation: BlooketWriteOperation;
    readonly remoteSetId: string | null;
  }>,
): BlooketWriteVerificationPort {
  return {
    captureBaseline: async (operation) => ({
      ok: true,
      baseline: {
        schemaVersion: 1,
        kind: operation.kind === "set"
          ? "set-list"
          : "question-list",
        itemCount: 0,
        sha256: "0".repeat(64),
      },
    }),
    verify: async (operation, target) => {
      calls.push({
        operation,
        remoteSetId: target.remoteSetId,
      });
      if (result === "throw") {
        throw new Error("fixture verifier failure");
      }
      return result;
    },
  };
}

async function persistBoundCheckpoint(path: string): Promise<void> {
  await writeFile(path, JSON.stringify({
    schemaVersion: 2,
    planId: plan.planId,
    nextOperationIndex: 1,
    remoteSetId: "remote-set-1",
  }));
}

test("verification receives the exact persisted baseline", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    const baseline = {
      schemaVersion: 1 as const,
      kind: "set-list" as const,
      itemCount: 7,
      sha256: "c".repeat(64),
    };
    await beginWriteAttempt(value.attempt, plan, 0, baseline);
    const received: unknown[] = [];
    const verifying: BlooketWriteVerificationPort = {
      captureBaseline: async () => ({
        ok: true,
        baseline,
      }),
      verify: async (_operation, _target, candidate) => {
        received.push(candidate);
        return { ok: true, outcome: "inconclusive" };
      },
    };

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser(),
      secrets(),
      verifying,
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "reconciliation-required");
    }
    assert.deepEqual(received, [baseline]);
  });
});

test("legacy ambiguous journals verify with a null baseline", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await writeFile(value.attempt, JSON.stringify({
      schemaVersion: 2,
      planId: plan.planId,
      operationId: "plan:verify-test:set",
      operationIndex: 0,
      phase: "attempting",
      receipt: null,
    }));
    const received: unknown[] = [];
    const verifying: BlooketWriteVerificationPort = {
      captureBaseline: async () => ({
        ok: true,
        baseline: {
          schemaVersion: 1,
          kind: "set-list",
          itemCount: 0,
          sha256: "0".repeat(64),
        },
      }),
      verify: async (_operation, _target, candidate) => {
        received.push(candidate);
        return { ok: true, outcome: "inconclusive" };
      },
    };

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser(),
      secrets(),
      verifying,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(received, [null]);
  });
});

test(
  "confirmed set verification persists its receipt through recovery",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);
    const calls: Array<{
      readonly operation: BlooketWriteOperation;
      readonly remoteSetId: string | null;
    }> = [];

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser(),
      secrets(),
      verifier({
        ok: true,
        outcome: "confirmed",
        receipt: SET_RECEIPT,
      }, calls),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "recovered");
      if (result.kind === "recovered") {
        assert.equal(result.checkpoint.remoteSetId, "remote-set-1");
        assert.equal(result.checkpoint.nextOperationIndex, 1);
      }
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.operation.kind, "set");
    assert.equal(calls[0]?.remoteSetId, null);
    assert.deepEqual(
      await loadWriteAttemptFile(value.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test(
  "confirmed question verification reuses the durable set target",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await persistBoundCheckpoint(value.checkpoint);
    await beginWriteAttempt(value.attempt, plan, 1);
    const calls: Array<{
      readonly operation: BlooketWriteOperation;
      readonly remoteSetId: string | null;
    }> = [];

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser(),
      secrets(),
      verifier({
        ok: true,
        outcome: "confirmed",
        receipt: null,
      }, calls),
    );

    assert.equal(result.ok, true);
    if (result.ok && result.kind === "recovered") {
      assert.equal(result.checkpoint.nextOperationIndex, 2);
      assert.equal(result.checkpoint.remoteSetId, "remote-set-1");
    }
    assert.equal(calls[0]?.operation.kind, "question");
    assert.equal(calls[0]?.remoteSetId, "remote-set-1");
  });
  },
);

test(
  "verified non-confirmation clears ambiguity without advancement",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser(),
      secrets(),
      verifier({ ok: true, outcome: "not-confirmed" }, []),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "ready");
      if (result.kind === "ready") {
        assert.equal(result.checkpoint.nextOperationIndex, 0);
      }
    }
    await assert.rejects(readFile(value.checkpoint, "utf8"));
    assert.deepEqual(
      await loadWriteAttemptFile(value.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test(
  "inconclusive provider evidence preserves the attempt journal",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser(),
      secrets(),
      verifier({ ok: true, outcome: "inconclusive" }, []),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "reconciliation-required");
      if (result.kind === "reconciliation-required") {
        assert.equal(result.reason, "verification-inconclusive");
      }
    }
    const loaded = await loadWriteAttemptFile(value.attempt, plan);
    assert.equal(loaded.ok, true);
    if (loaded.ok && loaded.kind === "record") {
      assert.equal(loaded.record.phase, "attempting");
    }
  });
  },
);

test("session stop states happen before provider verification", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);
    const calls: Array<{
      readonly operation: BlooketWriteOperation;
      readonly remoteSetId: string | null;
    }> = [];

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser("rate-limited"),
      secrets(),
      verifier({ ok: true, outcome: "not-confirmed" }, calls),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "wait");
    }
    assert.deepEqual(calls, []);
    assert.equal(
      (await loadWriteAttemptFile(value.attempt, plan)).ok,
      true,
    );
  });
});

test(
  "missing login credentials stop before provider verification",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);
    const calls: Array<{
      readonly operation: BlooketWriteOperation;
      readonly remoteSetId: string | null;
    }> = [];

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser("signed-out"),
      secrets(),
      verifier({ ok: true, outcome: "not-confirmed" }, calls),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "session");
    }
    assert.deepEqual(calls, []);
  });
  },
);

test("verification navigation stops preserve ambiguous evidence", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser(),
      secrets(),
      verifier({
        ok: false,
        kind: "navigation",
        state: "security-challenge",
      }, []),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "human-action-required");
      if (result.kind === "human-action-required") {
        assert.equal(result.state, "security-challenge");
      }
    }
    assert.equal(
      (await loadWriteAttemptFile(value.attempt, plan)).ok,
      true,
    );
  });
});

test("verifier exceptions become stable verification failures", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);

    assert.deepEqual(
      await verifyPersistedBlooketWrite(
        value,
        plan,
        browser(),
        secrets(),
        verifier("throw", []),
      ),
      {
        ok: false,
        stage: "verification",
        code: "blooket-browser-failed",
      },
    );
    assert.equal(
      (await loadWriteAttemptFile(value.attempt, plan)).ok,
      true,
    );
  });
});

test("verification is skipped when no ambiguous journal exists", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    const browserCalls: string[] = [];
    const verifierCalls: Array<{
      readonly operation: BlooketWriteOperation;
      readonly remoteSetId: string | null;
    }> = [];

    const result = await verifyPersistedBlooketWrite(
      value,
      plan,
      browser("dashboard", browserCalls),
      secrets(),
      verifier({ ok: true, outcome: "not-confirmed" }, verifierCalls),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "ready");
    }
    assert.deepEqual(browserCalls, []);
    assert.deepEqual(verifierCalls, []);
  });
});

test("provider verification uses the shared execution lock", async () => {
  await withTemporaryDirectory(async (directory) => {
    const value = paths(directory);
    await beginWriteAttempt(value.attempt, plan, 0);
    const acquired = await tryAcquireFileLock(
      writeAttemptExecutionLockPath(value.attempt),
    );
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }

    assert.deepEqual(
      await verifyPersistedBlooketWrite(
        value,
        plan,
        browser(),
        secrets(),
        verifier({ ok: true, outcome: "not-confirmed" }, []),
      ),
      {
        ok: false,
        stage: "execution-lock",
        code: "write-execution-locked",
      },
    );
    await acquired.lock.release();
  });
});
