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
//   - Filesystem tests for durable sequential write-checkpoint persistence.
// - Must-Not:
//   - Execute Blooket writes or use production project directories.
// - Allows:
//   - Inputs: Temporary checkpoint files, plans, locks, and symbolic links.
//   - Outputs: Load/save progression and refusal verdicts.
//   - Side effects: Temporary filesystem state removed after each test.
// - Split-When:
//   - Parallel checkpoint persistence needs an independent fixture suite.
// - Merge-When:
//   - Durable write checkpoints are removed.
// - Summary:
//   - Proves missing, idempotent, sequential, and unsafe-file behavior.
// - Description:
//   - Mirrors the write-checkpoint-files adapter.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - A missing file represents operation index zero.
//
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadWriteCheckpointFile,
  saveWriteCheckpointFile,
} from
  "../../../../src/platforms/write-checkpoint-files/adapter-outbound/file.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";
import type { BlooketWriteCheckpoint } from
  "../../../../src/projects/blooket-write-plans/domain/checkpoint.ts";
import type { BlooketWritePlan } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const plan: BlooketWritePlan = {
  schemaVersion: 1,
  planId: "plan:checkpoint-test",
  desiredStateSha256: "fixture",
  operations: [
    {
      operationId: "plan:checkpoint-test:set",
      kind: "set",
      title: "Fractions",
      description: "Review.",
      visibility: "private",
      coverMediaId: null,
    },
    {
      operationId: "plan:checkpoint-test:q:0",
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

function checkpoint(index: number): BlooketWriteCheckpoint {
  return {
    schemaVersion: 1,
    planId: plan.planId,
    nextOperationIndex: index,
  };
}

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-checkpoint-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("missing checkpoint files load initial progress", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await loadWriteCheckpointFile(
      join(directory, "write.json"),
      plan,
    );

    assert.deepEqual(result, {
      ok: true,
      checkpoint: checkpoint(0),
      source: "initial",
    });
  });
});

test("first save may persist initial or one-step progress", async () => {
  await withTemporaryDirectory(async (directory) => {
    const initialPath = join(directory, "initial.json");
    const advancedPath = join(directory, "advanced.json");

    assert.deepEqual(
      await saveWriteCheckpointFile(initialPath, plan, checkpoint(0)),
      { ok: true },
    );
    assert.deepEqual(
      await saveWriteCheckpointFile(advancedPath, plan, checkpoint(1)),
      { ok: true },
    );

    assert.equal((await lstat(initialPath)).isFile(), true);
    assert.deepEqual(
      await loadWriteCheckpointFile(advancedPath, plan),
      {
        ok: true,
        checkpoint: checkpoint(1),
        source: "file",
      },
    );
  });
});

test("sequential saves retain the previous checkpoint backup", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "write.json");
    assert.deepEqual(
      await saveWriteCheckpointFile(path, plan, checkpoint(1)),
      { ok: true },
    );
    assert.deepEqual(
      await saveWriteCheckpointFile(path, plan, checkpoint(2)),
      { ok: true },
    );

    assert.deepEqual(
      JSON.parse(await readFile(path + ".bak", "utf8")),
      checkpoint(1),
    );
    assert.deepEqual(
      await loadWriteCheckpointFile(path, plan),
      {
        ok: true,
        checkpoint: checkpoint(2),
        source: "file",
      },
    );
  });
});

test("idempotent saves do not create replacement backups", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "write.json");
    assert.deepEqual(
      await saveWriteCheckpointFile(path, plan, checkpoint(1)),
      { ok: true },
    );
    assert.deepEqual(
      await saveWriteCheckpointFile(path, plan, checkpoint(1)),
      { ok: true },
    );

    await assert.rejects(readFile(path + ".bak", "utf8"));
  });
});

test("skips and regressions fail before checkpoint replacement", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "write.json");

    const skipped = await saveWriteCheckpointFile(
      path,
      plan,
      checkpoint(2),
    );
    assert.equal(skipped.ok, false);
    if (!skipped.ok && skipped.kind === "invalid") {
      assert.equal(skipped.issues[0]?.code, "checkpoint-skip");
    }
    await assert.rejects(readFile(path, "utf8"));

    assert.deepEqual(
      await saveWriteCheckpointFile(path, plan, checkpoint(1)),
      { ok: true },
    );
    const regressed = await saveWriteCheckpointFile(
      path,
      plan,
      checkpoint(0),
    );
    assert.equal(regressed.ok, false);
    if (!regressed.ok && regressed.kind === "invalid") {
      assert.equal(regressed.issues[0]?.code, "checkpoint-regression");
    }
    assert.deepEqual(
      JSON.parse(await readFile(path, "utf8")),
      checkpoint(1),
    );
  });
});

test("cross-plan checkpoint files fail closed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "write.json");
    await writeFile(path, JSON.stringify({
      ...checkpoint(1),
      planId: "plan:other",
    }));

    const loaded = await loadWriteCheckpointFile(path, plan);
    assert.equal(loaded.ok, false);
    if (!loaded.ok && loaded.kind === "invalid") {
      assert.equal(
        loaded.issues.some(
          (issue) => issue.code === "write-plan-mismatch",
        ),
        true,
      );
    }

    const saved = await saveWriteCheckpointFile(
      path,
      plan,
      checkpoint(1),
    );
    assert.equal(saved.ok, false);
  });
});

test("invalid and symbolic checkpoint files fail closed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const invalid = join(directory, "invalid.json");
    await writeFile(invalid, "{");
    const invalidResult = await loadWriteCheckpointFile(invalid, plan);
    assert.equal(invalidResult.ok, false);
    if (!invalidResult.ok && invalidResult.kind === "invalid") {
      assert.equal(invalidResult.issues[0]?.code, "invalid-json");
    }

    const outside = join(directory, "outside.json");
    const symbolic = join(directory, "write.json");
    await writeFile(outside, JSON.stringify(checkpoint(0)));
    await symlink(outside, symbolic);

    assert.deepEqual(await loadWriteCheckpointFile(symbolic, plan), {
      ok: false,
      kind: "io",
      code: "checkpoint-file-unsafe",
    });
    assert.deepEqual(
      await saveWriteCheckpointFile(symbolic, plan, checkpoint(1)),
      {
        ok: false,
        kind: "io",
        code: "checkpoint-file-unsafe",
      },
    );
  });
});

test("unreadable regular checkpoints fail as write failures", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "write.json");
    await writeFile(path, JSON.stringify(checkpoint(0)));
    await chmod(path, 0o000);
    try {
      assert.deepEqual(
        await saveWriteCheckpointFile(path, plan, checkpoint(1)),
        {
          ok: false,
          kind: "io",
          code: "checkpoint-write-failed",
        },
      );
    } finally {
      await chmod(path, 0o600);
    }
  });
});

test("checkpoint saves fail while another writer holds the lock", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "write.json");
    const acquired = await tryAcquireFileLock(path + ".lock");
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }

    assert.deepEqual(
      await saveWriteCheckpointFile(path, plan, checkpoint(1)),
      {
        ok: false,
        kind: "io",
        code: "checkpoint-file-locked",
      },
    );

    await acquired.lock.release();
    assert.deepEqual(
      await saveWriteCheckpointFile(path, plan, checkpoint(1)),
      { ok: true },
    );
  });
});
