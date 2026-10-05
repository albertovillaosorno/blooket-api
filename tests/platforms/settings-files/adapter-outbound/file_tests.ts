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

import {
  loadSettingsFile,
  saveSettingsFile,
} from "../../../../src/platforms/settings-files/adapter-outbound/file.ts";
import { defaultLocalServiceSettings } from
  "../../../../src/settings/local-service/domain/local-service-settings.ts";

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
