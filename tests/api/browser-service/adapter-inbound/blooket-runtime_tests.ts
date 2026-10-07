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
//   - Regression coverage for browser-service Blooket port composition.
// - Must-Not:
//   - Contact Blooket, read a real library, or register publication commands.
// - Allows:
//   - Inputs: Synthetic bridge transport and temporary user root.
//   - Outputs: Exact bridge write execution and read-port assertions.
//   - Side effects: None unless a composed port is explicitly invoked.
// - Split-When:
//   - Publication composition gains a separate service boundary.
// - Merge-When:
//   - Blooket runtime composition is removed.
// - Summary:
//   - Proves browser writes pass through the canonical execution adapter.
// - Description:
//   - No test invokes persisted publication or remote browser mutation.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Add Question remains unsupported by the current bridge surface.
//
import assert from "node:assert/strict";
import test from "node:test";

import { createBlooketRuntimePorts } from
  "../../../../src/api/browser-service/adapter-inbound/blooket-runtime.ts";
import type { BlooketBrowserBridgeCommand } from
  "../../../../src/ir/blooket-browser-bridge/contract/message.ts";
import type { BlooketWriteOperation } from
  "../../../../src/projects/blooket-write-plans/domain/write-plan.ts";

const operation: BlooketWriteOperation = {
  operationId: "plan:runtime:set",
  kind: "set",
  title: "Synthetic set",
  description: "Synthetic description",
  visibility: "private",
  coverMediaId: null,
};

test(
  "runtime composes bridge Create Set through canonical write execution",
  async () => {
  const commands: BlooketBrowserBridgeCommand[] = [];
  const runtime = createBlooketRuntimePorts({
    request: async (command) => {
      commands.push(command);
      if (command.kind === "sets.create") {
        return {
          ok: true,
          value: { ok: true, remoteSetId: "remote-set-1" },
        };
      }
      return { ok: false, code: "blooket-browser-failed" };
    },
  }, "/synthetic-unused-root");

  assert.deepEqual(
    await runtime.writeExecution.execute(
      operation,
      { remoteSetId: null },
      { preparedMedia: [] },
    ),
    {
      ok: true,
      receipt: {
        kind: "set-created",
        remoteSetId: "remote-set-1",
      },
    },
  );
  assert.deepEqual(commands, [{
    kind: "sets.create",
    title: "Synthetic set",
    description: "Synthetic description",
    private: true,
  }]);
  },
);

test(
  "runtime Add Question remains fail-closed without bridge mutation",
  async () => {
  const commands: BlooketBrowserBridgeCommand[] = [];
  const runtime = createBlooketRuntimePorts({
    request: async (command) => {
      commands.push(command);
      return { ok: false, code: "blooket-browser-failed" };
    },
  }, "/synthetic-unused-root");

  const question: BlooketWriteOperation = {
    operationId: "plan:runtime:q:0",
    kind: "question",
    localQuestionId: "q1",
    questionNumber: 1,
    question: {
      type: "typing-answer",
      prompt: "Type sun.",
      timeLimitSeconds: 15,
      imageMediaId: null,
      matchMode: "exact",
      answer: "sun",
    },
  };
  assert.deepEqual(
    await runtime.writeExecution.execute(
      question,
      { remoteSetId: "remote-set-1" },
      { preparedMedia: [] },
    ),
    {
      ok: false,
      kind: "browser",
      code: "blooket-browser-failed",
    },
  );
  assert.deepEqual(commands, []);
  },
);
