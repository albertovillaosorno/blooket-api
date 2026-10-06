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
//   - Portable settings-save regressions with synthetic secrets.
// - Must-Not:
//   - Return stored secrets or mutate Blooket during diagnostics.
// - Allows:
//   - Inputs: Explicit bounded capability requests.
//   - Outputs: Validated values or stable failure codes.
//   - Side effects: Disposable files and in-memory secret-store doubles.
// - Split-When:
//   - Another capability requires independent lifecycle or authority.
// - Merge-When:
//   - The capability no longer needs an independent boundary.
// - Summary:
//   - Portable settings-save regressions with synthetic secrets.
// - Description:
//   - Preserves the configured authority across local and remote callers.
// - Usage:
//   - Use the owning entrypoint after validating external input.
// - Defaults:
//   - Unsupported or invalid requests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfiguration } from
  "../../../../src/api/teacher-configuration/application/configuration.ts";
import { loadPreferences } from
  "../../../../src/platforms/user-storage/adapter-outbound/root.ts";
import type { HostSecretStore } from
  "../../../../src/security/host-secrets/domain/host-secret.ts";

function store(write: HostSecretStore["write"]): HostSecretStore {
  return {
    read: async () => ({ ok: true, kind: "missing" }),
    write,
    delete: async () => ({ ok: true }),
  };
}

test("all replacement byte limits are validated before any write", async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-bytes-"));
  try {
    const preferences = await loadPreferences(root);
    const writes: string[] = [];
    await assert.rejects(
      saveConfiguration(
        root,
        {
          preferences,
          password: "valid-fixture",
          tunnelToken: "é".repeat(1025),
        },
        store(async (key) => {
          writes.push(key);
          return { ok: true };
        }),
      ),
      /invalid-secret-replacement/u,
    );
    assert.deepEqual(writes, []);
    assert.deepEqual(await loadPreferences(root), preferences);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "partial secret failure preserves settings " +
    "and reports saved fields",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-partial-"));
  try {
    const preferences = await loadPreferences(root);
    const result = await saveConfiguration(
      root,
      {
        preferences: { ...preferences, email: "teacher@example.test" },
        password: "fixture-password",
        tunnelToken: "fixture-token",
      },
      store(async (key) =>
        key === "blooket.password"
          ? { ok: true }
          : { ok: false, code: "host-secret-store-unavailable" },
      ),
    );
    assert.deepEqual(result, {
      ok: false,
      code: "host-secret-store-unavailable",
      secretsSaved: ["password"],
      settingsSaved: false,
    });
    assert.deepEqual(await loadPreferences(root), preferences);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "settings failure after secret replacement " +
    "reports partial success",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-file-failure-"));
  try {
    const preferences = await loadPreferences(root);
    const result = await saveConfiguration(
      root,
      {
        preferences,
        password: "fixture-password",
        tunnelToken: "",
      },
      store(async () => {
        await rm(join(root, "settings.json"));
        await mkdir(join(root, "settings.json"));
        return { ok: true };
      }),
    );
    assert.deepEqual(result, {
      ok: false,
      code: "settings-save-failed",
      secretsSaved: ["password"],
      settingsSaved: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "concurrent configuration saves cannot " +
    "interleave secrets and settings",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-concurrent-"));
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    const preferences = await loadPreferences(root);
    const writes: string[] = [];
    const secrets = store(async (key) => {
      writes.push(key);
      entered();
      await paused;
      return { ok: true };
    });
    const first = saveConfiguration(
      root,
      {
        preferences: { ...preferences, email: "first@example.test" },
        password: "first-fixture",
        tunnelToken: "",
      },
      secrets,
    );
    await started;
    const second = await saveConfiguration(
      root,
      {
        preferences: { ...preferences, email: "second@example.test" },
        password: "second-fixture",
        tunnelToken: "",
      },
      secrets,
    );
    assert.equal(second.ok, false);
    assert.equal("code" in second && second.code, "configuration-busy");
    release();
    assert.equal((await first).ok, true);
    assert.deepEqual(writes, ["blooket.password"]);
    assert.equal((await loadPreferences(root)).email, "first@example.test");
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "changing media root preserves the existing " +
    "library and recovery copy",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-library-"));
  try {
    const preferences = await loadPreferences(root);
    await mkdir(preferences.mediaRoot);
    await writeFile(join(preferences.mediaRoot, "source-fixture"), "original");
    const next = { ...preferences, mediaRoot: join(root, "other-library") };
    const result = await saveConfiguration(
      root,
      {
        preferences: next,
        password: "",
        tunnelToken: "",
      },
      store(async () => {
        throw new Error("Unexpected secret write");
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(
      await readFile(join(preferences.mediaRoot, "source-fixture"), "utf8"),
      "original",
    );
    assert.deepEqual(await loadPreferences(root), next);
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "settings.previous.json"), "utf8")),
      preferences,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "owner configuration saves only a verifier " +
    "and reports its field",
  async () => {
  const root = await mkdtemp(join(tmpdir(), "settings-owner-"));
  try {
    const writes: [string, string][] = [];
    const preferences = await loadPreferences(root);
    const result = await saveConfiguration(
      root,
      {
        preferences,
        password: "",
        tunnelToken: "",
        ownerPassword: "owner-fixture",
      },
      store(async (name, value) => {
        writes.push([name, value]);
        return { ok: true };
      }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.secretsSaved, ["ownerPassword"]);
    assert.equal(writes[0]![0], "mcp.owner-verifier");
    assert.match(writes[0]![1], /^scrypt-v1\$/u);
    assert.equal(writes[0]![1].includes("owner-fixture"), false);
    assert.equal(JSON.stringify(result).includes("scrypt"), false);
    assert.equal(
      (await readFile(join(root, "settings.json"), "utf8")).includes(
        "owner-fixture",
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
