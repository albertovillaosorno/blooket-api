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
//   - End-to-end application tests for capability-bound static media editing.
// - Must-Not:
//   - Probe Blooket or use non-temporary vault directories.
// - Allows:
//   - Inputs: Tiny images, synthetic capabilities, and fixed editor states.
//   - Outputs: Durable edit records plus staged refusal verdicts.
//   - Side effects: Temporary native rendering and vault filesystem writes.
// - Split-When:
//   - Animated editor application flows gain separate semantics.
// - Merge-When:
//   - Edit application behavior is removed as a distinct operation.
// - Summary:
//   - Verifies trusted originals, verification reset, and stable-ID rules.
// - Description:
//   - Exercises import then edit through shared application/platform layers.
// - Usage:
//   - Run after media editor, policy, or vault edit changes.
// - Defaults:
//   - Numeric capabilities are synthetic fixtures, not Blooket claims.
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

import { editImage } from
  "../../../../src/api/media-edit/application/edit-image.ts";
import { importImageForCapabilities } from
  "../../../../src/api/media-import/application/capability-import.ts";
import { loadMediaVault } from
  "../../../../src/platforms/media-vault-files/adapter-outbound/directory.ts";
import { type MediaEditorState } from
  "../../../../src/media/editor-state/domain/editor-state.ts";
import { decodeSourceImage } from
  "../../../../src/media/image-decoding/adapter-outbound/sharp-image.ts";

const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPo"
    + "AAAD6AG1e1JrAAAADElEQVQImWNg+A+BAA/5A/2NJFz3AAAAAElFTkSuQmCC",
  "base64",
);
const GIF_2_FRAME_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwALAAAAAABAAEAAAIBTAA7",
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
    maxBytes: 65_536,
    canvasWidth: 4,
    canvasHeight: 4,
    maxPixels: 64,
  },
} as const;

const localSafety = {
  maxSourceBytes: 65_536,
  maxInputPixels: 128,
} as const;

function editorState(
  id: string,
  description: string,
): MediaEditorState {
  return {
    name: id,
    description,
    transform: {
      panX: 0,
      panY: 0,
      zoom: 1,
      contrast: 0,
      saturation: 1,
    },
    regions: [],
  };
}

async function withTemporaryDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "blooket-media-edit-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function importFixture(
  directory: string,
  id: string,
  bytes: Uint8Array = PNG_2X1,
): Promise<void> {
  const result = await importImageForCapabilities({
    vaultDirectory: directory,
    id,
    description: "An original description.",
    english: true,
    bytes,
    capabilities,
    localSafety,
  });
  assert.equal(result.ok, true);
}

test("static edits preserve originals during replacement", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importFixture(directory, "card");
    const originalBefore = await readFile(
      join(directory, "originals", "card.png"),
    );
    const renditionBefore = await readFile(
      join(directory, "media", "card.png"),
    );

    const result = await editImage({
      vaultDirectory: directory,
      id: "card",
      state: editorState("card", "An edited description."),
      capabilities,
      localSafety,
      blurSigma: 1,
    });
    assert.deepEqual(result, {
      ok: true,
      record: {
        id: "card",
        path: "media/card.png",
        name: "card",
        description: "An edited description.",
        english: false,
      },
    });

    assert.deepEqual(
      await readFile(join(directory, "originals", "card.png")),
      originalBefore,
    );
    assert.notDeepEqual(
      await readFile(join(directory, "media", "card.png")),
      renditionBefore,
    );
    const loaded = await loadMediaVault(directory);
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.deepEqual(loaded.records, [result.record]);
    }
  });
});

test("explicit verification can accompany a changed description", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importFixture(directory, "card");

    const result = await editImage({
      vaultDirectory: directory,
      id: "card",
      state: editorState("card", "A verified edited description."),
      english: true,
      capabilities,
      localSafety,
      blurSigma: 1,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.english, true);
    }
  });
});

test("unchanged descriptions preserve prior verification", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importFixture(directory, "card");

    const result = await editImage({
      vaultDirectory: directory,
      id: "card",
      state: editorState("card", "An original description."),
      capabilities,
      localSafety,
      blurSigma: 1,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.english, true);
    }
  });
});

test("display-name edits preserve stable IDs and vault paths", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importFixture(directory, "card");
    const originalBefore = await readFile(
      join(directory, "originals", "card.png"),
    );

    const result = await editImage({
      vaultDirectory: directory,
      id: "card",
      state: editorState("Renamed Card", "An edited description."),
      capabilities,
      localSafety,
      blurSigma: 1,
    });

    assert.deepEqual(result, {
      ok: true,
      record: {
        id: "card",
        path: "media/card.png",
        name: "Renamed Card",
        description: "An edited description.",
        english: false,
      },
    });
    assert.deepEqual(
      await readFile(join(directory, "originals", "card.png")),
      originalBefore,
    );
  });
});

test("unknown upload limits fail before original loading", async () => {
  const result = await editImage({
    vaultDirectory: "/path/that/must/not/be/read",
    id: "card",
    state: editorState("card", "An edited description."),
    capabilities: {
      ...capabilities,
      upload: {
        maxBytes: null,
        canvasWidth: null,
        canvasHeight: null,
        maxPixels: null,
      },
    },
    localSafety,
    blurSigma: 1,
  });

  assert.deepEqual(result, {
    ok: false,
    stage: "policy",
    code: "unverified-image-upload-limits",
  });
});

test("original content-format tampering fails before rendering", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importFixture(directory, "card");
    await writeFile(
      join(directory, "originals", "card.png"),
      GIF_2_FRAME_1X1,
    );

    const result = await editImage({
      vaultDirectory: directory,
      id: "card",
      state: editorState("card", "An edited description."),
      capabilities,
      localSafety,
      blurSigma: 1,
    });

    assert.deepEqual(result, {
      ok: false,
      stage: "source",
      code: "original-format-mismatch",
    });
  });
});

test("source byte ceilings stop oversized original reads", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importFixture(directory, "card");

    const result = await editImage({
      vaultDirectory: directory,
      id: "card",
      state: editorState("card", "An edited description."),
      capabilities,
      localSafety: {
        ...localSafety,
        maxSourceBytes: PNG_2X1.byteLength - 1,
      },
      blurSigma: 1,
    });

    assert.deepEqual(result, {
      ok: false,
      stage: "source",
      code: "source-image-too-large",
      message: "Source image exceeds the configured byte limit.",
    });
  });
});

test("invalid edited metadata fails before source admission", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importFixture(directory, "card");
    await writeFile(
      join(directory, "originals", "card.png"),
      Uint8Array.from([1, 2, 3]),
    );

    const result = await editImage({
      vaultDirectory: directory,
      id: "card",
      state: editorState("card", ""),
      capabilities,
      localSafety,
      blurSigma: 1,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, "metadata");
    }
  });
});

test("animated GIF edits persist without mutating originals", async () => {
  await withTemporaryDirectory(async (directory) => {
    await importFixture(directory, "timer", GIF_2_FRAME_1X1);
    const originalBefore = await readFile(
      join(directory, "originals", "timer.gif"),
    );
    const renditionBefore = await readFile(
      join(directory, "media", "timer.gif"),
    );

    const result = await editImage({
      vaultDirectory: directory,
      id: "timer",
      state: editorState("timer", "An edited timer."),
      capabilities,
      localSafety,
      blurSigma: 1,
    });

    assert.deepEqual(result, {
      ok: true,
      record: {
        id: "timer",
        path: "media/timer.gif",
        name: "timer",
        description: "An edited timer.",
        english: false,
      },
    });
    assert.deepEqual(
      await readFile(join(directory, "originals", "timer.gif")),
      originalBefore,
    );
    const renditionAfter = await readFile(
      join(directory, "media", "timer.gif"),
    );
    assert.notDeepEqual(renditionAfter, renditionBefore);

    const decoded = await decodeSourceImage(renditionAfter, 128);
    assert.equal(decoded.ok, true);
    if (decoded.ok) {
      assert.equal(decoded.value.frameCount, 2);
      assert.equal(decoded.value.animated, true);
      assert.deepEqual(decoded.value.frameDelaysMs, [100, 100]);
      assert.equal(decoded.value.loopCount, 1);
    }
  });
});
