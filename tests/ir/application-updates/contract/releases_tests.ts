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
//   - Normalized public release metadata and bounded update selection.
// - Must-Not:
//   - Install applications, trust unsigned archives, or consume secrets.
// - Allows:
//   - Inputs: Unknown release candidates and explicit current host/version.
//   - Outputs: Exact decoded metadata and local update status.
//   - Side effects: None.
// - Split-When:
//   - Trusted manifests add an independent installation contract.
// - Merge-When:
//   - Release metadata gains a shared versioned authority.
// - Summary:
//   - Selects final public candidates without claiming installation trust.
// - Description:
//   - Rejects malformed metadata, foreign assets, and future releases.
// - Usage:
//   - Decode adapter projections before selecting an update candidate.
// - Defaults:
//   - Invalid input produces a bounded failure rather than no updates.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeUpdateRelease,
  releaseAssetUrl,
  releasePageUrl,
  MAX_UPDATE_ARCHIVE_BYTES,
} from "../../../../src/ir/application-updates/contract/releases.ts";

const release = () => ({
  schemaVersion: 1,
  id: 1,
  tag: "v26.4.1",
  url: releasePageUrl("v26.4.1"),
  publishedAt: "2026-10-06T12:00:00Z",
  draft: false,
  prerelease: false,
  assets: [
    {
      id: 2,
      name: "darwin-arm64.zip",
      size: 1234,
      state: "uploaded",
      url: releaseAssetUrl("v26.4.1", "darwin-arm64.zip"),
    },
  ],
});

test("release metadata is exact and projected without aliasing", () => {
  const value = release();
  const decoded = decodeUpdateRelease(value);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) throw new Error("fixture");
  value.assets[0]!.size = 1;
  assert.equal(decoded.value.assets[0]!.size, 1234);
  for (const value of [
    null,
    [],
    {},
    { ...release(), unknown: 1 },
    { ...release(), id: 0 },
    { ...release(), draft: "false" },
    { ...release(), publishedAt: null },
    { ...release(), publishedAt: "2026-02-30T00:00:00Z" },
    { ...release(), publishedAt: "2026-10-06" },
    { ...release(), tag: "v26.4.1/escape" },
    { ...release(), url: "https://github.com/other/repo/releases/tag/v26.4.1" },
  ])
    assert.equal(decodeUpdateRelease(value).ok, false);
  assert.equal(
    decodeUpdateRelease({ ...release(), draft: true, publishedAt: null }).ok,
    true,
  );
});

test("asset URLs, byte bounds, IDs and names fail closed", () => {
  for (const change of [
    { size: 0 },
    { size: MAX_UPDATE_ARCHIVE_BYTES + 1 },
    { size: 1.1 },
    { state: "open" },
    { name: "../app.zip" },
    { url: "https://example.test/app.zip" },
    { url: releaseAssetUrl("v26.4.2", "darwin-arm64.zip") },
    { secret: "not admitted" },
  ]) {
    const value = release();
    assert.equal(
      decodeUpdateRelease({
        ...value,
        assets: [{ ...value.assets[0], ...change }],
      }).ok,
      false,
    );
  }
  const value = release();
  assert.equal(
    decodeUpdateRelease({
      ...value,
      assets: [value.assets[0], value.assets[0]],
    }).ok,
    false,
  );
  assert.equal(
    decodeUpdateRelease({ ...value, assets: Array(51).fill(value.assets[0]) })
      .ok,
    false,
  );
});
