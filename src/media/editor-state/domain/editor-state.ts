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
//   - Immutable media-editor state transitions and bounded undo/redo history.
// - Must-Not:
//   - Render pixels, choose UI step sizes, or persist vault files.
// - Allows:
//   - Inputs: Typed editor actions and an explicit positive history bound.
//   - Outputs: Updated editor history or stable invalid-edit failures.
//   - Side effects: None.
// - Split-When:
//   - Pixel rendering or metadata persistence needs an independent lifecycle.
// - Merge-When:
//   - Media editing no longer has a reusable non-UI state model.
// - Summary:
//   - Models pan, zoom, tonal edits, redactions, metadata, and history.
// - Description:
//   - Keeps keyboard/UI policy outside while preserving deterministic edits.
// - Usage:
//   - UI adapters translate gestures and keys into these domain actions.
// - Defaults:
//   - No hidden history bound or keyboard step size is assumed.
//
export interface MediaEditorTransform {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly contrast: number;
  readonly saturation: number;
}

export type RedactionMode = "blur" | "redact";

export interface MediaEditorRegion {
  readonly id: string;
  readonly mode: RedactionMode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MediaEditorState {
  readonly name: string;
  readonly description: string;
  readonly transform: MediaEditorTransform;
  readonly regions: readonly MediaEditorRegion[];
}

export interface MediaEditorHistory {
  readonly limit: number;
  readonly past: readonly MediaEditorState[];
  readonly present: MediaEditorState;
  readonly future: readonly MediaEditorState[];
}

export type MediaEditorAction =
  | { readonly type: "set-pan"; readonly x: number; readonly y: number }
  | { readonly type: "nudge-pan"; readonly dx: number; readonly dy: number }
  | { readonly type: "set-zoom"; readonly value: number }
  | { readonly type: "set-contrast"; readonly value: number }
  | { readonly type: "set-saturation"; readonly value: number }
  | { readonly type: "set-name"; readonly value: string }
  | { readonly type: "set-description"; readonly value: string }
  | { readonly type: "add-region"; readonly region: MediaEditorRegion }
  | { readonly type: "remove-region"; readonly id: string };

export type MediaEditorResult =
  | { readonly ok: true; readonly value: MediaEditorHistory }
  | {
      readonly ok: false;
      readonly code:
        | "invalid-history-limit"
        | "invalid-editor-action"
        | "duplicate-region-id"
        | "missing-region-id";
    };

export function createMediaEditorHistory(
  name: string,
  description: string,
  limit: number,
): MediaEditorResult {
  if (!isPositiveSafeInteger(limit)) {
    return { ok: false, code: "invalid-history-limit" };
  }

  return {
    ok: true,
    value: {
      limit,
      past: [],
      present: {
        name,
        description,
        transform: {
          panX: 0,
          panY: 0,
          zoom: 1,
          contrast: 1,
          saturation: 1,
        },
        regions: [],
      },
      future: [],
    },
  };
}

export function applyMediaEditorAction(
  history: MediaEditorHistory,
  action: MediaEditorAction,
): MediaEditorResult {
  if (!isPositiveSafeInteger(history.limit)) {
    return { ok: false, code: "invalid-history-limit" };
  }

  const edited = editState(history.present, action);
  if (!edited.ok) {
    return edited;
  }
  if (edited.value === history.present) {
    return { ok: true, value: history };
  }

  return {
    ok: true,
    value: {
      limit: history.limit,
      past: [...history.past, history.present].slice(-history.limit),
      present: edited.value,
      future: [],
    },
  };
}

export function undoMediaEditor(
  history: MediaEditorHistory,
): MediaEditorHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    limit: history.limit,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoMediaEditor(
  history: MediaEditorHistory,
): MediaEditorHistory {
  const next = history.future[0];
  if (next === undefined) {
    return history;
  }
  return {
    limit: history.limit,
    past: [...history.past, history.present].slice(-history.limit),
    present: next,
    future: history.future.slice(1),
  };
}

function editState(
  state: MediaEditorState,
  action: MediaEditorAction,
): { readonly ok: true; readonly value: MediaEditorState }
  | {
      readonly ok: false;
      readonly code:
        | "invalid-editor-action"
        | "duplicate-region-id"
        | "missing-region-id";
    } {
  switch (action.type) {
    case "set-pan":
      if (!finite(action.x) || !finite(action.y)) {
        return invalidAction();
      }
      if (
        state.transform.panX === action.x
        && state.transform.panY === action.y
      ) {
        return { ok: true, value: state };
      }
      return transform(state, { panX: action.x, panY: action.y });
    case "nudge-pan": {
      if (!finite(action.dx) || !finite(action.dy)) {
        return invalidAction();
      }
      const panX = state.transform.panX + action.dx;
      const panY = state.transform.panY + action.dy;
      if (!finite(panX) || !finite(panY)) {
        return invalidAction();
      }
      return transform(state, { panX, panY });
    }
    case "set-zoom":
      if (!positiveFinite(action.value)) {
        return invalidAction();
      }
      if (state.transform.zoom === action.value) {
        return { ok: true, value: state };
      }
      return transform(state, { zoom: action.value });
    case "set-contrast":
      if (!nonNegativeFinite(action.value)) {
        return invalidAction();
      }
      if (state.transform.contrast === action.value) {
        return { ok: true, value: state };
      }
      return transform(state, { contrast: action.value });
    case "set-saturation":
      if (!nonNegativeFinite(action.value)) {
        return invalidAction();
      }
      if (state.transform.saturation === action.value) {
        return { ok: true, value: state };
      }
      return transform(state, { saturation: action.value });
    case "set-name":
      if (state.name === action.value) {
        return { ok: true, value: state };
      }
      return {
        ok: true,
        value: { ...state, name: action.value },
      };
    case "set-description":
      if (state.description === action.value) {
        return { ok: true, value: state };
      }
      return {
        ok: true,
        value: { ...state, description: action.value },
      };
    case "add-region":
      if (!validRegion(action.region)) {
        return invalidAction();
      }
      if (state.regions.some((region) => region.id === action.region.id)) {
        return { ok: false, code: "duplicate-region-id" };
      }
      return {
        ok: true,
        value: {
          ...state,
          regions: [...state.regions, action.region],
        },
      };
    case "remove-region": {
      const index = state.regions.findIndex(
        (region) => region.id === action.id,
      );
      if (index < 0) {
        return { ok: false, code: "missing-region-id" };
      }
      return {
        ok: true,
        value: {
          ...state,
          regions: state.regions.filter((_, candidate) => candidate !== index),
        },
      };
    }
  }
}

function transform(
  state: MediaEditorState,
  changes: Partial<MediaEditorTransform>,
): { readonly ok: true; readonly value: MediaEditorState } {
  const next = {
    ...state.transform,
    ...changes,
  };
  if (!finite(next.panX) || !finite(next.panY)) {
    return { ok: true, value: state };
  }
  return {
    ok: true,
    value: {
      ...state,
      transform: next,
    },
  };
}

function validRegion(region: MediaEditorRegion): boolean {
  return region.id.length > 0
    && (region.mode === "blur" || region.mode === "redact")
    && unit(region.x)
    && unit(region.y)
    && positiveUnit(region.width)
    && positiveUnit(region.height)
    && region.x + region.width <= 1
    && region.y + region.height <= 1;
}

function unit(value: number): boolean {
  return finite(value) && value >= 0 && value <= 1;
}

function positiveUnit(value: number): boolean {
  return finite(value) && value > 0 && value <= 1;
}

function positiveFinite(value: number): boolean {
  return finite(value) && value > 0;
}

function nonNegativeFinite(value: number): boolean {
  return finite(value) && value >= 0;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function invalidAction(): {
  readonly ok: false;
  readonly code: "invalid-editor-action";
} {
  return { ok: false, code: "invalid-editor-action" };
}
