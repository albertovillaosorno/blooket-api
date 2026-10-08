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
//   - Synthetic host coverage for non-mutating capability inspection.
// - Must-Not:
//   - Contact Blooket, create sets, submit questions, or retain account data.
// - Allows:
//   - Inputs: Synthetic tab navigation and capability page replies.
//   - Outputs: Snapshot, cleanup, empty-account, and failure assertions.
//   - Side effects: In-memory navigation and script-call bookkeeping only.
// - Split-When:
//   - Capability host families require independent browser lifecycles.
// - Merge-When:
//   - Capability inspection no longer needs extension orchestration.
// - Summary:
//   - Proves probe cleanup and restoration before any snapshot can succeed.
// - Description:
//   - Empty accounts remain account-dependent and never create probe content.
// - Usage:
//   - Run through the repository Node test command.
// - Defaults:
//   - Any cleanup or malformed page result fails closed.
//
import assert from "node:assert/strict";
import test from "node:test";

import { decodeBlooketCapabilitySnapshot } from
  "../../../../src/ir/capability-snapshots/contract/blooket-capabilities.ts";
import { createExtensionCapabilityInspectionHost } from
// jig-ignore-next-line: Static import path cannot be wrapped safely.
  "../../../../src/service/browser-extension/adapter-inbound/capability-inspection-host.ts";

function fixture(options: {
  readonly media?: "supported" | "unsupported";
  readonly empty?: boolean;
  readonly cleanupFails?: boolean;
  readonly malformedList?: boolean;
  readonly unknownEmpty?: boolean;
  readonly duplicateList?: boolean;
  readonly malformedSetId?: string;
  readonly extraOuterField?: boolean;
  readonly restoreFails?: boolean;
  readonly cleanupPollThrows?: "drawer" | "question";
} = {}) {
  const originalUrl = "https://dashboard.blooket.com/edit?id=original-set";
  let tabUrl = originalUrl;
  let panelOpen = false;
  let drawerOpen = false;
  const scripts: string[] = [];
  const navigations: string[] = [];
  const chrome = {
    tabs: {
      get: async (tabId: number) => {
        assert.equal(tabId, 7);
        return { url: tabUrl, status: "complete" };
      },
      update: async (tabId: number, input: { readonly url: string }) => {
        assert.equal(tabId, 7);
        if (options.restoreFails && input.url === originalUrl)
          throw new Error("synthetic restore failure");
        tabUrl = input.url;
        navigations.push(input.url);
        return { url: tabUrl, status: "complete" };
      },
    },
    scripting: {
      executeScript: async (input: {
        readonly target: { readonly tabId: number };
        readonly func: (...args: never[]) => unknown;
        readonly args?: unknown[];
      }) => {
        assert.equal(input.target.tabId, 7);
        scripts.push(input.func.name);
        const args = input.args ?? [];
        switch (input.func.name) {
          case "inspectBlooketPage": {
            const operation = args[0] as { readonly kind: string };
            if (operation.kind === "session.observe") {
              const pathname = new URL(tabUrl).pathname;
              return [{
                result: {
                  ok: true,
                  value: pathname === "/my-sets" ? "my-sets" : "edit",
                },
              }];
            }
            if (operation.kind === "sets.list") {
              if (options.malformedList)
                return [{
                  result: {
                    ok: true,
                    value: {
                      items: [{ id: 7 }],
                      completeness: "unknown",
                    },
                  },
                }];
              return [{
                result: {
                  ok: true,
                  ...(options.extraOuterField ? { secret: "untrusted" } : {}),
                  value: {
                    items: options.empty || options.unknownEmpty
                      ? []
                      : Array.from(
                          { length: options.duplicateList ? 2 : 1 },
                          () => ({
                            schemaVersion: 1,
                            id: options.malformedSetId ?? "set-fixture",
                            title: "Synthetic fixture",
                          }),
                        ),
                    completeness: options.empty ? "complete" : "unknown",
                  },
                },
              }];
            }
            throw new Error("unexpected-page-operation");
          }
          case "openBlooketCapabilityQuestionPanel":
            assert.equal(args[0], "set-fixture");
            panelOpen = true;
            return [{ result: true }];
          case "isBlooketCapabilityQuestionPanelReady":
            return [{ result: panelOpen }];
          case "openBlooketAudioCapabilityDrawer":
            assert.equal(panelOpen, true);
            drawerOpen = true;
            return [{ result: true }];
          case "inspectBlooketAudioCapabilityDrawer":
            return [{
              result: {
                ok: true,
                value: options.media ?? "supported",
              },
            }];
          case "isBlooketAudioCapabilityDrawerClosed":
            if (!drawerOpen && options.cleanupPollThrows === "drawer")
              throw new Error("synthetic drawer confirmation unavailable");
            return [{ result: !drawerOpen }];
          case "closeBlooketAudioCapabilityDrawer":
            if (options.cleanupFails) return [{ result: false }];
            drawerOpen = false;
            return [{ result: true }];
          case "isBlooketCapabilityQuestionPanelClosed":
            if (!panelOpen && options.cleanupPollThrows === "question")
              throw new Error("synthetic question confirmation unavailable");
            return [{ result: !panelOpen && !drawerOpen }];
          case "closeBlooketCapabilityQuestionPanel":
            if (drawerOpen || options.cleanupFails) return [{ result: false }];
            panelOpen = false;
            return [{ result: true }];
          default:
            throw new Error("unexpected-script:" + input.func.name);
        }
      },
    },
  };
  return {
    chrome,
    originalUrl,
    scripts,
    navigations,
    currentUrl: () => tabUrl,
  };
}

const noPause = async () => {};

test(
  "existing set resolves shared Plus gate and restores prior page",
  async () => {
  for (const media of ["supported", "unsupported"] as const) {
    const page = fixture({ media });
    const host = createExtensionCapabilityInspectionHost(
      page.chrome,
      7,
      noPause,
    );
    const result = await host.inspect();
    assert.equal(result.ok, true);
    assert.equal(page.currentUrl(), page.originalUrl);
    assert.equal(
      page.navigations.at(-1),
      page.originalUrl,
    );
    assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
    assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
    if (!result.ok) continue;
    const decoded = decodeBlooketCapabilitySnapshot(result.value);
    assert.equal(decoded.ok, true);
    if (decoded.ok) {
      assert.equal(decoded.value.features.answerImages, media);
      assert.equal(decoded.value.features.audio, media);
    }
  }
  },
);

test(
  "empty accounts stay account-dependent without opening a form",
  async () => {
  const page = fixture({ empty: true });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome,
    7,
    noPause,
  ).inspect();
  assert.equal(result.ok, true);
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.equal(
    page.scripts.includes("openBlooketCapabilityQuestionPanel"),
    false,
  );
  if (!result.ok) return;
  const decoded = decodeBlooketCapabilitySnapshot(result.value);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.value.features.answerImages, "account-dependent");
    assert.equal(decoded.value.features.audio, "account-dependent");
  }
  },
);

test(
  "cleanup failure invalidates an otherwise observed capability",
  async () => {
  const page = fixture({ cleanupFails: true });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome,
    7,
    noPause,
  ).inspect();
  assert.deepEqual(result, {
    ok: false,
    code: "blooket-browser-failed",
  });
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
  },
);

test("restoration failure invalidates an otherwise clean probe", async () => {
  const page = fixture({ restoreFails: true });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome,
    7,
    noPause,
  ).inspect();
  assert.deepEqual(result, {
    ok: false,
    code: "blooket-browser-failed",
  });
  assert.notEqual(page.currentUrl(), page.originalUrl);
  assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
  assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
});

test("malformed set-list evidence fails before Add Question", async () => {
  const page = fixture({ malformedList: true });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome,
    7,
    noPause,
  ).inspect();
  assert.equal(result.ok, false);
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.equal(
    page.scripts.includes("openBlooketCapabilityQuestionPanel"),
    false,
  );
});

test("cleanup polling exceptions still restore the original tab", async () => {
  for (const cleanupPollThrows of ["drawer", "question"] as const) {
    const page = fixture({ cleanupPollThrows });
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.currentUrl(), page.originalUrl);
    assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
  }
});

test(
  "unproved empty lists and duplicate sets cannot yield a snapshot",
  async () => {
  for (const options of [
    { unknownEmpty: true },
    { duplicateList: true },
  ]) {
    const page = fixture(options);
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.currentUrl(), page.originalUrl);
    assert.equal(
      page.scripts.includes("openBlooketCapabilityQuestionPanel"), false,
    );
  }
  },
);

test(
  "control-bearing set IDs never reach capability panel navigation",
  async () => {
  for (const malformedSetId of ["x\ny", "x\ty", "x\u007fy"]) {
    const page = fixture({ malformedSetId });
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.currentUrl(), page.originalUrl);
    assert.equal(page.navigations.some(
      (url) => url.includes("/edit?id=" + encodeURIComponent(malformedSetId)),
    ), false);
    assert.equal(page.scripts.includes(
      "openBlooketCapabilityQuestionPanel",
    ), false);
  }
  },
);

test("unexpected outer list fields fail before edit navigation", async () => {
  const page = fixture({ extraOuterField: true });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.equal(page.scripts.includes(
    "openBlooketCapabilityQuestionPanel",
  ), false);
});
