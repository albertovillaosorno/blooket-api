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
//   - Behavioral tests for persisted one-step Blooket write execution.
// - Must-Not:
//   - Contact Blooket or use production checkpoint paths.
// - Allows:
//   - Inputs: Temporary checkpoint files and in-memory port doubles.
//   - Outputs: Durable advancement and recovery-required verdicts.
//   - Side effects: Temporary files removed after each test.
// - Split-When:
//   - Crash-intent journal recovery gains a dedicated workflow.
// - Merge-When:
//   - Persisted execution composition is removed.
// - Summary:
//   - Proves confirmed writes persist before advanced success is returned.
// - Description:
//   - Post-write save failure is surfaced without suggesting automatic retry.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Missing checkpoint files imply operation index zero.
//
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executePersistedBlooketWrite } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/blooket-write-execution/application/execute-persisted.ts";
import type { BlooketMutationPacer } from
  "../../../../src/api/blooket-write-execution/application/mutation-pacing.ts";
import type {
  BlooketBrowserObservationResult,
  BlooketBrowserSessionPort,
} from "../../../../src/api/blooket-session/contract/browser-session.ts";
import type {
  BlooketWriteAttemptResult,
  BlooketWriteExecutionPort,
} from
  "../../../../src/api/blooket-write-execution/contract/write-execution.ts";
import type {
  BlooketWriteVerificationBaselineResult,
  BlooketWriteVerificationPort,
} from
  "../../../../src/api/blooket-write-execution/contract/write-verification.ts";
import { loadWriteAttemptFile } from
  "../../../../src/platforms/write-attempt-files/adapter-outbound/file.ts";
import { loadMutationBudgetFile } from
  "../../../../src/platforms/mutation-budget-files/adapter-outbound/file.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import type { FileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import type { BlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";
import type { HostSecretStore } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";

const plan: BlooketWritePlan = {
  schemaVersion: 1,
  planId: "plan:persisted-test",
  desiredStateSha256: "fixture",
  operations: [
    {
      operationId: "plan:persisted-test:set",
      kind: "set",
      title: "Fractions",
      description: "Review.",
      visibility: "private",
      coverMediaId: null,
    },
    {
      operationId: "plan:persisted-test:q:0",
      kind: "question",
      localQuestionId: "q1",
      questionNumber: 1,
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
const mediaPlan: BlooketWritePlan = {
  ...plan,
  planId: "plan:persisted-media-test",
  operations: [{
    ...plan.operations[0]!,
    operationId: "plan:persisted-media-test:set",
    coverMediaId: "cover",
  }],
};

const SET_SUCCESS = { ok: true as const, receipt: SET_RECEIPT };
const QUESTION_SUCCESS = { ok: true as const, receipt: null };

const SET_BASELINE = {
  schemaVersion: 1 as const,
  kind: "set-list" as const,
  itemCount: 3,
  sha256: "a".repeat(64),
};
const QUESTION_BASELINE = {
  schemaVersion: 1 as const,
  kind: "question-list" as const,
  itemCount: 1,
  sha256: "b".repeat(64),
};

function browser(calls: string[]): BlooketBrowserSessionPort {
  return {
    observe: async () => {
      calls.push("observe");
      return { ok: true, state: "dashboard" };
    },
    authenticate: async () => {
      calls.push("authenticate");
      return { ok: true };
    },
  };
}

function browserSequence(
  observations: readonly BlooketBrowserObservationResult[],
  calls: string[],
): BlooketBrowserSessionPort {
  let index = 0;
  return {
    observe: async () => {
      calls.push("observe");
      const observation = observations[index];
      index += 1;
      if (observation === undefined)
        throw new Error("fixture browser sequence exhausted");
      return observation;
    },
    authenticate: async () => {
      calls.push("authenticate");
      throw new Error("revalidation must not authenticate");
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

function writes(
  result: BlooketWriteAttemptResult,
  calls: string[],
  beforeReturn?: () => Promise<void>,
  targets: Array<string | null> = [],
): BlooketWriteExecutionPort {
  return {
    execute: async (operation, target) => {
      calls.push(operation.operationId);
      targets.push(target.remoteSetId);
      if (beforeReturn !== undefined) {
        await beforeReturn();
      }
      return result;
    },
  };
}

function verificationSequence(
  results: readonly BlooketWriteVerificationBaselineResult[],
  calls: Array<{
    readonly operationId: string;
    readonly remoteSetId: string | null;
  }> = [],
): BlooketWriteVerificationPort {
  let index = 0;
  return {
    captureBaseline: async (operation, target) => {
      calls.push({
        operationId: operation.operationId,
        remoteSetId: target.remoteSetId,
      });
      const result = results[index];
      index += 1;
      if (result === undefined)
        throw new Error("fixture baseline sequence exhausted");
      return result;
    },
    verify: async () => ({
      ok: true,
      outcome: "inconclusive",
    }),
  };
}

function verification(
  result: BlooketWriteVerificationBaselineResult | "throw",
  calls: Array<{
    readonly operationId: string;
    readonly remoteSetId: string | null;
  }> = [],
): BlooketWriteVerificationPort {
  return {
    captureBaseline: async (operation, target) => {
      calls.push({
        operationId: operation.operationId,
        remoteSetId: target.remoteSetId,
      });
      if (result === "throw") {
        throw new Error("fixture baseline failure");
      }
      return result;
    },
    verify: async () => ({
      ok: true,
      outcome: "inconclusive",
    }),
  };
}

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-persisted-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function persistence(path: string) {
  return {
    checkpoint: path,
    attempt: path + ".attempt",
  };
}

function immediatePacer(
  events: string[],
  signalSeen: AbortSignal[] = [],
): BlooketMutationPacer {
  return {
    acquire: async (signal) => {
      events.push("acquire");
      if (signal !== undefined) signalSeen.push(signal);
      return {
        ok: true,
        lease: {
          startedAtMs: 0,
          release: () => {
            events.push("release");
          },
        },
      };
    },
  };
}

function serialPacer(events: string[]): BlooketMutationPacer {
  let tail: Promise<void> = Promise.resolve();
  return {
    acquire: async () => {
      const previous = tail;
      let releaseSlot!: () => void;
      tail = new Promise<void>((resolve) => {
        releaseSlot = resolve;
      });
      await previous;
      events.push("acquire");
      let released = false;
      return {
        ok: true,
        lease: {
          startedAtMs: 0,
          release: () => {
            if (released) return;
            released = true;
            events.push("release");
            releaseSlot();
          },
        },
      };
    },
  };
}

test("abort after pacing grant still stops before journal", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const controller = new AbortController();
    const events: string[] = [];
    const pacer: BlooketMutationPacer = {
      acquire: async () => {
        events.push("acquire");
        controller.abort();
        return {
          ok: true,
          lease: {
            startedAtMs: 0,
            release: () => {
              events.push("release");
            },
          },
        };
      },
    };
    const writeCalls: string[] = [];

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      undefined,
      { pacer, signal: controller.signal },
    );

    assert.deepEqual(result, {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-cancelled",
    });
    assert.deepEqual(events, ["acquire", "release"]);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
});

test(
  "pacing exceptions fail stably before budget journal or mutation",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const checkpoint = join(directory, "checkpoint.json");
    const paths = persistence(checkpoint);
    const budgetPath = join(directory, "budget.json");
    const writeCalls: string[] = [];
    const pacer: BlooketMutationPacer = {
      acquire: async () => {
        throw new Error("synthetic-pacing-failure");
      },
    };

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      undefined,
      {
        pacer,
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 60_000,
        },
      },
    );

    assert.deepEqual(result, {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-failed",
    });
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      { ok: true, state: null },
    );
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test(
  "budget clock exceptions fail stably before journal or mutation",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const checkpoint = join(directory, "checkpoint.json");
    const paths = persistence(checkpoint);
    const budgetPath = join(directory, "budget.json");
    const events: string[] = [];
    const writeCalls: string[] = [];

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      undefined,
      {
        pacer: immediatePacer(events),
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => {
            throw new Error("synthetic-clock-failure");
          },
        },
      },
    );

    assert.deepEqual(result, {
      ok: false,
      stage: "mutation-budget",
      code: "mutation-budget-admission-failed",
    });
    assert.deepEqual(events, ["acquire", "release"]);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      { ok: true, state: null },
    );
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test("pacing cancellation stops before journal and mutation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const writeCalls: string[] = [];
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const pacer: BlooketMutationPacer = {
      acquire: async (signal) => {
        if (signal !== undefined) signals.push(signal);
        return { ok: false, code: "mutation-pacing-cancelled" };
      },
    };

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      undefined,
      { pacer, signal: controller.signal },
    );

    assert.deepEqual(result, {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-cancelled",
    });
    assert.deepEqual(signals, [controller.signal]);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
});

test("pacing lease releases when journal admission fails", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const budgetPath = join(directory, "budget.json");
    const events: string[] = [];
    const writeCalls: string[] = [];

    const pacer: BlooketMutationPacer = {
      acquire: async () => {
        events.push("acquire");
        await mkdir(paths.attempt);
        return {
          ok: true,
          lease: {
            startedAtMs: 0,
            release: () => {
              events.push("release");
            },
          },
        };
      },
    };
    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      verification({
        ok: true,
        baseline: SET_BASELINE,
      }),
      {
        pacer,
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 30_000,
        },
      },
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.stage, "attempt-begin");
    assert.deepEqual(events, ["acquire", "release"]);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      {
        ok: true,
        state: { version: 1, startedAtMs: 30_000, starts: 1 },
      },
    );
  });
});

test(
  "remote state changes during pacing stop before budget and journal",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const checkpoint = join(directory, "checkpoint.json");
    const paths = persistence(checkpoint);
    const budgetPath = join(directory, "budget.json");
    const pacingEvents: string[] = [];
    const writeCalls: string[] = [];
    const verificationCalls: Array<{
      readonly operationId: string;
      readonly remoteSetId: string | null;
    }> = [];
    const changedBaseline = {
      ...SET_BASELINE,
      sha256: "c".repeat(64),
    };

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      verificationSequence([
        { ok: true, baseline: SET_BASELINE },
        { ok: true, baseline: changedBaseline },
      ], verificationCalls),
      {
        pacer: immediatePacer(pacingEvents),
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 70_000,
        },
      },
    );

    assert.deepEqual(result, {
      ok: false,
      stage: "remote-precondition",
      code: "blooket-remote-state-changed",
      operationId: "plan:persisted-test:set",
    });
    assert.deepEqual(pacingEvents, ["acquire", "release"]);
    assert.deepEqual(writeCalls, []);
    assert.equal(verificationCalls.length, 2);
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      { ok: true, state: null },
    );
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test(
  "session changes during pacing stop without auth budget journal or write",
  async () => {
    const cases = [
      {
        state: "expired-session" as const,
        kind: "session-required" as const,
      },
      {
        state: "security-challenge" as const,
        kind: "human-action-required" as const,
      },
      {
        state: "rate-limited" as const,
        kind: "wait" as const,
      },
    ];

    for (const entry of cases) {
      await withTemporaryDirectory(async (directory) => {
        const checkpoint = join(directory, "checkpoint.json");
        const paths = persistence(checkpoint);
        const budgetPath = join(directory, "budget.json");
        const browserCalls: string[] = [];
        const pacingEvents: string[] = [];
        const writeCalls: string[] = [];
        const verificationCalls: Array<{
          readonly operationId: string;
          readonly remoteSetId: string | null;
        }> = [];

        const result = await executePersistedBlooketWrite(
          paths,
          plan,
          browserSequence([
            { ok: true, state: "dashboard" },
            { ok: true, state: entry.state },
          ], browserCalls),
          secrets(),
          writes(SET_SUCCESS, writeCalls),
          verificationSequence([
            { ok: true, baseline: SET_BASELINE },
          ], verificationCalls),
          {
            pacer: immediatePacer(pacingEvents),
            budget: {
              path: budgetPath,
              policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
              now: () => 92_000,
            },
          },
        );

        assert.equal(result.ok, true);
        if (result.ok) {
          assert.equal(result.kind, entry.kind);
          if (
            result.kind === "session-required"
            || result.kind === "human-action-required"
            || result.kind === "wait"
          )
            assert.equal(result.state, entry.state);
        }
        assert.deepEqual(browserCalls, ["observe", "observe"]);
        assert.deepEqual(pacingEvents, ["acquire", "release"]);
        assert.deepEqual(writeCalls, []);
        assert.equal(verificationCalls.length, 1);
        assert.deepEqual(
          await loadMutationBudgetFile(budgetPath, plan.planId),
          { ok: true, state: null },
        );
        assert.deepEqual(
          await loadWriteAttemptFile(paths.attempt, plan),
          { ok: true, kind: "missing" },
        );
      });
    }
  },
);

test(
  "invalid second baseline releases pacing before budget or journal",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const checkpoint = join(directory, "checkpoint.json");
      const paths = persistence(checkpoint);
      const budgetPath = join(directory, "budget.json");
      const pacingEvents: string[] = [];
      const writeCalls: string[] = [];
      const invalidSecond = {
        ok: true,
        baseline: {
          ...SET_BASELINE,
          sha256: "not-a-digest",
        },
      } as unknown as BlooketWriteVerificationBaselineResult;

      const result = await executePersistedBlooketWrite(
        paths,
        plan,
        browser([]),
        secrets(),
        writes(SET_SUCCESS, writeCalls),
        verificationSequence([
          { ok: true, baseline: SET_BASELINE },
          invalidSecond,
        ]),
        {
          pacer: immediatePacer(pacingEvents),
          budget: {
            path: budgetPath,
            policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
            now: () => 95_000,
          },
        },
      );

      assert.deepEqual(result, {
        ok: false,
        stage: "verification-baseline",
        code: "blooket-write-baseline-invalid",
      });
      assert.deepEqual(pacingEvents, ["acquire", "release"]);
      assert.deepEqual(writeCalls, []);
      assert.deepEqual(
        await loadMutationBudgetFile(budgetPath, plan.planId),
        { ok: true, state: null },
      );
      assert.deepEqual(
        await loadWriteAttemptFile(paths.attempt, plan),
        { ok: true, kind: "missing" },
      );
    });
  },
);

test(
  "challenge during pre-write revalidation stops without budget or journal",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const checkpoint = join(directory, "checkpoint.json");
    const paths = persistence(checkpoint);
    const budgetPath = join(directory, "budget.json");
    const pacingEvents: string[] = [];
    const writeCalls: string[] = [];

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      verificationSequence([
        { ok: true, baseline: SET_BASELINE },
        {
          ok: false,
          kind: "navigation",
          state: "security-challenge",
        },
      ]),
      {
        pacer: immediatePacer(pacingEvents),
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 80_000,
        },
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "human-action-required");
      if (result.kind === "human-action-required")
        assert.equal(result.state, "security-challenge");
    }
    assert.deepEqual(pacingEvents, ["acquire", "release"]);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      { ok: true, state: null },
    );
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test(
  "cancellation during media admission stops before budget journal or write",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "checkpoint.json");
      const paths = persistence(path);
      const budgetPath = join(directory, "budget.json");
      const controller = new AbortController();
      const pacingEvents: string[] = [];
      const writeCalls: string[] = [];

      const result = await executePersistedBlooketWrite(
        paths,
        mediaPlan,
        browser([]),
        secrets(),
        writes(SET_SUCCESS, writeCalls),
        verification({
          ok: true,
          baseline: SET_BASELINE,
        }),
        {
          signal: controller.signal,
          pacer: immediatePacer(pacingEvents),
          media: {
            read: async (mediaId) => {
              controller.abort();
              return {
                ok: true,
                value: {
                  mediaId,
                  revision: 1,
                  format: "png",
                  bytes: new Uint8Array([1]),
                },
              };
            },
          },
          budget: {
            path: budgetPath,
            policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
            now: () => 97_000,
          },
        },
      );

      assert.deepEqual(result, {
        ok: false,
        stage: "mutation-pacing",
        code: "mutation-pacing-cancelled",
      });
      assert.deepEqual(pacingEvents, ["acquire", "release"]);
      assert.deepEqual(writeCalls, []);
      assert.deepEqual(
        await loadMutationBudgetFile(budgetPath, mediaPlan.planId),
        { ok: true, state: null },
      );
      assert.deepEqual(
        await loadWriteAttemptFile(paths.attempt, mediaPlan),
        { ok: true, kind: "missing" },
      );
    });
  },
);

test(
  "media-required write stops before budget journal when resolver is absent",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "checkpoint.json");
      const paths = persistence(path);
      const budgetPath = join(directory, "budget.json");
      const writeCalls: string[] = [];
      const pacingEvents: string[] = [];
      const verificationCalls: Array<{
        readonly operationId: string;
        readonly remoteSetId: string | null;
      }> = [];

      const result = await executePersistedBlooketWrite(
        paths,
        mediaPlan,
        browser([]),
        secrets(),
        writes(SET_SUCCESS, writeCalls),
        verification({
          ok: true,
          baseline: SET_BASELINE,
        }, verificationCalls),
        {
          pacer: immediatePacer(pacingEvents),
          budget: {
            path: budgetPath,
            policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
            now: () => 96_000,
          },
        },
      );

      assert.deepEqual(result, {
        ok: false,
        stage: "prepared-media",
        code: "blooket-media-unavailable",
        mediaId: "cover",
      });
      assert.deepEqual(pacingEvents, ["acquire", "release"]);
      assert.deepEqual(writeCalls, []);
      assert.equal(verificationCalls.length, 1);
      assert.deepEqual(
        await loadMutationBudgetFile(budgetPath, mediaPlan.planId),
        { ok: true, state: null },
      );
      assert.deepEqual(
        await loadWriteAttemptFile(paths.attempt, mediaPlan),
        { ok: true, kind: "missing" },
      );
    });
  },
);

test(
  "persisted write passes the exact admitted media snapshot to mutation",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "checkpoint.json");
      const paths = persistence(path);
      const bytes = new Uint8Array([9, 8, 7, 6]);
      let receivedBytes: Uint8Array | undefined;
      const writesWithMedia: BlooketWriteExecutionPort = {
        execute: async (_operation, _target, context) => {
          receivedBytes = context.preparedMedia[0]?.bytes;
          return SET_SUCCESS;
        },
      };

      const result = await executePersistedBlooketWrite(
        paths,
        mediaPlan,
        browser([]),
        secrets(),
        writesWithMedia,
        verification({
          ok: true,
          baseline: SET_BASELINE,
        }),
        {
          media: {
            read: async (mediaId) => ({
              ok: true,
              value: {
                mediaId,
                revision: 5,
                format: "png",
                bytes,
              },
            }),
          },
        },
      );

      assert.equal(result.ok, true);
      assert.notEqual(receivedBytes, bytes);
      assert.deepEqual(receivedBytes, bytes);
      bytes.fill(0);
      assert.deepEqual(Array.from(receivedBytes ?? []), [9, 8, 7, 6]);
      const attempt = await loadWriteAttemptFile(paths.attempt, mediaPlan);
      assert.equal(attempt.ok, true);
      if (attempt.ok && attempt.kind === "record")
        assert.equal(attempt.record.phase, "confirmed");
    });
  },
);

test("durable budget reservation precedes journaled mutation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const checkpoint = join(directory, "checkpoint.json");
    const paths = persistence(checkpoint);
    const budgetPath = join(directory, "budget.json");
    const events: string[] = [];
    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, [], async () => {
        events.push("write");
        assert.deepEqual(
          await loadMutationBudgetFile(budgetPath, plan.planId),
          {
            ok: true,
            state: { version: 1, startedAtMs: 10_000, starts: 1 },
          },
        );
        const attempt = await loadWriteAttemptFile(paths.attempt, plan);
        assert.equal(attempt.ok, true);
        if (attempt.ok && attempt.kind === "record")
          assert.equal(attempt.record.phase, "attempting");
      }),
      undefined,
      {
        pacer: immediatePacer(events),
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 10_000,
        },
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(events, ["acquire", "write", "release"]);
  });
});

test(
  "exhausted durable budget stops before journal and releases pacing",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const checkpoint = join(directory, "checkpoint.json");
    const paths = persistence(checkpoint);
    const budgetPath = join(directory, "budget.json");
    const policy = { maximumStarts: 1, maximumDurationMs: 60_000 };
    const events: string[] = [];
    const writeCalls: string[] = [];

    const first = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      undefined,
      {
        pacer: immediatePacer(events),
        budget: { path: budgetPath, policy, now: () => 10_000 },
      },
    );
    assert.equal(first.ok, true);

    const secondPaths = persistence(join(directory, "second.json"));
    const second = await executePersistedBlooketWrite(
      secondPaths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      undefined,
      {
        pacer: immediatePacer(events),
        budget: { path: budgetPath, policy, now: () => 12_000 },
      },
    );

    assert.deepEqual(second, {
      ok: false,
      stage: "mutation-budget",
      code: "mutation-task-start-budget-exhausted",
    });
    assert.deepEqual(writeCalls, ["plan:persisted-test:set"]);
    assert.deepEqual(
      await loadWriteAttemptFile(secondPaths.attempt, plan),
      { ok: true, kind: "missing" },
    );
    assert.deepEqual(events, [
      "acquire",
      "release",
      "acquire",
      "release",
    ]);
  });
  },
);

test(
  "ambiguous writes retain their consumed durable budget start",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const checkpoint = join(directory, "checkpoint.json");
    const paths = persistence(checkpoint);
    const budgetPath = join(directory, "budget.json");
    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes({
        ok: false,
        kind: "navigation",
        state: "rate-limited",
      }, []),
      undefined,
      {
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 3, maximumDurationMs: 60_000 },
          now: () => 20_000,
        },
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.kind, "reconciliation-required");
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      {
        ok: true,
        state: { version: 1, startedAtMs: 20_000, starts: 1 },
      },
    );
    const attempt = await loadWriteAttemptFile(paths.attempt, plan);
    assert.equal(attempt.ok, true);
    if (attempt.ok && attempt.kind === "record")
      assert.equal(attempt.record.phase, "attempting");
  });
  },
);

test("pacing lease spans only journaled remote mutation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const events: string[] = [];
    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, [], async () => {
        events.push("write");
        assert.deepEqual(events, ["acquire", "write"]);
        const attempt = await loadWriteAttemptFile(paths.attempt, plan);
        assert.equal(attempt.ok, true);
        if (attempt.ok && attempt.kind === "record")
          assert.equal(attempt.record.phase, "attempting");
      }),
      undefined,
      { pacer: immediatePacer(events) },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(events, ["acquire", "write", "release"]);
  });
});

test("one shared pacer serializes distinct persisted write paths", async () => {
  await withTemporaryDirectory(async (directory) => {
    const firstPaths = persistence(join(directory, "first.json"));
    const secondPaths = persistence(join(directory, "second.json"));
    const events: string[] = [];
    const pacer = serialPacer(events);
    let enterFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      enterFirst = resolve;
    });
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstWrites: string[] = [];
    const secondWrites: string[] = [];

    const first = executePersistedBlooketWrite(
      firstPaths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, firstWrites, async () => {
        events.push("first-write");
        enterFirst();
        await holdFirst;
      }),
      undefined,
      { pacer },
    );
    await firstEntered;

    const second = executePersistedBlooketWrite(
      secondPaths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, secondWrites, async () => {
        events.push("second-write");
      }),
      undefined,
      { pacer },
    );
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(firstWrites, ["plan:persisted-test:set"]);
    assert.deepEqual(secondWrites, []);
    assert.deepEqual(
      await loadWriteAttemptFile(secondPaths.attempt, plan),
      { ok: true, kind: "missing" },
    );

    releaseFirst();
    const firstResult = await first;
    const secondResult = await second;
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.deepEqual(secondWrites, ["plan:persisted-test:set"]);
    assert.deepEqual(events, [
      "acquire",
      "first-write",
      "release",
      "acquire",
      "second-write",
      "release",
    ]);
  });
});

test("confirmed writes persist before advanced success returns", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const writeCalls: string[] = [];

    const attemptPath = path + ".attempt";
    const browserCalls: string[] = [];
    const result = await executePersistedBlooketWrite(
      {
        ...persistence(path),
        attempt: attemptPath,
      },
      plan,
      browser(browserCalls),
      secrets(),
      writes(SET_SUCCESS, writeCalls, async () => {
        assert.deepEqual(browserCalls, ["observe", "observe"]);
        const attempt = await loadWriteAttemptFile(attemptPath, plan);
        assert.equal(attempt.ok, true);
        if (attempt.ok && attempt.kind === "record") {
          assert.equal(attempt.record.phase, "attempting");
          assert.equal(attempt.record.operationIndex, 0);
          assert.equal(attempt.record.receipt, null);
          assert.equal(attempt.record.baseline, null);
        }
      }),
    );

    assert.deepEqual(result, {
      ok: true,
      kind: "advanced",
      operationId: "plan:persisted-test:set",
      checkpoint: {
        schemaVersion: 2,
        planId: plan.planId,
        nextOperationIndex: 1,
        remoteSetId: "remote-set-1",
      },
    });
    assert.deepEqual(
      JSON.parse(await readFile(path, "utf8")),
      result.ok && result.kind === "advanced"
        ? result.checkpoint
        : null,
    );
    assert.deepEqual(writeCalls, ["plan:persisted-test:set"]);
    assert.deepEqual(
      await loadWriteAttemptFile(attemptPath, plan),
      { ok: true, kind: "missing" },
    );
  });
});

test("captured set baseline is durable before remote mutation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const writeCalls: string[] = [];
    const verificationCalls: Array<{
      readonly operationId: string;
      readonly remoteSetId: string | null;
    }> = [];

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls, async () => {
        const attempt = await loadWriteAttemptFile(paths.attempt, plan);
        assert.equal(attempt.ok, true);
        if (attempt.ok && attempt.kind === "record") {
          assert.deepEqual(attempt.record.baseline, SET_BASELINE);
          assert.equal(attempt.record.phase, "attempting");
        }
      }),
      verification({
        ok: true,
        baseline: SET_BASELINE,
      }, verificationCalls),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(writeCalls, ["plan:persisted-test:set"]);
    assert.deepEqual(verificationCalls, [
      {
        operationId: "plan:persisted-test:set",
        remoteSetId: null,
      },
      {
        operationId: "plan:persisted-test:set",
        remoteSetId: null,
      },
    ]);
  });
});

test("baseline capture stops happen before journal or mutation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const writeCalls: string[] = [];
    const pacingEvents: string[] = [];
    const budgetPath = join(directory, "budget.json");

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      verification({
        ok: false,
        kind: "navigation",
        state: "security-challenge",
      }),
      {
        pacer: immediatePacer(pacingEvents),
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 40_000,
        },
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "human-action-required");
    }
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(pacingEvents, []);
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      { ok: true, state: null },
    );
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
});

test(
  "mismatched captured baseline fails before pacing budget or mutation",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const budgetPath = join(directory, "budget.json");
    const writeCalls: string[] = [];
    const pacingEvents: string[] = [];

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      verification({
        ok: true,
        baseline: QUESTION_BASELINE,
      }),
      {
        pacer: immediatePacer(pacingEvents),
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 90_000,
        },
      },
    );

    assert.deepEqual(result, {
      ok: false,
      stage: "verification-baseline",
      code: "blooket-write-baseline-invalid",
    });
    assert.deepEqual(pacingEvents, []);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      { ok: true, state: null },
    );
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
  },
);

test("persisted progress resumes at the exact next operation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 2,
      planId: plan.planId,
      nextOperationIndex: 1,
      remoteSetId: "remote-set-1",
    }));
    const writeCalls: string[] = [];
    const targets: Array<string | null> = [];
    const verificationCalls: Array<{
      readonly operationId: string;
      readonly remoteSetId: string | null;
    }> = [];
    const paths = persistence(path);

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(QUESTION_SUCCESS, writeCalls, async () => {
        const attempt = await loadWriteAttemptFile(paths.attempt, plan);
        assert.equal(attempt.ok, true);
        if (attempt.ok && attempt.kind === "record") {
          assert.deepEqual(attempt.record.baseline, QUESTION_BASELINE);
        }
      }, targets),
      verification({
        ok: true,
        baseline: QUESTION_BASELINE,
      }, verificationCalls),
    );

    assert.equal(result.ok, true);
    if (result.ok && result.kind === "advanced") {
      assert.equal(result.checkpoint.nextOperationIndex, 2);
    }
    assert.deepEqual(writeCalls, ["plan:persisted-test:q:0"]);
    assert.deepEqual(targets, ["remote-set-1"]);
    assert.deepEqual(verificationCalls, [
      {
        operationId: "plan:persisted-test:q:0",
        remoteSetId: "remote-set-1",
      },
      {
        operationId: "plan:persisted-test:q:0",
        remoteSetId: "remote-set-1",
      },
    ]);
  });
});

test(
  "invalid persisted checkpoints fail before browser side effects",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    await writeFile(path, "{");
    const browserCalls: string[] = [];
    const writeCalls: string[] = [];

    const result = await executePersistedBlooketWrite(
      persistence(path),
      plan,
      browser(browserCalls),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "checkpoint-load");
    }
    assert.deepEqual(browserCalls, []);
    assert.deepEqual(writeCalls, []);
  });
  },
);

test(
  "non-advanced outcomes leave checkpoint persistence untouched",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const result = await executePersistedBlooketWrite(
      persistence(path),
      plan,
      browser([]),
      secrets(),
      writes({
        ok: false,
        kind: "navigation",
        state: "rate-limited",
      }, []),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.kind, "reconciliation-required");
      if (result.kind === "reconciliation-required") {
        assert.equal(result.reason, "write-not-confirmed");
        assert.equal(result.attempt.phase, "attempting");
        assert.equal(result.outcome.ok, true);
        if (result.outcome.ok) {
          assert.equal(result.outcome.kind, "wait");
        }
      }
    }
    await assert.rejects(readFile(path, "utf8"));
    const attempt = await loadWriteAttemptFile(path + ".attempt", plan);
    assert.equal(attempt.ok, true);
    if (attempt.ok && attempt.kind === "record") {
      assert.equal(attempt.record.phase, "attempting");
    }

    const browserCalls: string[] = [];
    const writeCalls: string[] = [];
    const resumed = await executePersistedBlooketWrite(
      persistence(path),
      plan,
      browser(browserCalls),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
    );
    assert.equal(resumed.ok, true);
    if (resumed.ok) {
      assert.equal(resumed.kind, "reconciliation-required");
      if (resumed.kind === "reconciliation-required") {
        assert.equal(resumed.reason, "ambiguous-attempt");
      }
    }
    assert.deepEqual(browserCalls, []);
    assert.deepEqual(writeCalls, []);
  });
  },
);

test(
  "confirmed remote writes surface checkpoint save failure as recovery",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "checkpoint.json");
      let heldLock: FileLock | undefined;
      const result = await executePersistedBlooketWrite(
        persistence(path),
        plan,
        browser([]),
        secrets(),
        writes(SET_SUCCESS, [], async () => {
          const acquired = await tryAcquireFileLock(path + ".lock");
          assert.equal(acquired.ok, true);
          if (acquired.ok) {
            heldLock = acquired.lock;
          }
        }),
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(
          result.stage,
          "checkpoint-save-after-confirmed-write",
        );
        if (
          result.stage
          === "checkpoint-save-after-confirmed-write"
        ) {
          assert.equal(result.operationId, "plan:persisted-test:set");
          assert.equal(result.checkpoint.nextOperationIndex, 1);
          assert.deepEqual(result.cause, {
            ok: false,
            kind: "io",
            code: "checkpoint-file-locked",
          });
        }
      }
      await assert.rejects(readFile(path, "utf8"));
      const attempt = await loadWriteAttemptFile(path + ".attempt", plan);
      assert.equal(attempt.ok, true);
      if (attempt.ok && attempt.kind === "record") {
        assert.equal(attempt.record.phase, "confirmed");
        assert.deepEqual(attempt.record.receipt, SET_RECEIPT);
      }

      await heldLock?.release();

      const writeCalls: string[] = [];
      const recovered = await executePersistedBlooketWrite(
        persistence(path),
        plan,
        browser([]),
        secrets(),
        writes(SET_SUCCESS, writeCalls),
      );
      assert.equal(recovered.ok, true);
      if (recovered.ok) {
        assert.equal(recovered.kind, "recovered");
      }
      assert.deepEqual(writeCalls, []);
      assert.deepEqual(
        JSON.parse(await readFile(path, "utf8")),
        {
          schemaVersion: 2,
          planId: plan.planId,
          nextOperationIndex: 1,
          remoteSetId: "remote-set-1",
        },
      );
      assert.deepEqual(
        await loadWriteAttemptFile(path + ".attempt", plan),
        { ok: true, kind: "missing" },
      );
    });
  },
);

test("execution lock prevents stale concurrent duplicate writes", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const persistencePaths = persistence(path);
    const firstBrowserCalls: string[] = [];
    const firstWriteCalls: string[] = [];
    const secondBrowserCalls: string[] = [];
    const secondWriteCalls: string[] = [];

    let markEntered = () => {};
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let releaseWrite = () => {};
    const holdWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    const first = executePersistedBlooketWrite(
      persistencePaths,
      plan,
      browser(firstBrowserCalls),
      secrets(),
      {
        execute: async (operation) => {
          firstWriteCalls.push(operation.operationId);
          markEntered();
          await holdWrite;
          return SET_SUCCESS;
        },
      },
    );

    await entered;

    const second = await executePersistedBlooketWrite(
      persistencePaths,
      plan,
      browser(secondBrowserCalls),
      secrets(),
      writes(SET_SUCCESS, secondWriteCalls),
    );

    assert.deepEqual(second, {
      ok: false,
      stage: "execution-lock",
      code: "write-execution-locked",
    });
    assert.deepEqual(secondBrowserCalls, []);
    assert.deepEqual(secondWriteCalls, []);

    releaseWrite();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
    if (firstResult.ok) {
      assert.equal(firstResult.kind, "advanced");
    }
    assert.deepEqual(firstBrowserCalls, ["observe", "observe"]);
    assert.deepEqual(
      firstWriteCalls,
      ["plan:persisted-test:set"],
    );
    assert.deepEqual(
      JSON.parse(await readFile(path, "utf8")),
      {
        schemaVersion: 2,
        planId: plan.planId,
        nextOperationIndex: 1,
        remoteSetId: "remote-set-1",
      },
    );
  });
});

test("session stop states never create an attempt journal", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const browserCalls: string[] = [];
    const writeCalls: string[] = [];
    const pacingEvents: string[] = [];
    const budgetPath = join(directory, "budget.json");
    const stoppedBrowser: BlooketBrowserSessionPort = {
      observe: async () => {
        browserCalls.push("observe");
        return { ok: true, state: "rate-limited" };
      },
      authenticate: async () => {
        browserCalls.push("authenticate");
        return { ok: true };
      },
    };

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      stoppedBrowser,
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      undefined,
      {
        pacer: immediatePacer(pacingEvents),
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 50_000,
        },
      },
    );

    assert.deepEqual(result, {
      ok: true,
      kind: "wait",
      state: "rate-limited",
      checkpoint: {
        schemaVersion: 2,
        planId: plan.planId,
        nextOperationIndex: 0,
        remoteSetId: null,
      },
    });
    assert.deepEqual(browserCalls, ["observe"]);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(pacingEvents, []);
    assert.deepEqual(
      await loadMutationBudgetFile(budgetPath, plan.planId),
      { ok: true, state: null },
    );
    assert.deepEqual(
      await loadWriteAttemptFile(paths.attempt, plan),
      { ok: true, kind: "missing" },
    );
  });
});

test("journal confirmation failure blocks checkpoint persistence", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const paths = persistence(path);
    const outside = join(directory, "outside.json");
    await writeFile(outside, "{}");

    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, [], async () => {
        await rm(paths.attempt);
        await symlink(outside, paths.attempt);
      }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.stage,
        "attempt-confirm-after-confirmed-write",
      );
      if (
        result.stage
        === "attempt-confirm-after-confirmed-write"
      ) {
        assert.equal(result.code, "confirmed-write-not-journaled");
        assert.equal(result.operationId, "plan:persisted-test:set");
        assert.deepEqual(result.cause, {
          ok: false,
          kind: "io",
          code: "write-attempt-file-unsafe",
        });
      }
    }
    await assert.rejects(readFile(path, "utf8"));
  });
});

test(
  "cancel after durable budget reservation never opens a write journal",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const paths = persistence(join(directory, "checkpoint.json"));
    const budgetPath = join(directory, "budget.json");
    const controller = new AbortController();
    const events: string[] = [];
    const writeCalls: string[] = [];
    const result = await executePersistedBlooketWrite(
      paths,
      plan,
      browser([]),
      secrets(),
      writes(SET_SUCCESS, writeCalls),
      undefined,
      {
        pacer: immediatePacer(events),
        signal: controller.signal,
        budget: {
          path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => {
            controller.abort();
            return 10_000;
          },
        },
      },
    );
    assert.deepEqual(result, {
      ok: false,
      stage: "mutation-pacing",
      code: "mutation-pacing-cancelled",
    });
    assert.deepEqual(events, ["acquire", "release"]);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(await loadWriteAttemptFile(paths.attempt, plan), {
      ok: true, kind: "missing",
    });
    assert.deepEqual(await loadMutationBudgetFile(budgetPath, plan.planId), {
      ok: true,
      state: { version: 1, startedAtMs: 10_000, starts: 1 },
    });
  });
  },
);


test("cancellation after journal persistence blocks mutation and replay",
  async () => {
    await withTemporaryDirectory(async directory => {
      const paths = persistence(join(directory, "checkpoint.json"));
      const events: string[] = [], calls: string[] = [];
      const signal = new AbortController().signal;
      // Deterministically expose cancellation at the asynchronous durable
      // journal boundary, rather than relying on a timing-sensitive timeout.
      Object.defineProperty(signal, "aborted", {
        get: () => existsSync(paths.attempt),
      });
      const result = await executePersistedBlooketWrite(
        paths, plan, browser([]), secrets(), writes(SET_SUCCESS, calls),
        undefined, { signal, pacer: immediatePacer(events) },
      );
      assert.deepEqual(result, { ok: false, stage: "mutation-pacing",
        code: "mutation-pacing-cancelled" });
      assert.deepEqual(events, ["acquire", "release"]);
      assert.deepEqual(calls, []);
      const journal = await readFile(paths.attempt, "utf8");
      const resumed = await executePersistedBlooketWrite(
        paths, plan, browser([]), secrets(), writes(SET_SUCCESS, calls),
      );
      assert.ok(resumed.ok && resumed.kind === "reconciliation-required");
      assert.deepEqual(calls, []);
      assert.equal(await readFile(paths.attempt, "utf8"), journal);
    });
  });


test("changed snapshot media stops before journal, budget or remote write",
  async () => {
  await withTemporaryDirectory(async directory => {
    const { identifyPreparedMedia } = await import(
// jig-ignore-next-line: TypeScript module specifier is indivisible.
      "../../../../src/projects/blooket-write-plans/domain/prepared-media-identities.ts"
    );
    const paths = persistence(join(directory, "checkpoint.json"));
    const budgetPath = join(directory, "budget.json");
    const calls: string[] = [];
    const pacing: string[] = [];
    const original = { mediaId: "cover", revision: 1, format: "png" as const,
      bytes: new Uint8Array([1, 2, 3]) };
    const result = await executePersistedBlooketWrite(paths, mediaPlan,
      browser([]), secrets(), writes(SET_SUCCESS, calls),
      verification({ ok: true, baseline: SET_BASELINE }), {
        pacer: immediatePacer(pacing),
        expectedMedia: { schemaVersion: 1,
          items: [identifyPreparedMedia(original)!] },
        media: { read: async () => ({ ok: true,
          value: { ...original, bytes: new Uint8Array([3, 2, 1]) } }) },
        budget: { path: budgetPath,
          policy: { maximumStarts: 2, maximumDurationMs: 60_000 },
          now: () => 96_000 },
      });
    assert.deepEqual(result, { ok: false, stage: "prepared-media",
      code: "blooket-media-stale", mediaId: "cover" });
    assert.deepEqual(calls, []);
    assert.deepEqual(pacing, ["acquire", "release"]);
    assert.deepEqual(await loadWriteAttemptFile(paths.attempt, mediaPlan),
      { ok: true, kind: "missing" });
    assert.deepEqual(await loadMutationBudgetFile(budgetPath, mediaPlan.planId),
      { ok: true, state: null });
  });
});
