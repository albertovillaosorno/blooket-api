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
//   - Portable signed-ZIP staging regressions and owned fixtures.
// - Must-Not:
//   - Install, launch, consume secrets, or infer Apple trust.
// - Allows:
//   - Inputs: Ephemeral fixture keys and bounded synthetic ZIP records.
//   - Outputs: Bounded staging results still requiring Apple assessment.
//   - Side effects: Test-owned temporary files and native extraction doubles.
// - Split-When:
//   - Application replacement needs transactional installation authority.
// - Merge-When:
//   - Native extraction no longer needs independent physical validation.
// - Summary:
//   - Portable signed-ZIP staging regressions and owned fixtures.
// - Description:
//   - Preserves path, byte, link, and ownership bounds before installation.
// - Usage:
//   - Use only from trusted local update composition, never remote tools.
// - Defaults:
//   - Ambiguous or unsupported archives fail closed without app replacement.
//
import assert from "node:assert/strict";
import test from "node:test";
import { archivePath, buildArchiveLayout, BUNDLE_ROOT, MAX_ENTRY_BYTES,
  MAX_EXPANDED_BYTES, type ArchiveRecord } from
  "../../../../src/platforms/update-extraction/adapter-outbound/layout.ts";

const root = BUNDLE_ROOT + "/Contents/";
function base(): ArchiveRecord[] {
  return ["Info.plist", "MacOS/Blooket API", "Resources/runtime/node"].map(
    path => ({ path: root + path, kind: "file", size: 1,
      executable: path === "Info.plist" ? 0 : 0o111, hash: "a".repeat(64) }));
}
function link(path: string, target: string): ArchiveRecord {
  return { path: root + path, kind: "symlink", target, size: target.length,
    executable: 0 };
}
function directory(path: string): ArchiveRecord {
  return { path: root + path, kind: "directory", size: 0, executable: 0 };
}

test("framework-style internal chains resolve without following archive paths",
  () => {
    const framework = "Frameworks/Fixture.framework/";
    const entries = [...base(), directory(framework + "Versions/A/Resources"),
      link(framework + "Versions/Current", "A"),
      link(framework + "Resources", "Versions/Current/Resources")];
    const result = buildArchiveLayout(entries);
    assert.equal(result.bundle.get(root + framework + "Resources")?.target,
      "Versions/Current/Resources");
    assert.ok(result.bundle.has(root + framework + "Versions/A"));
  });

test("archive names reject traversal, foreign roots and filesystem aliases",
  () => {
    for (const path of ["/Blooket API.app/Contents", "../Blooket API.app",
      root + "../escape", root + "./alias", root + "double//slash",
      root + "back\\slash", root + "colon:name", root + "trailing ",
      root + " leading", root + "é", root + "control\n", "foreign/file",
      root + "nested/".repeat(41) + "file"])
      assert.throws(() => archivePath(path, false), /archive-layout/u);
    assert.equal(archivePath(BUNDLE_ROOT + "/", true), BUNDLE_ROOT);
    assert.throws(() => archivePath(BUNDLE_ROOT + "/", false),
      /archive-layout/u);
  });

test("duplicates, case collisions and non-directory ancestors fail closed",
  () => {
    for (const extra of [base()[0]!, { ...base()[0]!,
      path: root + "info.plist" }, { ...base()[0]!,
      path: root + "Info.plist/child" }, link("Resources", "MacOS")])
      assert.throws(() => buildArchiveLayout([...base(), extra]),
        /archive-layout/u);
  });

test("links reject escape, absence, cycles and symlink-before-parent aliases",
  () => {
    for (const extra of [[link("escape", "../../foreign")],
      [link("absolute", "/foreign")], [link("absent", "missing")],
      [link("loop", "loop")], [link("a", "b"), link("b", "a")],
      [link("Resources/ancestor", "..")],
      [link("alias", "Info.plist/../MacOS")],
      [link("Resources/redirect", "../MacOS"),
        link("Resources/trap", "redirect/../../Info.plist")],
      [directory("deep/child"), link("redirect", "deep/child"),
        link("trap", "redirect/../../../foreign")]])
      assert.throws(() => buildArchiveLayout([...base(), ...extra]),
        /archive-layout/u);
  });

test("AppleDouble sidecars require admitted counterparts and no links",
  () => {
    const sidecar: ArchiveRecord = {
      path: "__MACOSX/" + root + "._Info.plist",
      kind: "file", executable: 0, size: 26, hash: "b".repeat(64) };
    assert.equal(buildArchiveLayout([...base(), sidecar]).metadata
      .get(sidecar.path)?.size, 26);
    for (const extra of [{ ...sidecar, path: sidecar.path + "-foreign" },
      { ...sidecar, kind: "symlink" as const, target: "/foreign" },
      { ...sidecar, path: "__MACOSX/" + root + "ordinary" }])
      assert.throws(() => buildArchiveLayout([...base(), extra]),
        /archive-layout/u);
  });

test("entry and expanded byte bounds precede native extraction",
  () => {
    assert.throws(() => buildArchiveLayout([{ ...base()[0]!,
      size: MAX_ENTRY_BYTES + 1 }]), /archive-limit/u);
    const huge = [0, 1, 2].map(index => ({ ...base()[0]!,
      path: root + "large-" + index,
      size: Math.ceil(MAX_EXPANDED_BYTES / 2) }));
    assert.throws(() => buildArchiveLayout([...base(), ...huge]),
      /archive-limit/u);
    assert.throws(() => buildArchiveLayout(base().slice(0, 2)),
      /archive-layout/u);
  });
