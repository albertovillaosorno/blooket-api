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
import {
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
import type { BlooketBrowserSessionPort } from
  "../../../../src/api/blooket-session/contract/browser-session.ts";
import type {
  BlooketWriteAttemptResult,
  BlooketWriteExecutionPort,
} from
  "../../../../src/api/blooket-write-execution/contract/write-execution.ts";
import { loadWriteAttemptFile } from
  "../../../../src/platforms/write-attempt-files/adapter-outbound/file.ts";
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
): BlooketWriteExecutionPort {
  return {
    execute: async (operation) => {
      calls.push(operation.operationId);
      if (beforeReturn !== undefined) {
        await beforeReturn();
      }
      return result;
    },
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
    executionLock: path + ".execution.lock",
  };
}

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
      writes({ ok: true }, writeCalls, async () => {
        assert.deepEqual(browserCalls, ["observe"]);
        const attempt = await loadWriteAttemptFile(attemptPath, plan);
        assert.equal(attempt.ok, true);
        if (attempt.ok && attempt.kind === "record") {
          assert.equal(attempt.record.phase, "attempting");
          assert.equal(attempt.record.operationIndex, 0);
        }
      }),
    );

    assert.deepEqual(result, {
      ok: true,
      kind: "advanced",
      operationId: "plan:persisted-test:set",
      checkpoint: {
        schemaVersion: 1,
        planId: plan.planId,
        nextOperationIndex: 1,
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

test("persisted progress resumes at the exact next operation", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      planId: plan.planId,
      nextOperationIndex: 1,
    }));
    const writeCalls: string[] = [];

    const result = await executePersistedBlooketWrite(
      persistence(path),
      plan,
      browser([]),
      secrets(),
      writes({ ok: true }, writeCalls),
    );

    assert.equal(result.ok, true);
    if (result.ok && result.kind === "advanced") {
      assert.equal(result.checkpoint.nextOperationIndex, 2);
    }
    assert.deepEqual(writeCalls, ["plan:persisted-test:q:0"]);
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
      writes({ ok: true }, writeCalls),
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
      writes({ ok: true }, writeCalls),
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
        writes({ ok: true }, [], async () => {
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
      }

      await heldLock?.release();

      const writeCalls: string[] = [];
      const recovered = await executePersistedBlooketWrite(
        persistence(path),
        plan,
        browser([]),
        secrets(),
        writes({ ok: true }, writeCalls),
      );
      assert.equal(recovered.ok, true);
      if (recovered.ok) {
        assert.equal(recovered.kind, "recovered");
      }
      assert.deepEqual(writeCalls, []);
      assert.deepEqual(
        JSON.parse(await readFile(path, "utf8")),
        {
          schemaVersion: 1,
          planId: plan.planId,
          nextOperationIndex: 1,
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
          return { ok: true };
        },
      },
    );

    await entered;

    const second = await executePersistedBlooketWrite(
      persistencePaths,
      plan,
      browser(secondBrowserCalls),
      secrets(),
      writes({ ok: true }, secondWriteCalls),
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
    assert.deepEqual(firstBrowserCalls, ["observe"]);
    assert.deepEqual(
      firstWriteCalls,
      ["plan:persisted-test:set"],
    );
    assert.deepEqual(
      JSON.parse(await readFile(path, "utf8")),
      {
        schemaVersion: 1,
        planId: plan.planId,
        nextOperationIndex: 1,
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
      writes({ ok: true }, writeCalls),
    );

    assert.deepEqual(result, {
      ok: true,
      kind: "wait",
      state: "rate-limited",
      checkpoint: {
        schemaVersion: 1,
        planId: plan.planId,
        nextOperationIndex: 0,
      },
    });
    assert.deepEqual(browserCalls, ["observe"]);
    assert.deepEqual(writeCalls, []);
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
      writes({ ok: true }, [], async () => {
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
