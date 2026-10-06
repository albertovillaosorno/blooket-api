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
//   - Bounded subprocess isolation for native image decode and rendering.
// - Must-Not:
//   - Pass credentials, user paths, or raw native errors to the worker.
// - Allows:
//   - Inputs: Admitted image bytes and recipes from the application boundary.
//   - Outputs: Validated image facts or bounded prepared bytes.
//   - Side effects: Starts one temporary child with a deadline and minimal
//     environment.
// - Split-When:
//   - Host resource admission needs an independent platform boundary.
// - Merge-When:
//   - Native processing no longer needs process isolation.
// - Summary:
//   - Kills stalled native work without blocking independent service requests.
// - Description:
//   - Sends bounded values over IPC instead of shell arguments or log output.
// - Usage:
//   - Call only from trusted application composition, never with model paths.
// - Defaults:
//   - Jobs time out after 20 seconds and exit before the caller resumes.
//
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  decodeImageIsolated,
  renderImageIsolated,
  renderEditorIsolated,
} from "../../../../src/platforms/native-media/adapter-outbound/process.ts";
import { loadSharp } from
  "../../../../src/media/sharp-runtime/adapter-outbound/sharp-runtime.ts";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPo" +
    "AAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwHwwZGP6DAQBJyAn3iFfyTAAAAA" +
    "BJRU5ErkJggg==",
  "base64",
);
const GIF = Buffer.from(
  "R0lGODlhAgACAIIAAExpcQD/AP8AAP///wAA/wAAAAAAAAAAAC" +
    "H/C05FVFNDQVBFMi4wAwEBAAAh+QQFCAAAACwAAAAAAgACAAADAyhBkwAh+QQFDg" +
    "AAACwAAAAAAgACAIJMaXH//wAAAAAA////AP8AAAAAAAAAAAADAygxlAA7",
  "base64",
);
const recipe = {
  panX: 0,
  panY: 0,
  zoom: 1,
  saturation: 1,
  contrast: 1,
  background: { mode: "solid" as const, color: "#ffffff" },
  width: 16,
  height: 16,
  gifFps: 20,
  compression: "compact" as const,
};
function gone(pid: number) {
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}
async function worker(source: string, action: (url: URL) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "native-worker-test-"));
  try {
    const path = join(root, "worker.mjs");
    await writeFile(path, source);
    await action(pathToFileURL(path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("isolated decode returns facts only after its worker exits", async () => {
  let pid = 0;
  const decoded = await decodeImageIsolated(PNG, 128, {
    spawned: (value) => {
      pid = value;
    },
  });
  assert.ok(decoded.ok);
  if (!decoded.ok) return;
  assert.equal(decoded.value.frameWidth, 2);
  assert.equal(decoded.value.frameHeight, 2);
  assert.equal(decoded.value.format.format, "png");
  gone(pid);
});
test("isolated GIF rendering preserves loops and explicit 20 FPS", async () => {
  const result = await renderImageIsolated(GIF, recipe);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.value.bytes.length < 2_500_000);
  const sharp = await loadSharp();
  const output = await sharp(result.value.bytes, { animated: true }).metadata();
  assert.equal(output.pages, 4);
  assert.deepEqual(output.delay, [50, 50, 50, 50]);
  assert.equal(output.loop, 2);
  assert.equal(output.width, 16);
  assert.equal(output.pageHeight, 16);
  assert.ok(
    Math.abs(output.delay!.reduce((sum, item) => sum + item, 0) - 220) <= 50,
  );
});
test(
  "timeout kills a stalled worker " + "and independent decode remains usable",
  async () => {
    await worker("setInterval(() => {}, 1000);", async (url) => {
      let pid = 0;
      await assert.rejects(
        decodeImageIsolated(PNG, 128, {
          worker: url,
          timeoutMs: 50,
          spawned: (value) => {
            pid = value;
          },
        }),
        /native-media-timeout/u,
      );
      gone(pid);
    });
    assert.equal((await decodeImageIsolated(PNG, 128)).ok, true);
  },
);
test(
  "abort waits for worker cleanup " + "and does not expose native errors",
  async () => {
    await worker("setInterval(() => {}, 1000);", async (url) => {
      let pid = 0;
      const controller = new AbortController();
      await assert.rejects(
        decodeImageIsolated(PNG, 128, {
          worker: url,
          signal: controller.signal,
          spawned: (value) => {
            pid = value;
            controller.abort();
          },
        }),
        /native-media-cancelled/u,
      );
      gone(pid);
    });
    await worker("process.exit(2);", async (url) => {
      await assert.rejects(
        decodeImageIsolated(PNG, 128, { worker: url }),
        /native-media-failed/u,
      );
    });
  },
);
test("worker receives no inherited development credentials", async () => {
  process.env["NATIVE_MEDIA_SYNTHETIC_SECRET"] = "synthetic-value";
  try {
    await worker(
      `process.once('message', () => process.send({ok:false,
      code:process.env.NATIVE_MEDIA_SYNTHETIC_SECRET ? 'invalid-pixel-limit'
      : 'image-decode-failed'}, () => process.exit(0)));`,
      async (url) => {
        assert.deepEqual(await decodeImageIsolated(PNG, 128, { worker: url }), {
          ok: false,
          code: "image-decode-failed",
        });
      },
    );
  } finally {
    delete process.env["NATIVE_MEDIA_SYNTHETIC_SECRET"];
  }
});
test(
  "malformed worker replies cannot " + "claim a valid prepared file",
  async () => {
    await worker(
      `process.once('message', () => process.send({ok:true,
    value:{bytes:new Uint8Array([1]),format:'png',mediaType:'image/png',
    width:16,height:16,frameCount:1,animated:false}}, () => process.exit(0)));`,
      async (url) => {
        await assert.rejects(
          renderImageIsolated(PNG, recipe, { worker: url }),
          /native-media-invalid-result/u,
        );
      },
    );
  },
);

test(
  "legacy editor jobs preserve regions and return bounded " +
    "timeout failures",
  async () => {
  const state = {
    name: "Fixture",
    description: "Fixture",
    transform: { panX: 0, panY: 0, zoom: 1, saturation: 1, contrast: 1 },
    regions: [
      {
        id: "redact",
        mode: "redact" as const,
        x: 0,
        y: 0,
        width: 0.5,
        height: 0.5,
      },
    ],
  };
  const limits = {
    maxInputPixels: 128,
    maxOutputPixels: 128,
    maxOutputBytes: 65536,
  };
  const result = await renderEditorIsolated(
    PNG,
    state,
    { width: 2, height: 2 },
    limits,
    { blurSigma: 1 },
  );
  assert.ok(result.ok);
  if (result.ok) {
    const sharp = await loadSharp();
    const pixels = await sharp(result.value.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual([...pixels.slice(0, 4)], [0, 0, 0, 255]);
  }
  await worker("setInterval(() => {}, 1000);", async (url) => {
    assert.deepEqual(
      await renderEditorIsolated(
        PNG,
        state,
        { width: 2, height: 2 },
        limits,
        { blurSigma: 1 },
        { worker: url, timeoutMs: 50 },
      ),
      { ok: false, code: "native-media-timeout" },
    );
  });
});
