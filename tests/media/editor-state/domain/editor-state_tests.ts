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
//   - Behavioral tests for immutable media-editor state and history.
// - Must-Not:
//   - Decode or render image bytes.
// - Allows:
//   - Inputs: Fixed editor actions, regions, and explicit history bounds.
//   - Outputs: Deterministic state, validation, undo, and redo verdicts.
//   - Side effects: None.
// - Split-When:
//   - Rendering gains independent editor-state integration fixtures.
// - Merge-When:
//   - Media editor state is removed as a standalone domain contract.
// - Summary:
//   - Covers transforms, nudging, metadata, redactions, and bounded history.
// - Description:
//   - Verifies invalid edits fail without altering prior immutable states.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Tests choose their own history bounds and nudge amounts.
//
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMediaEditorAction,
  createMediaEditorHistory,
  redoMediaEditor,
  undoMediaEditor,
} from "../../../../src/media/editor-state/domain/editor-state.ts";

function initial(limit = 4) {
  const result = createMediaEditorHistory("sun", "A bright sun.", limit);
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected valid editor history fixture.");
  }
  return result.value;
}

test("editor history starts from neutral transform values", () => {
  assert.deepEqual(initial().present, {
    name: "sun",
    description: "A bright sun.",
    transform: {
      panX: 0,
      panY: 0,
      zoom: 1,
      contrast: 1,
      saturation: 1,
    },
    regions: [],
  });
});

test("pan nudging and tonal edits are immutable and undoable", () => {
  const start = initial();
  const panned = applyMediaEditorAction(start, {
    type: "nudge-pan",
    dx: 0.05,
    dy: -0.1,
  });
  assert.equal(panned.ok, true);
  if (!panned.ok) {
    return;
  }
  const toned = applyMediaEditorAction(panned.value, {
    type: "set-contrast",
    value: 1.25,
  });
  assert.equal(toned.ok, true);
  if (!toned.ok) {
    return;
  }

  assert.deepEqual(start.present.transform, {
    panX: 0,
    panY: 0,
    zoom: 1,
    contrast: 1,
    saturation: 1,
  });
  assert.equal(toned.value.present.transform.panX, 0.05);
  assert.equal(toned.value.present.transform.panY, -0.1);
  assert.equal(toned.value.present.transform.contrast, 1.25);

  const undone = undoMediaEditor(toned.value);
  assert.equal(undone.present.transform.contrast, 1);
  assert.equal(redoMediaEditor(undone).present.transform.contrast, 1.25);
});

test("pan nudges reject arithmetic overflow", () => {
  const start = initial();
  const first = applyMediaEditorAction(start, {
    type: "set-pan",
    x: Number.MAX_VALUE,
    y: 0,
  });
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }

  assert.deepEqual(
    applyMediaEditorAction(first.value, {
      type: "nudge-pan",
      dx: Number.MAX_VALUE,
      dy: 0,
    }),
    { ok: false, code: "invalid-editor-action" },
  );
});

test("zoom saturation name and description edits share one history", () => {
  let history = initial();
  for (const action of [
    { type: "set-zoom", value: 2 },
    { type: "set-saturation", value: 0.75 },
    { type: "set-name", value: "sun-closeup" },
    { type: "set-description", value: "A close view of the sun." },
  ] as const) {
    const result = applyMediaEditorAction(history, action);
    assert.equal(result.ok, true);
    if (result.ok) {
      history = result.value;
    }
  }

  assert.equal(history.present.transform.zoom, 2);
  assert.equal(history.present.transform.saturation, 0.75);
  assert.equal(history.present.name, "sun-closeup");
  assert.equal(history.present.description, "A close view of the sun.");
  assert.equal(history.past.length, 4);
});

test("rectangular blur and redaction regions use normalized bounds", () => {
  const start = initial();
  const blurred = applyMediaEditorAction(start, {
    type: "add-region",
    region: {
      id: "face",
      mode: "blur",
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    },
  });
  assert.equal(blurred.ok, true);
  if (!blurred.ok) {
    return;
  }
  const redacted = applyMediaEditorAction(blurred.value, {
    type: "add-region",
    region: {
      id: "label",
      mode: "redact",
      x: 0.6,
      y: 0.7,
      width: 0.4,
      height: 0.3,
    },
  });
  assert.equal(redacted.ok, true);
  if (!redacted.ok) {
    return;
  }
  assert.equal(redacted.value.present.regions.length, 2);

  const removed = applyMediaEditorAction(redacted.value, {
    type: "remove-region",
    id: "face",
  });
  assert.equal(removed.ok, true);
  if (removed.ok) {
    assert.deepEqual(
      removed.value.present.regions.map((region) => region.id),
      ["label"],
    );
  }
});

test("invalid transforms and regions fail without adding history", () => {
  const start = initial();

  for (const action of [
    { type: "set-zoom", value: 0 },
    { type: "set-contrast", value: -1 },
    { type: "set-saturation", value: Number.NaN },
  ] as const) {
    assert.deepEqual(applyMediaEditorAction(start, action), {
      ok: false,
      code: "invalid-editor-action",
    });
  }

  assert.deepEqual(
    applyMediaEditorAction(start, {
      type: "add-region",
      region: {
        id: "outside",
        mode: "redact",
        x: 0.8,
        y: 0.8,
        width: 0.3,
        height: 0.3,
      },
    }),
    { ok: false, code: "invalid-editor-action" },
  );
  assert.equal(start.past.length, 0);
});

test("region IDs are unique and missing removals fail closed", () => {
  const start = initial();
  const added = applyMediaEditorAction(start, {
    type: "add-region",
    region: {
      id: "face",
      mode: "blur",
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    },
  });
  assert.equal(added.ok, true);
  if (!added.ok) {
    return;
  }

  assert.deepEqual(
    applyMediaEditorAction(added.value, {
      type: "add-region",
      region: added.value.present.regions[0]!,
    }),
    { ok: false, code: "duplicate-region-id" },
  );
  assert.deepEqual(
    applyMediaEditorAction(added.value, {
      type: "remove-region",
      id: "missing",
    }),
    { ok: false, code: "missing-region-id" },
  );
});

test("history bound drops oldest edits and new edits clear redo", () => {
  let history = initial(2);
  for (const value of [2, 3, 4]) {
    const result = applyMediaEditorAction(history, {
      type: "set-zoom",
      value,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      history = result.value;
    }
  }
  assert.equal(history.past.length, 2);
  assert.equal(undoMediaEditor(history).present.transform.zoom, 3);

  const undone = undoMediaEditor(history);
  const changed = applyMediaEditorAction(undone, {
    type: "set-name",
    value: "changed",
  });
  assert.equal(changed.ok, true);
  if (changed.ok) {
    assert.equal(changed.value.future.length, 0);
  }
});

test("stored redaction regions do not retain caller object identity", () => {
  const start = initial();
  const region = {
    id: "face",
    mode: "blur" as const,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.2,
  };
  const result = applyMediaEditorAction(start, {
    type: "add-region",
    region,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  region.x = 0.7;
  assert.equal(result.value.present.regions[0]?.x, 0.1);
});

test("no-op edits do not consume undo history", () => {
  const start = initial();
  for (const action of [
    { type: "set-zoom", value: 1 },
    { type: "nudge-pan", dx: 0, dy: 0 },
  ] as const) {
    const result = applyMediaEditorAction(start, action);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value, start);
      assert.equal(result.value.past.length, 0);
    }
  }
});

test("history bounds must be explicit positive safe integers", () => {
  assert.deepEqual(createMediaEditorHistory("sun", "desc", 0), {
    ok: false,
    code: "invalid-history-limit",
  });
});
