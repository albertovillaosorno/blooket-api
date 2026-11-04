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
//   - Filesystem tests for versioned local settings persistence.
// - Must-Not:
//   - Use production settings directories or bind network sockets.
// - Allows:
//   - Inputs: Temporary settings files, legacy JSON, and symbolic links.
//   - Outputs: Deterministic load, migration, backup, and refusal verdicts.
//   - Side effects: Temporary filesystem writes removed after each test.
// - Split-When:
//   - Host-specific settings locations need independent fixture suites.
// - Merge-When:
//   - Settings no longer use local JSON files.
// - Summary:
//   - Verifies defaults, migration, atomic replacement, and symlink refusal.
// - Description:
//   - Mirrors src/platforms/settings-files/adapter-outbound/file.ts.
// - Usage:
//   - Run on Linux now and macOS before release promotion.
// - Defaults:
//   - Tests use only the operating-system temporary directory.
//
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
import { promisify } from "node:util";

import {
  loadSettingsFile,
  saveSettingsFile,
} from "../../../../src/platforms/settings-files/adapter-outbound/file.ts";
import { defaultLocalServiceSettings } from
  "../../../../src/settings/local-service/domain/local-service-settings.ts";
import { tryAcquireFileLock } from
  "../../../../src/platforms/file-locks/adapter-outbound/file-lock.ts";

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-settings-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("missing settings files return current defaults", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await loadSettingsFile(join(directory, "settings.json"));

    assert.deepEqual(result, {
      ok: true,
      settings: defaultLocalServiceSettings(),
      source: "default",
    });
  });
});

test("version-one files migrate to version two on load", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "settings.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      bindAddress: "127.0.0.1",
      port: 2607,
      portMode: "fixed",
      launchAtLogin: false,
      startMinimized: false,
      startServiceOnLaunch: true,
    }));

    const result = await loadSettingsFile(path);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.settings.schemaVersion, 2);
      assert.equal(result.settings.theme, "system");
    }
  });
});

test(
  "replacement writes canonical v2 and preserves the previous value",
  async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "settings.json");
    const first = defaultLocalServiceSettings();
    const second = { ...first, port: 43127, theme: "dark" as const };

    assert.deepEqual(await saveSettingsFile(path, first), { ok: true });
    assert.deepEqual(await saveSettingsFile(path, second), { ok: true });

    const loaded = await loadSettingsFile(path);
    const backup = JSON.parse(await readFile(`${path}.bak`, "utf8")) as {
      schemaVersion: number;
      port: number;
      theme: string;
    };
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.deepEqual(loaded.settings, second);
    }
    assert.deepEqual(backup, {
      ...first,
      schemaVersion: 2,
    });
    });
  },
);

test(
  "settings saves fail closed while another writer holds the lock",
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "settings.json");
      const acquired = await tryAcquireFileLock(path + ".lock");
      assert.equal(acquired.ok, true);
      if (!acquired.ok) {
        return;
      }

      const saved = await saveSettingsFile(
        path,
        defaultLocalServiceSettings(),
      );
      assert.deepEqual(saved, {
        ok: false,
        kind: "io",
        code: "settings-file-locked",
      });

      await acquired.lock.release();
      assert.deepEqual(
        await saveSettingsFile(path, defaultLocalServiceSettings()),
        { ok: true },
      );
    });
  },
);

test("invalid JSON and symbolic settings files fail closed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const invalid = join(directory, "invalid.json");
    await writeFile(invalid, "{");
    const invalidResult = await loadSettingsFile(invalid);
    assert.equal(invalidResult.ok, false);
    if (!invalidResult.ok) {
      assert.equal(invalidResult.kind, "invalid");
    }

    const outside = join(directory, "outside.json");
    const symbolic = join(directory, "settings.json");
    await writeFile(outside, "safe");
    await symlink(outside, symbolic);
    const saved = await saveSettingsFile(
      symbolic,
      defaultLocalServiceSettings(),
    );
    assert.deepEqual(saved, {
      ok: false,
      kind: "io",
      code: "settings-file-unsafe",
    });
    assert.equal(await readFile(outside, "utf8"), "safe");
  });
});


// Both read and write must refuse an existing FIFO without waiting
// for a writer.
test("settings FIFO files refuse load and save without blocking",
  async () => {
    await withTemporaryDirectory(async directory => {
      const run = promisify(execFile);
      const path = join(directory, "settings.json");
      await run("mkfifo", [path]);
      const fileUrl = new URL(
        "../../../../src/platforms/settings-files/adapter-outbound/file.ts",
        import.meta.url,
      ).href;
      const settingsUrl = new URL(
        "../../../../src/settings/local-service/domain/" +
        "local-service-settings.ts",
        import.meta.url,
      ).href;
      const script =
        `import { loadSettingsFile, saveSettingsFile } from ` +
        `${JSON.stringify(fileUrl)};` +
        `import { defaultLocalServiceSettings } from ` +
        `${JSON.stringify(settingsUrl)};` +
        "const path = process.argv[1];" +
        "const loaded = await loadSettingsFile(path);" +
        "const saved = await saveSettingsFile(path, " +
        "defaultLocalServiceSettings());" +
        "process.stdout.write(JSON.stringify([loaded, saved]));";
      const { stdout } = await run(process.execPath,
        ["--input-type=module", "--eval", script, path],
        { timeout: 8_000 });
      assert.deepEqual(JSON.parse(stdout), [
        { ok: false, kind: "io", code: "settings-file-unsafe" },
        { ok: false, kind: "io", code: "settings-file-unsafe" },
      ]);
    });
  },
);

test("settings refuse oversized files and dangling symlink aliases",
  async () => {
  await withTemporaryDirectory(async directory => {
    const path = join(directory, "settings.json");
    const json = JSON.stringify(defaultLocalServiceSettings());
    await writeFile(path, json.padEnd(65_536, " "));
    assert.equal((await loadSettingsFile(path)).ok, true);
    await writeFile(path, json.padEnd(65_537, " "));
    assert.deepEqual(await loadSettingsFile(path), {
      ok: false, kind: "io", code: "settings-file-unsafe",
    });
    assert.deepEqual(await saveSettingsFile(
      path, defaultLocalServiceSettings(),
    ), { ok: false, kind: "io", code: "settings-file-unsafe" });
    assert.equal((await readFile(path, "utf8")).length, 65_537);
    await rm(path);
    await symlink(join(directory, "missing.json"), path);
    assert.deepEqual(await loadSettingsFile(path), {
      ok: false, kind: "io", code: "settings-file-unsafe",
    });
    assert.deepEqual(await saveSettingsFile(
      path, defaultLocalServiceSettings(),
    ), { ok: false, kind: "io", code: "settings-file-unsafe" });
  });
  },
);
