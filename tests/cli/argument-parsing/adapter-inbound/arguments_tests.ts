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
//   - Behavioral tests for the initial blooket CLI argument grammar.
// - Must-Not:
//   - Read files or execute API commands.
// - Allows:
//   - Inputs: Fixed process argument arrays.
//   - Outputs: Deterministic typed invocation verdicts.
//   - Side effects: None.
// - Split-When:
//   - Command families need independent parser fixture suites.
// - Merge-When:
//   - The CLI argument grammar is removed.
// - Summary:
//   - Verifies media search and project validation argument parsing.
// - Description:
//   - Mirrors src/cli/argument-parsing/adapter-inbound/arguments.ts.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Empty invocation renders help.
//
import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArguments } from
  "../../../../src/cli/argument-parsing/adapter-inbound/arguments.ts";

test("empty CLI arguments request help", () => {
  assert.deepEqual(parseCliArguments([]), {
    ok: true,
    invocation: { kind: "help" },
  });
});

test("media search accepts repeatable fields and machine output", () => {
  const result = parseCliArguments([
    "media",
    "search",
    "school bus",
    "--media",
    "lesson/media.jsonl",
    "--field",
    "description",
    "--field",
    "id",
    "--limit",
    "12",
    "--json",
  ]);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.invocation, {
      kind: "media-search",
      mediaPath: "lesson/media.jsonl",
      query: "school bus",
      fields: ["description", "id"],
      limit: 12,
      json: true,
    });
  }
});

test("media search accepts the display-name field", () => {
  const result = parseCliArguments([
    "media",
    "search",
    "bright sun",
    "--field",
    "name",
  ]);

  assert.deepEqual(result, {
    ok: true,
    invocation: {
      kind: "media-search",
      mediaPath: "media.jsonl",
      query: "bright sun",
      fields: ["name"],
      json: false,
    },
  });
});

test("project validation accepts an explicit media index path", () => {
  const result = parseCliArguments([
    "project",
    "validate",
    "lesson/project.json",
    "--media",
    "other/media.jsonl",
    "--json",
  ]);

  assert.equal(result.ok, true);
});

test("unknown options fail before any file access", () => {
  const result = parseCliArguments(["media", "search", "sun", "--surprise"]);

  assert.equal(result.ok, false);
});

test("read arguments preserve opaque IDs and reject extra authority", () => {
  for (const args of [
    ["session", "inspect", "--json"],
    ["sets", "list"],
    ["sets", "get", "opaque ID", "--json"],
  ])
    assert.equal(parseCliArguments(args).ok, true);
  for (const args of [
    ["sets", "get"],
    ["sets", "get", "a", "b"],
    ["sets", "list", "--token", "secret"],
    ["session", "inspect", "--json", "--json"],
  ])
    assert.equal(parseCliArguments(args).ok, false);
});
