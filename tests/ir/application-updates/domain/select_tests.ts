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
  releaseAssetUrl,
  releasePageUrl,
} from "../../../../src/ir/application-updates/contract/releases.ts";
import {
  MAC_APPLICATION_BUNDLE,
  MAC_UPDATE_ARCHIVE,
  MAC_UPDATE_TARGET,
  selectPublicUpdate,
} from "../../../../src/ir/application-updates/domain/select.ts";

const now = new Date("2026-10-07T00:00:00Z");
const release = (revision: string, id = 1, names = ["darwin-arm64.zip"]) => {
  const tag = "v" + revision;
  return {
    schemaVersion: 1,
    id,
    tag,
    url: releasePageUrl(tag),
    publishedAt: "2026-10-06T12:00:00Z",
    draft: false,
    prerelease: false,
    assets: names.map((name, index) => ({
      id: id * 10 + index,
      name,
      size: 1234,
      state: "uploaded",
      url: releaseAssetUrl(tag, name),
    })),
  };
};
const choose = (values: unknown, target = "darwin-arm64") =>
  selectPublicUpdate(values, "26.4.0", target, now);

test("Mac update identity is ARM64 Blooket API.app only", () => {
  assert.equal(MAC_UPDATE_TARGET, "darwin-arm64");
  assert.equal(MAC_UPDATE_ARCHIVE, "darwin-arm64.zip");
  assert.equal(MAC_APPLICATION_BUNDLE, "Blooket API.app");
});

test(
  "empty, same and older catalogs are current, newer versions need trust",
  () => {
  assert.deepEqual(choose([]), { status: "current", skippedTags: 0 });
  assert.equal(choose([release("26.4.0")]).status, "current");
  assert.equal(choose([release("26.3.99999")]).status, "current");
  const selected = choose([release("26.4.9"), release("26.4.10", 2)]);
  assert.equal(selected.status, "available");
  if (selected.status !== "available") throw new Error("fixture");
  assert.equal(selected.version, "26.4.10");
  assert.equal(selected.verificationRequired, true);
  assert.equal(selected.asset.name, "darwin-arm64.zip");
  assert.equal(
    choose([release("26.4.1", 1, ["linux-x64.zip"])], "linux-x64").status,
    "unsupported-platform",
  );
});

test(
  "drafts and prereleases are ignored; invalid catalogs are failures", () => {
  assert.equal(
    choose([
      { ...release("27.1.0"), draft: true, publishedAt: null },
      { ...release("27.1.0", 2), prerelease: true },
    ]).status,
    "current",
  );
  assert.deepEqual(choose([release("2026.4.1")]), {
    status: "untrusted-metadata",
    reason: "no-valid-tags",
  });
  assert.equal(
    choose([release("2026.4.1"), release("26.4.0", 2)]).status,
    "current",
  );
  for (const catalog of [
    null,
    {},
    [{}],
    Array(101).fill(release("26.4.1")),
    [release("26.4.1"), release("26.4.2")],
    [release("26.4.1"), release("26.4.1", 2)],
  ])
    assert.equal(choose(catalog).status, "untrusted-metadata");
  assert.deepEqual(choose([release("27.1.0")]), {
    status: "untrusted-metadata",
    reason: "future",
  });
  assert.deepEqual(
    choose([{ ...release("26.4.1"), publishedAt: "2026-10-07T00:05:01Z" }]),
    {
      status: "untrusted-metadata",
      reason: "future",
    },
  );
});

test("wrong and duplicate assets never fall back to an older candidate", () => {
  assert.deepEqual(
    choose([release("26.4.1"), release("26.4.2", 2, ["linux-x64.zip"])]),
    {
      status: "incompatible-asset",
      version: "26.4.2",
      reason: "missing",
    },
  );
  assert.deepEqual(
    choose([release("26.4.1", 1, ["darwin-arm64.zip", "darwin-arm64.zip"])]),
    {
      status: "incompatible-asset",
      version: "26.4.1",
      reason: "duplicate",
    },
  );
  assert.equal(choose([], "linux-x64").status, "unsupported-platform");
});
