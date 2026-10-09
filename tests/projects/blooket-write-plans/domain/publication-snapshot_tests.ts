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
//   - Regression coverage for durable snapshots and legacy text compatibility.
// - Must-Not:
//   - Store bytes, paths, URLs, credentials, or infer provider identity.
// - Allows:
//   - Inputs: Versioned frozen draft, capability, and expected-media
//     candidates.
//   - Outputs: Validated plans and expected identities without filesystem
//     authority.
//   - Side effects: None.
// - Split-When:
//   - Providers require incompatible baseline families.
// - Merge-When:
//   - Write recovery no longer compares pre/post provider collections.
// - Summary:
//   - Binds frozen drafts and byte identities to recoverable plan identities.
// - Description:
//   - Decodes both versions without resolving the current media library.
// - Usage:
//   - Run the mirrored Node suite before changing publication recovery.
// - Defaults:
//   - Unknown fields, duplicate IDs, and malformed identities fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { decodeBlooketPublicationSnapshot } from
  "../../../../src/projects/blooket-write-plans/domain/publication-snapshot.ts";

const capabilities = JSON.parse(await readFile(new URL(
  "../../../ir/capability-snapshots/contract/" +
    "blooket-official-2026-10-05.json", import.meta.url,
), "utf8"));
const document = {
  schemaVersion: 1, title: "Snapshot fixture", description: "Fixture",
  quizLanguage: "English", visibility: "private", mediaIndex: "media.jsonl",
  coverImage: null, questions: [{
    id: "q", type: "typing-answer", prompt: "Type image.",
    timeLimitSeconds: 20, image: null, matchMode: "exact", answer: "image",
  }],
};
const legacy = { schemaVersion: 1, draftId: "fixture",
  revision: "a".repeat(64), document, capabilities };
const identity = { mediaId: "icon", revision: 1, format: "png",
  byteLength: 30, sha256: "b".repeat(64) };
function mediaSnapshot() {
  return { ...legacy, schemaVersion: 2,
    document: { ...document, questions: [{ ...document.questions[0],
      image: { mediaId: "icon", description: "A synthetic icon." },
    }] },
    expectedMedia: { schemaVersion: 1, items: [{ ...identity }] },
  };
}

test("version two text snapshots retain legacy recovery bindings", () => {
  const first = decodeBlooketPublicationSnapshot(legacy, "fixture");
  const next = decodeBlooketPublicationSnapshot({ ...legacy, schemaVersion: 2,
    expectedMedia: { schemaVersion: 1, items: [] },
  }, "fixture");
  assert.ok(first && next);
  assert.deepEqual(first.plan, next.plan);
  assert.equal(first.expectedMedia, undefined);
  assert.deepEqual(next.expectedMedia, { schemaVersion: 1, items: [] });
});

test("media snapshots bind exact IDs and copy identity facts", () => {
  const source = mediaSnapshot();
  const decoded = decodeBlooketPublicationSnapshot(source, "fixture");
  assert.ok(decoded);
  const serialized = JSON.stringify(source);
  source.expectedMedia.items[0]!.sha256 = "c".repeat(64);
  source.document.questions[0]!.prompt = "Changed";
  assert.equal(decoded.expectedMedia?.items[0]?.sha256, identity.sha256);
  assert.equal(decoded.document.questions[0]?.prompt, "Type image.");
  assert.deepEqual(decodeBlooketPublicationSnapshot(JSON.parse(serialized),
    "fixture"), decoded);
  assert.ok(Object.isFrozen(decoded.expectedMedia?.items[0]));
});

test("exact versions reject legacy media and authority fields", () => {
  const current = mediaSnapshot();
  const { expectedMedia: unused, ...old } = current;
  void unused;
  for (const candidate of [
    { ...old, schemaVersion: 1 }, { ...legacy, schemaVersion: 0 },
    { ...legacy, expectedMedia: { schemaVersion: 1, items: [] } },
    { ...current, path: "/untrusted" },
    { ...current, revision: "bad" }, { ...current, draftId: "other" },
    { ...current, expectedMedia: { schemaVersion: 1, items: [] } },
    { ...current, expectedMedia: { schemaVersion: 1,
      items: [{ ...identity, url: "https://example.com/image" }] } },
  ]) assert.equal(decodeBlooketPublicationSnapshot(candidate, "fixture"),
    undefined);
});

test("unverifiable cover and answer media cannot enter a snapshot", () => {
  const current = mediaSnapshot();
  const image = current.document.questions[0]!.image;
  assert.equal(decodeBlooketPublicationSnapshot({ ...current,
    document: { ...current.document, coverImage: image },
  }, "fixture"), undefined);
  assert.equal(decodeBlooketPublicationSnapshot({ ...current,
    document: { ...current.document, questions: [{
      id: "mc", type: "multiple-choice", prompt: "Choose the image.",
      timeLimitSeconds: 20, randomOrder: true, image: null,
      answers: [{ text: null, image, correct: true },
        { text: "Other", image: null, correct: false }],
    }] },
    capabilities: { ...capabilities, features: { ...capabilities.features,
      answerImages: "supported" } },
  }, "fixture"), undefined);
});
