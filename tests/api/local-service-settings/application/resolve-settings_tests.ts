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
//   - Integration tests for persisted local-service port resolution.
// - Must-Not:
//   - Start the product HTTP API or use production settings paths.
// - Allows:
//   - Inputs: Temporary settings files and short-lived loopback listeners.
//   - Outputs: Deterministic fixed and automatic collision verdicts.
//   - Side effects: Temporary files and TCP listeners removed after each test.
// - Split-When:
//   - Full server lifecycle tests require independent fixtures.
// - Merge-When:
//   - Port resolution becomes part of one server lifecycle application.
// - Summary:
//   - Verifies explicit fixed failures and persisted automatic alternatives.
// - Description:
//   - Uses real settings persistence and host TCP collision behavior.
// - Usage:
//   - Run on Linux now and macOS before release promotion.
// - Defaults:
//   - Tests bind only to IPv4 loopback.
//
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolvePersistedLocalServiceSettings } from
  "../../../../src/api/local-service-settings/application/resolve-settings.ts";
import { saveSettingsFile } from
  "../../../../src/platforms/settings-files/adapter-outbound/file.ts";
import { defaultLocalServiceSettings } from
  "../../../../src/settings/local-service/domain/local-service-settings.ts";

const LOOPBACK = "127.0.0.1";

test("automatic collisions persist the selected replacement port", async () => {
  await withTemporaryDirectory(async (directory) => {
    const server = await listenOnAutomaticPort();
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("test server did not expose a TCP address");
      }
      const path = join(directory, "settings.json");
      const settings = {
        ...defaultLocalServiceSettings(),
        port: address.port,
        portMode: "automatic" as const,
      };
      assert.deepEqual(await saveSettingsFile(path, settings), { ok: true });

      const result = await resolvePersistedLocalServiceSettings(path);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.notEqual(result.settings.port, address.port);
        const persisted = JSON.parse(await readFile(path, "utf8")) as {
          port: number;
        };
        assert.equal(persisted.port, result.settings.port);
      }
    } finally {
      await close(server);
    }
  });
});

test("fixed collisions fail without changing persisted settings", async () => {
  await withTemporaryDirectory(async (directory) => {
    const server = await listenOnAutomaticPort();
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("test server did not expose a TCP address");
      }
      const path = join(directory, "settings.json");
      const settings = {
        ...defaultLocalServiceSettings(),
        port: address.port,
        portMode: "fixed" as const,
      };
      assert.deepEqual(await saveSettingsFile(path, settings), { ok: true });

      const before = await readFile(path, "utf8");
      const result = await resolvePersistedLocalServiceSettings(path);
      const after = await readFile(path, "utf8");

      assert.deepEqual(result, {
        ok: false,
        code: "configured-port-in-use",
      });
      assert.equal(after, before);
    } finally {
      await close(server);
    }
  });
});

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-port-settings-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function listenOnAutomaticPort(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: LOOPBACK, port: 0, exclusive: true }, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
