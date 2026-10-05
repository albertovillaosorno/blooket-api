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
//   - Behavioral tests for runtime and persisted media-record decoding.
// - Must-Not:
//   - Decode image bytes or test media transformations.
// - Allows:
//   - Inputs: Fixed media metadata fixtures across supported schema versions.
//   - Outputs: Deterministic migration and validation verdicts.
//   - Side effects: None.
// - Split-When:
//   - Media path and metadata validation require independent fixtures.
// - Merge-When:
//   - Media records cease to exist as a separate contract.
// - Summary:
//   - Verifies stable IDs, display names, migrations, and local path safety.
// - Description:
//   - Mirrors src/media/media-records/domain/media-record.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Legacy names migrate from IDs; new records default verification false.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  createMediaRecord,
  decodeMediaRecord,
  decodePersistedMediaRecord,
} from "../../../../src/media/media-records/domain/media-record.ts";

const legacy = {
  id: "yellow-bus",
  path: "images/yellow-bus.avif",
  description: "A yellow school bus viewed from the side.",
  english: false,
};

test("legacy runtime records migrate display names from stable IDs", () => {
  assert.deepEqual(decodeMediaRecord(legacy), {
    ok: true,
    value: {
      ...legacy,
      name: "yellow-bus",
    },
  });
});

test("version-two persisted records keep editable display names", () => {
  assert.deepEqual(
    decodePersistedMediaRecord({
      schemaVersion: 2,
      ...legacy,
      name: "Yellow Bus",
    }),
    {
      ok: true,
      value: {
        ...legacy,
        name: "Yellow Bus",
      },
    },
  );
});

test("legacy persisted records migrate without a schema field", () => {
  assert.deepEqual(decodePersistedMediaRecord(legacy), {
    ok: true,
    value: {
      ...legacy,
      name: "yellow-bus",
    },
  });
});

test("future persisted media-record versions fail closed", () => {
  const result = decodePersistedMediaRecord({
    schemaVersion: 3,
    ...legacy,
    name: "Yellow Bus",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0]?.path, "$.schemaVersion");
  }
});

test("media records reject source URLs", () => {
  const result = decodeMediaRecord({
    ...legacy,
    name: "Yellow Bus",
    url: "https://example.com/yellow-bus.avif",
  });

  assert.equal(result.ok, false);
});

test("media records reject parent path traversal", () => {
  const result = decodeMediaRecord({
    ...legacy,
    name: "Yellow Bus",
    path: "../secret.jpg",
  });

  assert.equal(result.ok, false);
});

test("media records require explicit English verification state", () => {
  const { english: _english, ...missingEnglish } = legacy;

  assert.equal(decodeMediaRecord(missingEnglish).ok, false);
});

test("media display names must be non-empty", () => {
  assert.equal(
    decodeMediaRecord({
      ...legacy,
      name: "",
    }).ok,
    false,
  );
});

test("new media records default names to stable IDs", () => {
  const result = createMediaRecord({
    id: "yellow-bus",
    path: "images/yellow-bus.avif",
    description: "A yellow school bus viewed from the side.",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, "yellow-bus");
    assert.equal(result.value.english, false);
  }
});

test("new media records preserve display names and verification", () => {
  const result = createMediaRecord({
    id: "yellow-bus",
    path: "images/yellow-bus.avif",
    name: "School Bus",
    description: "A yellow school bus viewed from the side.",
    english: true,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, "School Bus");
    assert.equal(result.value.english, true);
  }
});
