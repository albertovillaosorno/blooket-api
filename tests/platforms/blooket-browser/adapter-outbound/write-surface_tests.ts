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
//   - Tests for fail-closed text-only Create Set browser-surface composition.
// - Must-Not:
//   - Invoke a browser, upload media, or exercise unverified Add Question.
// - Allows:
//   - Inputs: Synthetic submissions and deterministic browser-host outcomes.
//   - Outputs: Exact call ordering, stops, confirmation, and failure
//     assertions.
//   - Side effects: In-memory call recording only.
// - Split-When:
//   - Add Question gains independently verified browser mechanics.
// - Merge-When:
//   - Browser write-surface composition is removed.
// - Summary:
//   - Proves one submit and separate confirmation are required for success.
// - Description:
//   - Unsupported media and question writes stop before host mutation calls.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Exceptions and unimplemented operations fail closed.
//
import assert from "node:assert/strict";
import test from "node:test";

import type { BlooketCreateSetSubmission } from
  "../../../../src/ir/blooket-write-submissions/contract/write-submission.ts";
import {
  createBlooketBrowserWriteSurface,
  type BlooketCreateSetBrowserHost,
} from
  "../../../../src/platforms/blooket-browser/adapter-outbound/write-surface.ts";

const submission: BlooketCreateSetSubmission = {
  schemaVersion: 1,
  kind: "create-set",
  title: "Synthetic set",
  description: "Synthetic description",
  private: true,
  coverImage: null,
};

function host(
  calls: string[],
  overrides: Partial<BlooketCreateSetBrowserHost> = {},
): BlooketCreateSetBrowserHost {
  return {
    openCreateSet: async () => {
      calls.push("open");
      return { ok: true };
    },
    prepareCreateSet: async (input) => {
      calls.push("prepare:" + JSON.stringify(input));
      return { ok: true };
    },
    submitCreateSet: async () => {
      calls.push("submit");
      return { ok: true };
    },
    observeCreateSet: async expected => {
      calls.push("observe:" + JSON.stringify(expected));
      return { ok: true, remoteSetId: "remote-set-1" };
    },
    ...overrides,
  };
}

test(
  "text Create Set requires one submit then separate observation",
  async () => {
  const calls: string[] = [];
  const surface = createBlooketBrowserWriteSurface(host(calls));
  assert.deepEqual(await surface.createSet(submission, []), {
    ok: true,
    remoteSetId: "remote-set-1",
  });
  assert.deepEqual(calls, [
    "open",
    'prepare:{"title":"Synthetic set",' +
      '"description":"Synthetic description","private":true}',
    "submit",
    'observe:{"title":"Synthetic set",' +
      '"description":"Synthetic description"}',
  ]);
  },
);

test(
  "navigation stops pass through and prevent later mutation steps",
  async () => {
  for (const [stage, expectedCalls] of [
    ["open", ["open"]],
    ["prepare", ["open", "prepare"]],
    ["submit", ["open", "prepare", "submit"]],
    ["observe", ["open", "prepare", "submit", "observe"]],
  ] as const) {
    const calls: string[] = [];
    const stop = {
      ok: false as const,
      kind: "navigation" as const,
      state: "security-challenge" as const,
    };
    const overrides: Partial<BlooketCreateSetBrowserHost> = {};
    if (stage === "open")
      overrides.openCreateSet = async () => {
        calls.push("open");
        return stop;
      };
    if (stage === "prepare")
      overrides.prepareCreateSet = async () => {
        calls.push("prepare");
        return stop;
      };
    if (stage === "submit")
      overrides.submitCreateSet = async () => {
        calls.push("submit");
        return stop;
      };
    if (stage === "observe")
      overrides.observeCreateSet = async () => {
        calls.push("observe");
        return stop;
      };

    const surface = createBlooketBrowserWriteSurface(host(calls, overrides));
    assert.deepEqual(await surface.createSet(submission, []), stop);
    assert.deepEqual(
      calls.map((value) => value.startsWith("prepare") ? "prepare" : value),
      expectedCalls,
    );
  }
  },
);

test(
  "media-backed Create Set and Add Question fail before host calls",
  async () => {
  const calls: string[] = [];
  const surface = createBlooketBrowserWriteSurface(host(calls));
  assert.deepEqual(
    await surface.createSet(
      { ...submission, coverImage: { mediaId: "cover" } },
      [{
        mediaId: "cover",
        revision: 1,
        format: "png",
        bytes: new Uint8Array([1]),
      }],
    ),
    {
      ok: false,
      kind: "browser",
      code: "blooket-browser-failed",
    },
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(
    await surface.addQuestion({
      schemaVersion: 1,
      kind: "add-question",
      remoteSetId: "set",
      number: 1,
      question: "Type sun.",
      answers: [{ kind: "text", text: "sun", correct: true }],
      image: null,
      audio: "",
      qType: "typing",
      random: true,
      answerTypes: ["exactly"],
      timeLimit: 15,
    }, []),
    {
      ok: false,
      kind: "browser",
      code: "blooket-browser-failed",
    },
  );
  assert.deepEqual(calls, []);
  },
);

test("host exceptions never become observed success", async () => {
  const calls: string[] = [];
  const surface = createBlooketBrowserWriteSurface(host(calls, {
    submitCreateSet: async () => {
      calls.push("submit");
      throw new Error("synthetic-host-failure");
    },
  }));
  assert.deepEqual(await surface.createSet(submission, []), {
    ok: false,
    kind: "browser",
    code: "blooket-browser-failed",
  });
  assert.deepEqual(
    calls.map((value) => value.startsWith("prepare") ? "prepare" : value),
    ["open", "prepare", "submit"],
  );
});

test("Create Set confirmation checks exact submitted metadata", async () => {
  const calls: string[] = [];
  const surface = createBlooketBrowserWriteSurface(host(calls, {
    observeCreateSet: async expected => {
      calls.push("observe-confirmation");
      return expected.title === submission.title &&
          expected.description === submission.description
        ? { ok: true, remoteSetId: "remote-set-1" }
        : { ok: false, kind: "browser",
          code: "blooket-browser-failed" };
    },
  }));
  const result = await surface.createSet({
    ...submission, description: "Changed by this submission",
  }, []);
  assert.deepEqual(result, { ok: false, kind: "browser",
    code: "blooket-browser-failed" });
  assert.deepEqual(calls.filter(item => item === "observe-confirmation"),
    ["observe-confirmation"]);
});

test("malformed host acknowledgements cannot authorize the next form step",
  async () => {
  const invalidReplies: unknown[] = [
    { ok: "true" },
    { ok: true, trace: "untrusted" },
    { ok: false, kind: "navigation", state: "dashboard" },
    { ok: false, kind: "navigation", state: "security-challenge",
      trace: "untrusted" },
    { ok: false, kind: "browser", code: "unknown-provider-status" },
    null,
  ];
  for (const stage of ["open", "prepare", "submit"] as const) {
    for (const reply of invalidReplies) {
      const calls: string[] = [];
      const overrides: Partial<BlooketCreateSetBrowserHost> = {};
      if (stage === "open") overrides.openCreateSet = async () => {
        calls.push("open");
        return reply as Awaited<ReturnType<
          BlooketCreateSetBrowserHost["openCreateSet"]>>;
      };
      if (stage === "prepare") overrides.prepareCreateSet = async () => {
        calls.push("prepare");
        return reply as Awaited<ReturnType<
          BlooketCreateSetBrowserHost["prepareCreateSet"]>>;
      };
      if (stage === "submit") overrides.submitCreateSet = async () => {
        calls.push("submit");
        return reply as Awaited<ReturnType<
          BlooketCreateSetBrowserHost["submitCreateSet"]>>;
      };
      const result = await createBlooketBrowserWriteSurface(
        host(calls, overrides),
      ).createSet(submission, []);
      assert.deepEqual(result, { ok: false, kind: "browser",
        code: "blooket-browser-failed" });
      assert.deepEqual(calls.map(item => item.startsWith("prepare:")
        ? "prepare" : item), stage === "open" ? ["open"]
          : stage === "prepare" ? ["open", "prepare"]
            : ["open", "prepare", "submit"]);
    }
  }
  },
);

test("malformed Create Set observations never establish a remote set ID",
  async () => {
  for (const reply of [
    { ok: true, remoteSetId: "remote-1", extra: "untrusted" },
    { ok: "true", remoteSetId: "remote-1" },
    { ok: true, remoteSetId: "" },
    { ok: true },
    { ok: false, kind: "navigation", state: "dashboard" },
    null,
  ]) {
    const calls: string[] = [];
    const surface = createBlooketBrowserWriteSurface(host(calls, {
      observeCreateSet: async () => reply as Awaited<ReturnType<
        BlooketCreateSetBrowserHost["observeCreateSet"]>>,
    }));
    assert.deepEqual(await surface.createSet(submission, []), {
      ok: false, kind: "browser", code: "blooket-browser-failed",
    });
    assert.ok(calls.includes("submit"));
  }
  },
);
