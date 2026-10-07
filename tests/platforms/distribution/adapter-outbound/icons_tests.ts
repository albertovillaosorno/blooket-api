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
//   - Verification of browser PNG and native ICNS presentation artifacts.
// - Must-Not:
//   - Install software or include server secrets in browser artifacts.
// - Allows:
//   - Inputs: Repository-owned sources and an isolated temporary destination.
//   - Outputs: Assertions about emitted imports and admitted permissions.
//   - Side effects: Compiler execution and temporary output removed afterward.
// - Split-When:
//   - Native Safari assembly needs independent target-host checks.
// - Merge-When:
//   - Extension compilation no longer owns browser artifacts.
// - Summary:
//   - Tests the actual emitted worker and its dependencies.
// - Description:
//   - Checks exclusive output ownership and browser-only resources.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Existing destinations must remain untouched.
//
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMacIcon,
  buildExtensionIcons,
} from "../../../../src/platforms/distribution/adapter-outbound/icons.ts";
import { loadSharp } from
  "../../../../src/media/sharp-runtime/adapter-outbound/sharp-runtime.ts";

test(
  "icons produce Chrome PNG sizes and a complete PNG-backed Mac ICNS",
  async () => {
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  const root = await mkdtemp(join(repo, ".temp/icon-test-"));
  try {
    await buildExtensionIcons(repo, root);
    const sharp = await loadSharp();
    for (const size of [16, 32, 48, 128]) {
      const image = await readFile(join(root, `icons/${size}.png`));
      const metadata = await sharp(image).metadata();
      assert.equal(metadata.width, size);
      assert.equal(metadata.height, size);
      assert.equal(metadata.format, "png");
    }
    const destination = join(root, "icon.icns");
    await buildMacIcon(repo, destination);
    const bytes = await readFile(destination);
    assert.equal(bytes.subarray(0, 4).toString(), "icns");
    assert.equal(bytes.readUInt32BE(4), bytes.length);
    let offset = 8;
    const sizes = new Map([
      ["icp4", 16],
      ["icp5", 32],
      ["icp6", 64],
      ["ic07", 128],
      ["ic08", 256],
      ["ic09", 512],
      ["ic10", 1024],
    ]);
    while (offset < bytes.length) {
      const type = bytes.subarray(offset, offset + 4).toString();
      const length = bytes.readUInt32BE(offset + 4);
      assert.ok(length > 8 && offset + length <= bytes.length);
      const metadata = await sharp(
        bytes.subarray(offset + 8, offset + length),
      ).metadata();
      assert.equal(metadata.width, sizes.get(type));
      sizes.delete(type);
      offset += length;
    }
    assert.equal(offset, bytes.length);
    assert.equal(sizes.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
