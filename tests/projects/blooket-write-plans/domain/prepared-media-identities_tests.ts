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
//   - Unit tests for non-sensitive Blooket write prepared-media identities.
// - Must-Not:
//   - Observe Blooket, persist files, or test provider canonicalization.
// - Allows:
//   - Inputs: Deterministic identity candidates and byte views.
//   - Outputs: Exact identity decoding, copying, and equality verdicts.
//   - Side effects: None.
// - Split-When:
//   - Media families gain independent identity schemas.
// - Merge-When:
//   - Durable prepared-media identities are removed.
// - Summary:
//   - Proves exact bounded identity facts cross the domain.
// - Description:
//   - No path, private media, or provider capture enters these fixtures.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Unknown fields and malformed digests fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodePreparedMediaIdentities, identifyPreparedMedia,
  samePreparedMediaIdentity,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/projects/blooket-write-plans/domain/prepared-media-identities.ts";

const identity = {
  mediaId: "sun", revision: 3, format: "png" as const,
  byteLength: 3, sha256: "a".repeat(64),
};

test("durable media identity roundtrips without bytes or path authority",
  () => {
  const candidate = { schemaVersion: 1, items: [{ ...identity }] };
  const decoded = decodePreparedMediaIdentities(candidate);
  assert.deepEqual(decoded, candidate);
  candidate.items[0]!.sha256 = "b".repeat(64);
  candidate.items.push({ ...identity, mediaId: "moon" });
  assert.equal(decoded?.items.length, 1);
  assert.equal(decoded?.items[0]?.sha256, identity.sha256);
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded?.items), true);
  assert.equal(Object.isFrozen(decoded?.items[0]), true);
  assert.deepEqual(decodePreparedMediaIdentities(JSON.parse(
    JSON.stringify(decoded),
  )), decoded);
});

test("identity rejects malformed fields, duplicates and oversized manifests",
  () => {
  for (const invalid of [
    null, [], {}, { schemaVersion: 2, items: [] },
    { schemaVersion: 1, items: [], path: "/tmp/unowned" },
    { schemaVersion: 1, items: [identity, identity] },
    { schemaVersion: 1, items: new Array(10_001).fill(identity) },
    ...[
      { mediaId: "../sun" }, { revision: 0 }, { revision: 1.5 },
      { format: "svg" }, { byteLength: 0 }, { byteLength: 2_500_000 },
      { byteLength: 1.5 }, { sha256: "A".repeat(64) }, { sha256: "short" },
      { bytes: [1, 2, 3] }, { url: "https://example.invalid/image" },
    ].map(change => ({ schemaVersion: 1,
      items: [{ ...identity, ...change }] })),
  ]) assert.equal(decodePreparedMediaIdentities(invalid), undefined);
});

test("identity hashes the actual byte view and compares every durable fact",
  () => {
  const bytes = new Uint8Array([0, 97, 98, 99, 0]);
  const actual = identifyPreparedMedia({ ...identity,
    bytes: bytes.subarray(1, 4) });
  assert.ok(actual);
  assert.equal(actual.byteLength, 3);
  assert.equal(actual.sha256,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(samePreparedMediaIdentity(actual, { ...actual }), true);
  for (const change of [{ mediaId: "moon" }, { revision: 4 },
    { format: "gif" as const }, { byteLength: 4 },
    { sha256: "b".repeat(64) }])
    assert.equal(samePreparedMediaIdentity(actual, { ...actual, ...change }),
      false);
  assert.equal(identifyPreparedMedia({ ...identity,
    bytes: new Uint8Array(2_500_000) }), undefined);
});
