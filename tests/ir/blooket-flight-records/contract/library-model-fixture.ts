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
//   - Synthetic fixtures for the observed library model identity contract.
// - Must-Not:
//   - Perform network requests or treat a decoded candidate as write success.
// - Allows:
//   - Inputs: Synthetic Flight rows and action redirect headers.
//   - Outputs: Fictional model envelopes for mirrored regression tests.
//   - Side effects: None.
// - Split-When:
//   - Another Flight protocol version needs independent fixtures.
// - Merge-When:
//   - Candidate Flight decoding is removed.
// - Summary:
//   - Keeps provider-shaped fixture data fictional and independent of captures.
// - Description:
//   - Fixtures contain no account or lesson data.
// - Usage:
//   - Run with the repository Node test suite.
// - Defaults:
//   - Unsupported tags and reference kinds fail closed.
//
export function libraryModelFixture(options: {
  readonly props?: Readonly<Record<string, unknown>>;
  readonly set?: Readonly<Record<string, unknown>>;
  readonly module?: unknown;
  readonly extra?: string;
} = {}): string {
  const set = {
    _id: "set-fixture", author: "fictional-author", coverImage: null,
    date: "2026-10-10", favoriteCount: 0, numQuestions: 1, playCount: 0,
    plusOnly: false, private: true, title: "Synthetic", verified: false,
    ...options.set,
  };
  const props = {
    allSets: ["$a"], sets: [set], type: "LIBRARY", folders: [],
    filter: "$undefined", query: "$undefined", setsFolder: "$undefined",
    hasFolderOrSearch: false, hasPlus: false, isStudent: false,
    isMerging: false, numSets: 0, numQuestions: 0, ...options.props,
  };
  const module = options.module ?? [52644, [
    "1958", "static/chunks/1958-3beff819112074ac.js",
  ], "default"];
  return "0:" + JSON.stringify(["$", "$L1", null, props]) +
    "\n1:I" + JSON.stringify(module) +
    '\n:HL["/fictional.css","style"]\na:' + JSON.stringify(set) +
    "\n" + (options.extra ?? "");
}
