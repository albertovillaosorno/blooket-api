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
//   - Quarterly CalVer admission for explicit release tags.
// - Must-Not:
//   - Use production data, credentials, or a live Blooket account.
// - Allows:
//   - Inputs: One admitted native target and explicit release verification.
//   - Outputs: A passing smoke result or a failing process exit.
//   - Side effects: None.
// - Split-When:
//   - Another distribution format needs independent acceptance.
// - Merge-When:
//   - Package verification no longer requires native execution.
// - Summary:
//   - Rejects malformed calendar versions before release execution.
// - Description:
//   - Defines three-month UTC quarters and monotonic release revisions.
// - Usage:
//   - Validate the operator-selected tag before release execution.
// - Defaults:
//   - Failed checks block release and cleanup only the owned fixture.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeReleaseTag,
  assertProductReleaseTag,
  initialReleaseTag,
} from "../../../../src/platforms/distribution/domain/release-tag.ts";
test("quarterly CalVer changes on three-month UTC boundaries", () => {
  for (const [date, tag] of [
    ["2026-03-31T23:59:59Z", "v26.1.0"],
    ["2026-04-01T00:00:00Z", "v26.2.0"],
    ["2026-07-01T00:00:00Z", "v26.3.0"],
    ["2026-10-01T00:00:00Z", "v26.4.0"],
    ["2027-01-01T00:00:00Z", "v27.1.0"],
  ] as const)
    assert.equal(initialReleaseTag(new Date(date)), tag);
  assert.deepEqual(decodeReleaseTag("v26.4.2"), {
    year: 2026,
    quarter: 4,
    revision: 2,
    tag: "v26.4.2",
  });
  for (const tag of [
    "v26.0.0",
    "v26.5.0",
    "v26.4.01",
    "v26.4.0;bad",
    "2026.4.0",
    "v26.4.-1",
  ])
    assert.throws(() => decodeReleaseTag(tag));
});

test("release gate rejects obsolete tags and version/source disagreement",
() => {
  assert.equal(assertProductReleaseTag("v26.4.0"), "v26.4.0");
  for (const value of [
    "v2026.4.0",
    "2026.4.0",
    "26.4.0",
    "v26.04.0",
    "v26.4.1",
    "v27.1.0",
  ])
    assert.throws(() => assertProductReleaseTag(value));
  assert.throws(() => initialReleaseTag(new Date("invalid")));
  assert.throws(() => initialReleaseTag(new Date("2100-01-01T00:00:00Z")));
  assert.equal(initialReleaseTag(new Date("2000-01-01T00:00:00Z")), "v00.1.0");
});
