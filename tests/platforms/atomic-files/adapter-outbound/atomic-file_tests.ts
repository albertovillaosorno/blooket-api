// Copyright:
//   - Copyright © 2026 Alberto Villa Osorno.
// SPDX-License-Identifier:
//   - LicenseRef-Proprietary
// Confidential:
//   - true
// License-File:
//   - LICENSE
//
// Boundary-Contract:
// - Owns:
//   - Filesystem tests for durable atomic local replacement.
// - Must-Not:
//   - Test project serialization or choose production user paths.
// - Allows:
//   - Inputs: Temporary local files and deliberate symbolic links.
//   - Outputs: Deterministic Node test verdicts.
//   - Side effects: Temporary filesystem writes removed after each test.
// - Split-When:
//   - Host-specific replacement implementations need separate fixtures.
// - Merge-When:
//   - Atomic file replacement no longer has a platform adapter.
// - Summary:
//   - Verifies replacement, backup, permissions, and safe cleanup.
// - Description:
//   - Mirrors src/platforms/atomic-files/adapter-outbound/atomic-file.ts.
// - Usage:
//   - Run on Linux now and macOS before release promotion.
// - Defaults:
//   - Test state lives only in the operating-system temporary directory.
//
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  linkDurableFileIfAbsent,
  removeDurableFile,
  writeAtomicFile,
  writeDurableFileIfAbsent,
  syncDirectory,
} from "../../../../src/platforms/atomic-files/adapter-outbound/atomic-file.ts";

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-api-atomic-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("durable create publishes once without overwriting", async () => {
  await withTemporaryDirectory(async (directory) => {
    const target = join(directory, "original.png");

    assert.equal(
      await writeDurableFileIfAbsent(target, Uint8Array.from([1, 2, 3])),
      "created",
    );
    assert.equal(
      await writeDurableFileIfAbsent(target, Uint8Array.from([9, 9, 9])),
      "exists",
    );

    assert.deepEqual(await readFile(target), Buffer.from([1, 2, 3]));
    assert.equal((await lstat(target)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(directory), ["original.png"]);
  });
});

test(
  "concurrent durable creates publish exactly one complete value",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = join(directory, "original.bin");
      const first = Uint8Array.from([1, 2, 3, 4]);
      const second = Uint8Array.from([5, 6, 7, 8]);

      const results = await Promise.all([
        writeDurableFileIfAbsent(target, first),
        writeDurableFileIfAbsent(target, second),
      ]);

      assert.deepEqual(results.sort(), ["created", "exists"]);
      const stored = await readFile(target);
      assert.equal(
        stored.equals(Buffer.from(first)) || stored.equals(Buffer.from(second)),
        true,
      );
      assert.deepEqual(await readdir(directory), ["original.bin"]);
    });
  },
);

test(
  "durable hard links publish the staged inode without clobbering",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const staged = join(directory, ".asset.staged");
      const target = join(directory, "asset.bin");
      await writeDurableFileIfAbsent(staged, "first");

      assert.equal(
        await linkDurableFileIfAbsent(staged, target),
        "created",
      );
      const stagedMetadata = await lstat(staged);
      const targetMetadata = await lstat(target);
      assert.equal(stagedMetadata.dev, targetMetadata.dev);
      assert.equal(stagedMetadata.ino, targetMetadata.ino);

      assert.equal(
        await linkDurableFileIfAbsent(staged, target),
        "exists",
      );
      assert.equal(await readFile(target, "utf8"), "first");
    });
  },
);

test("durable hard links refuse symbolic sources and targets", async () => {
  await withTemporaryDirectory(async (directory) => {
    const real = join(directory, "real.bin");
    const sourceLink = join(directory, "source-link.bin");
    const targetLink = join(directory, "target-link.bin");
    await writeFile(real, "value");
    await symlink(real, sourceLink);
    await symlink(real, targetLink);

    await assert.rejects(
      linkDurableFileIfAbsent(sourceLink, join(directory, "new.bin")),
      /non-regular file target/,
    );
    await assert.rejects(
      linkDurableFileIfAbsent(real, targetLink),
      /non-regular file target/,
    );
  });
});

test("durable create refuses symbolic and non-file targets", async () => {
  await withTemporaryDirectory(async (directory) => {
    const realTarget = join(directory, "real.bin");
    const symbolicTarget = join(directory, "symbolic.bin");
    await writeFile(realTarget, "safe", { mode: 0o600 });
    await symlink(realTarget, symbolicTarget);

    await assert.rejects(
      writeDurableFileIfAbsent(symbolicTarget, "unsafe"),
    );
    assert.equal(await readFile(realTarget, "utf8"), "safe");

    await assert.rejects(
      writeDurableFileIfAbsent(directory, "unsafe"),
    );
  });
});

test("durable directory sync rejects FIFO instead of blocking",
  { skip: process.platform === "win32" }, async () => {
    await withTemporaryDirectory(async directory => {
      await syncDirectory(directory);
      const fifo = join(directory, "replacement");
      await promisify(execFile)("mkfifo", [fifo]);
      const moduleUrl = new URL(
        "../../../../src/platforms/atomic-files/adapter-outbound/" +
        "atomic-file.ts", import.meta.url,
      ).href;
      const script = `import { syncDirectory } from ` +
        `${JSON.stringify(moduleUrl)};` +
        `await syncDirectory(process.argv[1]).then(` +
        `() => { throw Error("accepted-FIFO-directory"); },` +
        `() => undefined);`;
      await promisify(execFile)(process.execPath,
        ["--input-type=module", "-e", script, fifo],
        { timeout: 5_000, killSignal: "SIGKILL" });
    });
  });

test("atomic writes create an owner-only file", async () => {
  await withTemporaryDirectory(async (directory) => {
    const target = join(directory, "project.json");
    await writeAtomicFile(target, "new");

    assert.equal(await readFile(target, "utf8"), "new");
    const metadata = await lstat(target);
    assert.equal(metadata.mode & 0o777, 0o600);
  });
});

test("atomic replacement preserves the previous value in backup", async () => {
  await withTemporaryDirectory(async (directory) => {
    const target = join(directory, "project.json");
    const backup = join(directory, "project.json.bak");
    await writeFile(target, "old", { mode: 0o600 });

    await writeAtomicFile(target, "new", { backupPath: backup });

    assert.equal(await readFile(target, "utf8"), "new");
    assert.equal(await readFile(backup, "utf8"), "old");
  });
});

test("atomic replacement leaves no generated temporary files", async () => {
  await withTemporaryDirectory(async (directory) => {
    const target = join(directory, "settings.json");
    await writeAtomicFile(target, "value");

    const names = await readdir(directory);
    assert.deepEqual(names, ["settings.json"]);
  });
});

test(
  "durable removal deletes regular files and tolerates missing paths",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = join(directory, "project.json");
      await writeFile(target, "value", { mode: 0o600 });

      await removeDurableFile(target);
      await removeDurableFile(target);

      await assert.rejects(readFile(target, "utf8"));
    });
  },
);

test("durable removal refuses symbolic targets", async () => {
  await withTemporaryDirectory(async (directory) => {
    const realTarget = join(directory, "real.json");
    const symbolicTarget = join(directory, "project.json");
    await writeFile(realTarget, "safe", { mode: 0o600 });
    await symlink(realTarget, symbolicTarget);

    await assert.rejects(removeDurableFile(symbolicTarget));
    assert.equal(await readFile(realTarget, "utf8"), "safe");
    assert.equal((await lstat(symbolicTarget)).isSymbolicLink(), true);
  });
});

test("atomic replacement refuses symbolic targets", async () => {
  await withTemporaryDirectory(async (directory) => {
    const realTarget = join(directory, "real.json");
    const symbolicTarget = join(directory, "project.json");
    await writeFile(realTarget, "safe", { mode: 0o600 });
    await symlink(realTarget, symbolicTarget);

    await assert.rejects(writeAtomicFile(symbolicTarget, "unsafe"));
    assert.equal(await readFile(realTarget, "utf8"), "safe");
    assert.equal((await lstat(symbolicTarget)).isSymbolicLink(), true);
  });
});

test("streamed previous-value backup retains exact large binary bytes",
  async () => {
  await withTemporaryDirectory(async directory => {
    const target = join(directory, "media.bin");
    const backup = join(directory, "media.bin.bak");
    const old = Buffer.alloc(2_000_123, 0x5a);
    old[11] = 0;
    old[old.length - 1] = 0xf7;
    await writeFile(target, old, { mode: 0o600 });
    await writeAtomicFile(target, Buffer.from([5, 6, 7]), {
      backupPath: backup,
    });
    assert.deepEqual(await readFile(target), Buffer.from([5, 6, 7]));
    assert.deepEqual(await readFile(backup), old);
    assert.equal((await lstat(backup)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(directory)).sort(), [
      "media.bin", "media.bin.bak",
    ]);
  });
  },
);

// Backups must reject FIFO targets before waiting on their open operation.
test("atomic backup refuses FIFO source without blocking the process",
  async () => { await withTemporaryDirectory(async directory => {
    const target = join(directory, "project.json");
    const backup = join(directory, "project.json.bak");
    const run = promisify(execFile);
    await run("mkfifo", [target]);
    const moduleUrl = new URL(
      "../../../../src/platforms/atomic-files/adapter-outbound/" +
      "atomic-file.ts",
      import.meta.url,
    ).href;
    const script =
      `import { writeAtomicFile } from ${JSON.stringify(moduleUrl)};` +
      "try { await writeAtomicFile(process.argv[1], 'replacement'," +
      "{ backupPath: process.argv[2] });" +
      "process.stdout.write('unexpected-success'); }" +
      "catch (error) { process.stdout.write(error.message); }";
    const { stdout } = await run(process.execPath,
      ["--input-type=module", "--eval", script, target, backup],
      { timeout: 8_000 });
    assert.equal(stdout, "Refusing unsafe backup source.");
    assert.equal((await lstat(target)).isFIFO(), true);
    assert.deepEqual(await readdir(directory), ["project.json"]);
  }); },
);

test("symbolic backup paths refuse replacement without overwriting data",
  async () => {
  await withTemporaryDirectory(async directory => {
    const target = join(directory, "project.json");
    const outside = join(directory, "outside.json");
    const backup = join(directory, "project.json.bak");
    await writeFile(target, "original", { mode: 0o600 });
    await writeFile(outside, "unrelated");
    await symlink(outside, backup);
    await assert.rejects(writeAtomicFile(target, "replacement", {
      backupPath: backup,
    }), /Refusing symbolic file target/u);
    assert.equal(await readFile(target, "utf8"), "original");
    assert.equal(await readFile(outside, "utf8"), "unrelated");
  });
  },
);
