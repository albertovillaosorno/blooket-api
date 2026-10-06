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

test("confirmed writes persist before advanced success returns", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "checkpoint.json");
    const writeCalls: string[] = [];

    const result = await executePersistedBlooketWrite(
      path,
      plan,
      browser([]),
      secrets(),
      writes({ ok: true }, writeCalls),
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
      path,
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
      path,
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
      path,
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
      assert.equal(result.kind, "wait");
    }
    await assert.rejects(readFile(path, "utf8"));
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
        path,
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
      await heldLock?.release();
    });
  },
);
