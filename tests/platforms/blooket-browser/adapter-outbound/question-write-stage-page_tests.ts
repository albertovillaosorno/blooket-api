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
//   - Synthetic isolated-world Add Question stage diagnostic tests.
// - Must-Not:
//   - Contact Blooket, submit, mutate controls or emit private content.
// - Allows:
//   - Inputs: Owned watch state, replaced documents and malformed properties.
//   - Outputs: Exact read-only stage names with no account values.
//   - Side effects: Scoped test globals restored after each check.
// - Split-When:
//   - Another independent write owner needs its own stage fixture.
// - Merge-When:
//   - A provider-independent staged write diagnostic replaces the function.
// - Summary:
//   - Proves that browser readiness/submit stages never authorize replay.
// - Description:
//   - Testing an inaccessible watch must not invoke user-defined getters.
// - Usage:
//   - Run as part of provider drift and repository test suites.
// - Defaults:
//   - Missing state is inconclusive rather than a safe write assertion.
//
import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectBlooketQuestionWriteStage,
  inspectBlooketSubmittedQuestionOwner,
  inspectBlooketPostSubmitRateLimit,
} from
// jig-ignore-next-line: TypeScript module specifier is indivisible.
  "../../../../src/platforms/blooket-browser/adapter-outbound/question-write-stage-page.ts";

const key = "__blooketAddQuestionFormWatch";

function withWatch(
  watch: Record<string, unknown> | undefined,
  check: (document: object) => void,
): void {
  const originalWatch = Object.getOwnPropertyDescriptor(globalThis, key);
  const originalDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = {};
  Object.defineProperty(globalThis, "document", {
    configurable: true, value: document,
  });
  if (watch) {
    watch["document"] ??= document;
    Object.defineProperty(globalThis, key, {
      configurable: true, enumerable: true, writable: true,
      value: watch,
    });
  } else Reflect.deleteProperty(globalThis, key);
  try { check(document); }
  finally {
    for (const [name, descriptor] of [
      ["document", originalDoc], [key, originalWatch],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

function opened(): Record<string, unknown> {
  return { dirty: false, submitted: false, prepared: false,
    finalized: false };
}

function bound() {
  return { ...opened(), form: { isConnected: true },
    question: { isConnected: true }, controlsStarted: false,
    controlsPrepared: false };
}

test("the injected read-only stage probe is self-contained", () => {
  const injected = Function("return (" +
    inspectBlooketQuestionWriteStage.toString() + ")")() as
      typeof inspectBlooketQuestionWriteStage;
  withWatch(opened(), () => {
    assert.deepEqual(injected(), inspectBlooketQuestionWriteStage());
    assert.equal(injected().stage, "opening");
  });
});

test("stages distinguish each safe owner transition", () => {
  const watch = bound();
  withWatch(watch, () => {
    const stage = () => inspectBlooketQuestionWriteStage().stage;
    assert.equal(stage(), "awaiting-controls");
    watch["controlsStarted"] = true;
    assert.equal(stage(), "awaiting-controls");
    watch["controlsPrepared"] = true;
    assert.equal(stage(), "controls-prepared");
    watch["prepared"] = true;
    assert.equal(stage(), "awaiting-finalization");
    watch["finalized"] = true;
    assert.equal(stage(), "ready-for-save");
    watch["submitted"] = true;
    assert.equal(stage(), "submit-attempted");
  });
});

test("submitted latch survives provider unmounting its form", () => {
  const watch = bound();
  withWatch(watch, () => {
    watch["submitted"] = true;
    (watch["form"] as { isConnected: boolean }).isConnected = false;
    assert.equal(inspectBlooketQuestionWriteStage().stage,
      "submit-attempted");
  });
});

test("missing and replaced owner states do not invent readiness", () => {
  withWatch(undefined, () => {
    assert.equal(inspectBlooketQuestionWriteStage().stage, "no-owner");
  });
  withWatch({ ...bound(), document: {} }, () => {
    assert.equal(inspectBlooketQuestionWriteStage().stage,
      "replaced-document");
  });
  withWatch(bound(), () => {
    const watch = (globalThis as unknown as Record<string, unknown>)[key] as
      Record<string, unknown>;
    (watch["question"] as { isConnected: boolean }).isConnected = false;
    assert.equal(inspectBlooketQuestionWriteStage().stage, "detached-form");
  });
});

test("post-submit human edits block detached read ownership", () => {
  const watch = { ...bound(), submitted: true, dirty: true,
    setId: "set-fixture" };
  withWatch(watch, () => {
    assert.equal(inspectBlooketQuestionWriteStage().stage,
      "post-submit-interrupted");
  });
});

test("human interrupts are diagnostic stops, not permission to replay", () => {
  const watch = bound();
  watch["dirty"] = true;
  withWatch(watch, () => {
    assert.equal(inspectBlooketQuestionWriteStage().stage, "interrupted");
  });
});

test("watch accessors are never evaluated or exposed", () => {
  withWatch(bound(), () => {
    const watch = (globalThis as unknown as Record<string, unknown>)[key] as
      Record<string, unknown>;
    let called = false;
    Object.defineProperty(watch, "prepared", {
      enumerable: true, configurable: true,
      get() { called = true; throw Error("private provider data"); },
    });
    const report = inspectBlooketQuestionWriteStage();
    assert.equal(report.stage, "unavailable");
    assert.equal(called, false);
    assert.equal(JSON.stringify(report).includes("private"), false);
  });
});

test("unknown watch fields cannot smuggle account content in stage output",
  () => {
  const watch = { ...bound(), setId: "synthetic-secret-set-id",
    answer: "synthetic-secret-answer" };
  withWatch(watch, () => {
    const report = inspectBlooketQuestionWriteStage();
    assert.deepEqual(Object.keys(report), ["kind", "stage"]);
    assert.equal(JSON.stringify(report).includes("synthetic-secret"), false);
  });
});

test("submitted owner checks exact set binding without leaking the ID", () => {
  const probe = Function("return (" +
    inspectBlooketSubmittedQuestionOwner.toString() + ")")() as
      typeof inspectBlooketSubmittedQuestionOwner;
  const route = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL("https://dashboard.blooket.com/edit?id=set-fixture"),
  });
  try {
    const watch = { ...bound(), setId: "set-fixture", submitted: true,
      prepared: true, finalized: true, submitStartMs: performance.now() };
    withWatch(watch, () => {
      assert.equal(probe("set-fixture"), true);
      delete (watch as { submitStartMs?: number }).submitStartMs;
      assert.equal(probe("set-fixture"), false,
        "a forged submit latch without its timestamp cannot own a read");
      watch.submitStartMs = Number.NaN;
      assert.equal(probe("set-fixture"), false);
      watch.submitStartMs = Number.POSITIVE_INFINITY;
      assert.equal(probe("set-fixture"), false);
      watch.submitStartMs = -1;
      assert.equal(probe("set-fixture"), false);
      watch.submitStartMs = performance.now() + 10_000;
      assert.equal(probe("set-fixture"), false);
      watch.submitStartMs = performance.now();
      watch.prepared = false;
      assert.equal(probe("set-fixture"), false);
      watch.prepared = true;
      watch.finalized = false;
      assert.equal(probe("set-fixture"), false);
      watch.finalized = true;
      assert.equal(probe("set-fixture"), true);
      let accessCount = 0;
      Object.defineProperty(watch, "submitStartMs", {
        configurable: true, enumerable: true,
        get() { accessCount++; throw Error("private state"); },
      });
      assert.equal(probe("set-fixture"), false);
      assert.equal(accessCount, 0);
      Object.defineProperty(watch, "submitStartMs", {
        configurable: true, enumerable: true, writable: true,
        value: performance.now(),
      });
      assert.equal(probe("another-set"), false);
      watch.setId = "other-set";
      assert.equal(probe("set-fixture"), false);
      watch.setId = "set-fixture";
      watch.submitted = false;
      assert.equal(probe("set-fixture"), false);
      watch.submitted = true;
      watch.dirty = true;
      assert.equal(probe("set-fixture"), false);
    });
  } finally {
    if (route) Object.defineProperty(globalThis, "location", route);
    else Reflect.deleteProperty(globalThis, "location");
  }
});


test("a post-submit 429 requires exact owner, route and request timing", () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis,
    "location");
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis,
    "performance");
  const address = "https://dashboard.blooket.com/edit?id=set-fixture";
  const entries: { entryType: string; initiatorType: string;
    responseStatus: number; startTime: number; name: string }[] = [];
  Object.defineProperty(globalThis, "location", { configurable: true,
    value: new URL(address) });
  Object.defineProperty(globalThis, "performance", { configurable: true,
    value: { now: () => 10_000,
      getEntriesByType: () => entries } });
  try {
    const watch = { ...bound(), submitted: true, dirty: false,
      setId: "set-fixture", submitStartMs: 8_000 };
    withWatch(watch, () => {
      const probe = Function("return (" +
        inspectBlooketPostSubmitRateLimit.toString() + ")")() as
          typeof inspectBlooketPostSubmitRateLimit;
      assert.equal(probe("set-fixture"), false);
      entries.push({ entryType: "resource", initiatorType: "fetch",
        responseStatus: 429, startTime: 2_000, name: address });
      assert.equal(probe("set-fixture"), false,
        "an earlier 429 cannot be attributed to the Save click");
      entries.push({ entryType: "resource", initiatorType: "fetch",
        responseStatus: 429, startTime: 8_200,
        name: "https://dashboard.blooket.com/edit?id=another-set" });
      assert.equal(probe("set-fixture"), false);
      entries.push({ entryType: "resource", initiatorType: "img",
        responseStatus: 429, startTime: 8_400, name: address });
      assert.equal(probe("set-fixture"), false);
      entries.push({ entryType: "resource", initiatorType: "fetch",
        responseStatus: 429, startTime: Number.NaN, name: address });
      assert.equal(probe("set-fixture"), false,
        "invalid timing evidence cannot diagnose a provider throttle");
      entries[entries.length - 1]!.startTime = 10_001;
      assert.equal(probe("set-fixture"), false,
        "future timing evidence cannot predate this observation");
      entries[entries.length - 1]!.startTime = 8_600;
      assert.equal(probe("set-fixture"), true);
      assert.equal(probe("another-set"), false);
      watch.setId = "different-set";
      assert.equal(probe("set-fixture"), false);
      watch.setId = "set-fixture";
      watch.dirty = true;
      assert.equal(probe("set-fixture"), false);
      watch.dirty = false;
      watch.submitted = false;
      assert.equal(probe("set-fixture"), false);
    });
  } finally {
    for (const [name, descriptor] of [
      ["location", originalLocation],
      ["performance", originalPerformance],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
