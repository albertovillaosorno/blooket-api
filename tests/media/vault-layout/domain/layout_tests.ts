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
//   - Tests for deterministic media-vault path derivation.
// - Must-Not:
//   - Touch the filesystem or test image decoding.
// - Allows:
//   - Inputs: Stable media IDs and supported source/rendition formats.
//   - Outputs: Exact normalized relative path verdicts.
//   - Side effects: None.
// - Split-When:
//   - Multiple vault layout versions require separate fixtures.
// - Merge-When:
//   - Vault paths are no longer a distinct media-domain contract.
// - Summary:
//   - Verifies originals and renditions cannot select arbitrary locations.
// - Description:
//   - Covers canonical JPEG extension handling and invalid IDs.
// - Usage:
//   - Run with the repository Node test command.
// - Defaults:
//   - Prepared assets use media/<id>.<format>.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaRenditionPath,
  mediaVaultPaths,
  sourceExtension,
} from "../../../../src/media/vault-layout/domain/layout.ts";

test("vault paths separate immutable originals from renditions", () => {
  assert.deepEqual(mediaVaultPaths("yellow-bus", "jpeg", "png"), {
    original: "originals/yellow-bus.jpg",
    rendition: "media/yellow-bus.png",
  });
  assert.deepEqual(mediaVaultPaths("timer", "gif", "gif"), {
    original: "originals/timer.gif",
    rendition: "media/timer.gif",
  });
});

test("source extensions are canonical for every admitted format", () => {
  assert.equal(sourceExtension("jpeg"), ".jpg");
  assert.equal(sourceExtension("png"), ".png");
  assert.equal(sourceExtension("webp"), ".webp");
  assert.equal(sourceExtension("avif"), ".avif");
  assert.equal(sourceExtension("gif"), ".gif");
});

test("rendition paths can be derived without source format", () => {
  assert.equal(mediaRenditionPath("sun", "png"), "media/sun.png");
  assert.equal(mediaRenditionPath("timer", "gif"), "media/timer.gif");
  assert.equal(mediaRenditionPath("../sun", "png"), undefined);
});

test("invalid media IDs cannot produce vault paths", () => {
  assert.equal(mediaVaultPaths("../secret", "png", "png"), undefined);
  assert.equal(mediaVaultPaths("UPPER", "png", "png"), undefined);
});
