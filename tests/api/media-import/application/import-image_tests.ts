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
//   - Application tests for complete prepared-image vault import.
// - Must-Not:
//   - Contact Blooket or write outside temporary vault roots.
// - Allows:
//   - Inputs: Tiny image fixtures, metadata, and explicit resource limits.
//   - Outputs: Durable records and stage-specific failure verdicts.
//   - Side effects: Temporary native image work and vault filesystem writes.
// - Split-When:
//   - Batch intake requires independently resumable application fixtures.
// - Merge-When:
//   - Durable image import is no longer a shared application operation.
// - Summary:
//   - Verifies validation, preparation, persistence, and conflict composition.
// - Description:
//   - Ensures failures stop before later stages can mutate vault state.
// - Usage:
//   - Run after intake, media-preparation, or vault-persistence changes.
// - Defaults:
//   - Fixtures use tiny explicit limits rather than product assumptions.
//
import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { importImage } from
  "../../../../src/api/media-import/application/import-image.ts";
import { loadMediaVault } from
  "../../../../src/platforms/media-vault-files/adapter-outbound/directory.ts";

const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPo"
    + "AAAD6AG1e1JrAAAADElEQVQImWNg+A+BAA/5A/2NJFz3AAAAAElFTkSuQmCC",
  "base64",
);

const GIF_2_FRAME_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwALAAAAAABAAEAAAIBTAA7",
  "base64",
);

const ANIMATED_WEBP_2_FRAME_1X1 = Buffer.from(
  "UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AQBBTk1G"
    + "MAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+"
    + "/PQAAEFOTUYwAAAAAAAAAAAAAAAAAAAAeAAAAFZQOCAYAAAANAEAnQEqAQABAAAA"
    + "JiWkAANwAP79NmgA",
  "base64",
);

const LIMITS = {
  maxInputPixels: 16,
  maxOutputPixels: 64,
  maxOutputBytes: 16_384,
} as const;

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-media-import-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("image import durably publishes one vault record", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await importImage({
      vaultDirectory: directory,
      id: "green-card",
      description: "A small green card.",
      bytes: PNG_2X1,
      maxSourceBytes: PNG_2X1.byteLength,
      canvas: { width: 4, height: 4 },
      renditionLimits: LIMITS,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result, {
      ok: true,
      record: {
        id: "green-card",
        path: "media/green-card.png",
        description: "A small green card.",
        english: false,
      },
      originalPath: "originals/green-card.png",
    });

    const loaded = await loadMediaVault(directory);
    assert.deepEqual(loaded, {
      ok: true,
      records: [result.record],
    });
    assert.deepEqual(
      await readFile(join(directory, "originals", "green-card.png")),
      PNG_2X1,
    );
    assert.equal(
      (await readFile(join(directory, "media", "green-card.png"))).length > 0,
      true,
    );
  });
});

test("animated GIF import preserves GIF vault paths", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await importImage({
      vaultDirectory: directory,
      id: "timer",
      description: "A two-frame timer animation.",
      english: true,
      bytes: GIF_2_FRAME_1X1,
      maxSourceBytes: GIF_2_FRAME_1X1.byteLength,
      canvas: { width: 2, height: 2 },
      renditionLimits: LIMITS,
    });
    assert.deepEqual(result, {
      ok: true,
      record: {
        id: "timer",
        path: "media/timer.gif",
        description: "A two-frame timer animation.",
        english: true,
      },
      originalPath: "originals/timer.gif",
    });
    assert.equal(
      (await readFile(join(directory, "media", "timer.gif"))).length > 0,
      true,
    );
  });
});

test("invalid media metadata fails before image preparation", async () => {
  await withTemporaryDirectory(async (parent) => {
    const directory = join(parent, "vault");
    const result = await importImage({
      vaultDirectory: directory,
      id: "../secret",
      description: "Invalid ID.",
      bytes: Uint8Array.from([1, 2, 3]),
      maxSourceBytes: 0,
      canvas: { width: 0, height: 0 },
      renditionLimits: {
        maxInputPixels: 0,
        maxOutputPixels: 0,
        maxOutputBytes: 0,
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "metadata");
    }
    assert.equal(await pathExists(directory), false);
  });
});

test("source admission failures leave the vault untouched", async () => {
  await withTemporaryDirectory(async (parent) => {
    const directory = join(parent, "vault");
    const result = await importImage({
      vaultDirectory: directory,
      id: "green-card",
      description: "A small green card.",
      bytes: PNG_2X1,
      maxSourceBytes: PNG_2X1.byteLength - 1,
      canvas: { width: 4, height: 4 },
      renditionLimits: LIMITS,
    });
    assert.deepEqual(result, {
      ok: false,
      stage: "source",
      code: "source-image-too-large",
    });
    assert.equal(await pathExists(directory), false);
  });
});

test("animated WebP refusal happens before vault mutation", async () => {
  await withTemporaryDirectory(async (parent) => {
    const directory = join(parent, "vault");
    const result = await importImage({
      vaultDirectory: directory,
      id: "animated",
      description: "A two-frame animation.",
      bytes: ANIMATED_WEBP_2_FRAME_1X1,
      maxSourceBytes: ANIMATED_WEBP_2_FRAME_1X1.byteLength,
      canvas: { width: 2, height: 2 },
      renditionLimits: LIMITS,
    });
    assert.deepEqual(result, {
      ok: false,
      stage: "rendition",
      code: "animated-rendition-unsupported",
    });
    assert.equal(await pathExists(directory), false);
  });
});

test("duplicate IDs surface as vault conflicts", async () => {
  await withTemporaryDirectory(async (directory) => {
    const request = {
      vaultDirectory: directory,
      id: "green-card",
      description: "A small green card.",
      bytes: PNG_2X1,
      maxSourceBytes: PNG_2X1.byteLength,
      canvas: { width: 4, height: 4 },
      renditionLimits: LIMITS,
    } as const;
    assert.equal((await importImage(request)).ok, true);
    const original = await readFile(
      join(directory, "originals", "green-card.png"),
    );

    assert.deepEqual(await importImage({
      ...request,
      description: "A replacement description.",
    }), {
      ok: false,
      stage: "vault",
      kind: "conflict",
      code: "media-id-conflict",
    });
    assert.deepEqual(
      await readFile(join(directory, "originals", "green-card.png")),
      original,
    );
  });
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    return error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
      ? false
      : Promise.reject(error);
  }
}
