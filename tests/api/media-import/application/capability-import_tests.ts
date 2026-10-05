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
//   - Tests for capability-bound durable image import.
// - Must-Not:
//   - Probe Blooket or write outside temporary vault roots.
// - Allows:
//   - Inputs: Tiny image bytes and synthetic capability snapshots.
//   - Outputs: Exact policy failures or durable media records.
//   - Side effects: Temporary native image work and vault filesystem writes.
// - Split-When:
//   - Multiple media targets need different bound import fixtures.
// - Merge-When:
//   - Intake no longer resolves capability policy before durable import.
// - Summary:
//   - Verifies external callers cannot bypass unknown target limits.
// - Description:
//   - Covers complete v2 policy success and fail-closed unknown evidence.
// - Usage:
//   - Run after media capability, policy, or import changes.
// - Defaults:
//   - Numeric fixtures are synthetic and make no Blooket capability claim.
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

import { importImageForCapabilities } from
  "../../../../src/api/media-import/application/capability-import.ts";

const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPo"
    + "AAAD6AG1e1JrAAAADElEQVQImWNg+A+BAA/5A/2NJFz3AAAAAElFTkSuQmCC",
  "base64",
);

const capabilities = {
  schemaVersion: 2,
  verifiedOn: "2026-10-05",
  evidence: [{
    kind: "browser-observation",
    reference: "Synthetic authenticated editor fixture",
  }],
  questionTypes: {
    multipleChoice: {
      availability: "supported",
      minAnswers: 2,
      maxAnswers: 4,
      requiresQuestionText: true,
      allowsMultipleCorrect: true,
    },
    typingAnswer: {
      availability: "supported",
      matchModes: ["exact", "contains"],
    },
  },
  features: {
    questionImages: "supported",
    answerImages: "account-dependent",
    audio: "account-dependent",
  },
  setMetadata: {
    titleRequired: true,
    descriptionRequired: true,
    coverImageOptional: true,
    visibility: ["public", "private"],
  },
  upload: {
    maxBytes: 16_384,
    canvasWidth: 4,
    canvasHeight: 4,
    maxPixels: 16,
  },
} as const;

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-bound-import-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("verified capabilities drive durable rendition constraints", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await importImageForCapabilities({
      vaultDirectory: directory,
      id: "green-card",
      description: "A small green card.",
      bytes: PNG_2X1,
      capabilities,
      localSafety: {
        maxSourceBytes: PNG_2X1.byteLength,
        maxInputPixels: 16,
      },
    });

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
    assert.equal(
      (await readFile(join(directory, "media", "green-card.png"))).length > 0,
      true,
    );
  });
});

test("unknown upload evidence fails before vault mutation", async () => {
  await withTemporaryDirectory(async (parent) => {
    const directory = join(parent, "vault");
    const result = await importImageForCapabilities({
      vaultDirectory: directory,
      id: "green-card",
      description: "A small green card.",
      bytes: PNG_2X1,
      capabilities: {
        ...capabilities,
        upload: {
          maxBytes: null,
          canvasWidth: null,
          canvasHeight: null,
          maxPixels: null,
        },
      },
      localSafety: {
        maxSourceBytes: PNG_2X1.byteLength,
        maxInputPixels: 16,
      },
    });

    assert.deepEqual(result, {
      ok: false,
      stage: "policy",
      code: "unverified-image-upload-limits",
    });
    assert.equal(await pathExists(directory), false);
  });
});

test("invalid capability snapshots fail before image work", async () => {
  await withTemporaryDirectory(async (parent) => {
    const directory = join(parent, "vault");
    const result = await importImageForCapabilities({
      vaultDirectory: directory,
      id: "green-card",
      description: "A small green card.",
      bytes: Uint8Array.from([1, 2, 3]),
      capabilities: {
        ...capabilities,
        schemaVersion: 99,
      },
      localSafety: {
        maxSourceBytes: 3,
        maxInputPixels: 16,
      },
    });

    assert.deepEqual(result, {
      ok: false,
      stage: "policy",
      code: "invalid-capability-snapshot",
    });
    assert.equal(await pathExists(directory), false);
  });
});

test("local safety remains independent of upload limits", async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await importImageForCapabilities({
      vaultDirectory: directory,
      id: "green-card",
      description: "A small green card.",
      bytes: PNG_2X1,
      capabilities,
      localSafety: {
        maxSourceBytes: capabilities.upload.maxBytes + 1,
        maxInputPixels: capabilities.upload.maxPixels + 1,
      },
    });

    assert.equal(result.ok, true);
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
