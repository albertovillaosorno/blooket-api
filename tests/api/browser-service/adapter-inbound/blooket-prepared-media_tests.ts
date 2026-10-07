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
//   - Composition tests for current teacher-library prepared Blooket media.
// - Must-Not:
//   - Read a real library, run native image code, upload, or contact Blooket.
// - Allows:
//   - Inputs: Injected preference and prepared-read doubles.
//   - Outputs: Exact current-canvas calls and stable result mappings.
//   - Side effects: In-memory call tracking only.
// - Split-When:
//   - Publication gains an independent composition service.
// - Merge-When:
//   - Blooket prepared-media composition is removed.
// - Summary:
//   - Proves current canvas and exact prepared bytes cross the adapter
//     boundary.
// - Description:
//   - Vault filenames are converted to format facts and not returned
//     downstream.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unexpected errors fail as media unavailable.
//
import assert from "node:assert/strict";
import test from "node:test";

import { createBlooketPreparedMediaReadPort } from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/api/browser-service/adapter-inbound/blooket-prepared-media.ts";

function preferences() {
  return {
    mediaRoot: "/synthetic/library",
    defaults: {
      width: 1200,
      height: 675,
      compression: 80,
      gifFps: 20,
      detailScale: 1,
    },
  };
}

test(
  "adapter binds current canvas and preserves exact prepared bytes",
  async () => {
  const calls: unknown[] = [];
  const bytes = new Uint8Array([4, 3, 2, 1]);
  const port = createBlooketPreparedMediaReadPort(
    "/synthetic/root",
    {
      loadPreferences: async (root) => {
        calls.push(["preferences", root]);
        return preferences() as Awaited<ReturnType<
          typeof import(
            "../../../../src/platforms/user-storage/adapter-outbound/root.ts"
          ).loadPreferences
        >>;
      },
      readPrepared: async (
        library,
        mediaId,
        revision,
        canvas,
      ) => {
        calls.push([
          "prepared",
          library,
          mediaId,
          revision,
          canvas,
        ]);
        return {
          bytes,
          file: "renditions/sun/7.jpg",
          revision: 7,
        };
      },
    },
  );

  const result = await port.read("sun");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.bytes, bytes);
  assert.deepEqual(result.value, {
    mediaId: "sun",
    revision: 7,
    format: "jpeg",
    bytes,
  });
  assert.deepEqual(calls, [
    ["preferences", "/synthetic/root"],
    [
      "prepared",
      "/synthetic/library",
      "sun",
      undefined,
      { width: 1200, height: 675 },
    ],
  ]);
  },
);

test("adapter maps only known prepared-media failures", async () => {
  const expected = new Map([
    ["media-not-found", "blooket-media-not-prepared"],
    ["media-not-prepared", "blooket-media-not-prepared"],
    ["prepared-revision-conflict", "blooket-media-stale"],
    ["prepared-settings-conflict", "blooket-media-stale"],
    ["prepared-media-invalid", "blooket-media-invalid"],
    ["library-busy", "blooket-media-unavailable"],
  ] as const);

  for (const [message, code] of expected) {
    const port = createBlooketPreparedMediaReadPort(
      "/synthetic/root",
      {
        loadPreferences: async () => preferences() as never,
        readPrepared: async () => {
          throw new Error(message);
        },
      },
    );
    assert.deepEqual(await port.read("sun"), {
      ok: false,
      code,
    });
  }
});

test("unknown extension and non-Error failures fail closed", async () => {
  const invalidFormat = createBlooketPreparedMediaReadPort(
    "/synthetic/root",
    {
      loadPreferences: async () => preferences() as never,
      readPrepared: async () => ({
        bytes: new Uint8Array(1),
        file: "renditions/sun/1.webp",
        revision: 1,
      }),
    },
  );
  assert.deepEqual(await invalidFormat.read("sun"), {
    ok: false,
    code: "blooket-media-invalid",
  });

  const unavailable = createBlooketPreparedMediaReadPort(
    "/synthetic/root",
    {
      loadPreferences: async () => {
        throw "synthetic";
      },
      readPrepared: async () => {
        throw new Error("unreachable");
      },
    },
  );
  assert.deepEqual(await unavailable.read("sun"), {
    ok: false,
    code: "blooket-media-unavailable",
  });
});
