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
//   - Transport parity tests for the canonical CLI runner.
// - Must-Not:
//   - Spawn subprocesses or depend on the host filesystem.
// - Allows:
//   - Inputs: In-memory files, deterministic IDs, and CLI argument arrays.
//   - Outputs: Deterministic exit codes and canonical JSON result envelopes.
//   - Side effects: Writes only to in-memory output collectors.
// - Split-When:
//   - Human rendering and machine rendering need independent fixture suites.
// - Merge-When:
//   - The CLI ceases to lower into the canonical API executor.
// - Summary:
//   - Proves CLI JSON mode preserves direct API semantics.
// - Description:
//   - Uses the real executor and only replaces transport-owned file access.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Project validation resolves media.jsonl beside project.json.
//
import assert from "node:assert/strict";
import test from "node:test";

import { executeCommand } from
  "../../../../src/api/command-execution/application/execute-command.ts";
import { runCli } from
  "../../../../src/cli/command-running/adapter-inbound/run-cli.ts";

const mediaJsonl = [
  {
    id: "sun",
    path: "media/sun.avif",
    description: "A bright yellow sun in a clear blue sky.",
    english: true,
  },
  {
    id: "horse",
    path: "media/horse.webp",
    description: "A brown horse standing in a grassy field.",
    english: true,
  },
].map((record) => JSON.stringify(record)).join("\n") + "\n";

const projectJson = JSON.stringify({
  schemaVersion: 1,
  title: "Vocabulary",
  description: "Vocabulary review.",
  quizLanguage: "English",
  visibility: "private",
  mediaIndex: "media.jsonl",
  coverImage: { description: "A sun.", mediaId: "sun" },
  questions: [],
});

test("media search JSON mode matches direct command execution", async () => {
  const operationId = "cli:test-media-search";
  const direct = await executeCommand({
    version: 1,
    operationId,
    command: "media.search",
    payload: {
      mediaJsonl,
      query: "yellow sun",
      fields: ["description"],
    },
  });
  const output = createOutput();
  const exitCode = await runCli(
    [
      "media",
      "search",
      "yellow sun",
      "--field",
      "description",
      "--json",
    ],
    {
      readText: async (path) => {
        assert.equal(path, "media.jsonl");
        return mediaJsonl;
      },
      operationId: () => operationId,
      stdout: output.stdout,
      stderr: output.stderr,
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(output.stderrText(), "");
  assert.deepEqual(JSON.parse(output.stdoutText()), direct);
});

test(
  "project validation uses sibling media.jsonl and matches API",
  async () => {
  const operationId = "cli:test-project-validate";
  const direct = await executeCommand({
    version: 1,
    operationId,
    command: "project.validate",
    payload: { projectJson, mediaJsonl },
  });
  const output = createOutput();
  const reads: string[] = [];
  const files = new Map([
    ["lessons/spanish/project.json", projectJson],
    ["lessons/spanish/media.jsonl", mediaJsonl],
  ]);
  const exitCode = await runCli(
    ["project", "validate", "lessons/spanish/project.json", "--json"],
    {
      readText: async (path) => {
        reads.push(path);
        const value = files.get(path);
        if (value === undefined) {
          throw new Error("missing test fixture");
        }
        return value;
      },
      operationId: () => operationId,
      stdout: output.stdout,
      stderr: output.stderr,
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(reads.sort(), [
    "lessons/spanish/media.jsonl",
    "lessons/spanish/project.json",
  ]);
    assert.deepEqual(JSON.parse(output.stdoutText()), direct);
  },
);

test(
  "file failures return a stable envelope without leaking details",
  async () => {
  const output = createOutput();
  const exitCode = await runCli(
    ["media", "search", "sun", "--json"],
    {
      readText: async () => {
        throw new Error("/Users/teacher/private/media.jsonl EACCES secret");
      },
      operationId: () => "cli:file-failure",
      stdout: output.stdout,
      stderr: output.stderr,
    },
  );

  assert.equal(exitCode, 3);
  assert.equal(output.stderrText(), "");
  const result = JSON.parse(output.stdoutText()) as {
    issues: readonly { code: string; message: string }[];
  };
  assert.equal(result.issues[0]?.code, "file-read-failed");
  assert.equal(output.stdoutText().includes("/Users/teacher"), false);
    assert.equal(output.stdoutText().includes("secret"), false);
  },
);

test(
  "executor exceptions do not expose internal exception text",
  async () => {
  const output = createOutput();
  const exitCode = await runCli(
    ["media", "search", "sun", "--json"],
    {
      readText: async () => mediaJsonl,
      operationId: () => "cli:executor-failure",
      stdout: output.stdout,
      stderr: output.stderr,
      execute: async () => {
        throw new Error("authorization=Bearer secret-token");
      },
    },
  );

  assert.equal(exitCode, 3);
  assert.equal(output.stderrText(), "");
  assert.equal(output.stdoutText().includes("secret-token"), false);
    assert.match(output.stdoutText(), /"code":"internal-error"/u);
  },
);

function createOutput(): {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly stdoutText: () => string;
  readonly stderrText: () => string;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
  };
}
