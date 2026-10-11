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
  readonly questionOpenRejected?: boolean;
  readonly drawerOpenRejected?: boolean;
  readonly questionOpenThrows?: boolean;
  readonly drawerOpenThrows?: boolean;
  readonly questionOpenMalformed?: boolean;
  readonly drawerOpenMalformed?: boolean;
  readonly malformedList?: boolean;
  readonly unknownEmpty?: boolean;
  readonly duplicateList?: boolean;
  readonly malformedSetId?: string;
  readonly extraOuterField?: boolean;
  readonly restoreFails?: boolean;
  readonly unsafeOriginalEditor?: boolean;
  readonly cleanupPollThrows?: "drawer" | "question";
  readonly audioProbeReplies?: readonly unknown[];
  readonly setListReplies?: readonly unknown[];
  readonly panelReadyReplies?: readonly unknown[];
  readonly audioClosedReplies?: readonly unknown[];
  readonly questionClosedReplies?: readonly unknown[];
  readonly replaceAt?: string;
} = {}) {
  const originalUrl = "https://dashboard.blooket.com/edit?id=original-set";
  let tabUrl = originalUrl;
  let documentOrigin = 1_000;
  let replaced = false;
  let panelOpen = false;
  let drawerOpen = false;
  let audioProbeCount = 0;
  let setListCount = 0;
  let panelReadyCount = 0;
  let audioClosedCount = 0;
  let questionClosedCount = 0;
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
        documentOrigin += 1_000;
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
        if (input.func.name === "inspectBlooketDocumentOrigin") {
          assert.deepEqual(args, [tabUrl]);
          return [{ result: documentOrigin }];
        }
        if (!replaced && options.replaceAt === input.func.name) {
          replaced = true;
          documentOrigin += 1_000;
        }
        switch (input.func.name) {
          case "canLeaveBlooketPageForRead":
            return [{ result: !options.unsafeOriginalEditor }];
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
              const supplied = options.setListReplies?.[setListCount++];
              if (supplied !== undefined) return [{ result: supplied }];
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
            if (options.questionOpenRejected) return [{ result: false }];
            panelOpen = true;
            if (options.questionOpenThrows)
              throw new Error("synthetic late modal acknowledgement failure");
            if (options.questionOpenMalformed)
              return [{ result: "unknown" }];
            return [{ result: true }];
          case "isBlooketCapabilityQuestionPanelReady": {
            const next = options.panelReadyReplies?.[panelReadyCount++];
            return [{ result: next === undefined ? panelOpen : next }];
          }
          case "openBlooketAudioCapabilityDrawer":
            assert.equal(panelOpen, true);
            if (options.drawerOpenRejected) return [{ result: false }];
            drawerOpen = true;
            if (options.drawerOpenThrows)
              throw new Error("synthetic late drawer acknowledgement failure");
            if (options.drawerOpenMalformed)
              return [{ result: "unknown" }];
            return [{ result: true }];
          case "inspectBlooketAudioCapabilityDrawer": {
            const reply = options.audioProbeReplies?.[audioProbeCount++];
            return [{
              result: reply !== undefined ? reply : {
                ok: true,
                value: options.media ?? "supported",
              },
            }];
          }
          case "isBlooketAudioCapabilityDrawerClosed": {
            if (!drawerOpen && options.cleanupPollThrows === "drawer")
              throw new Error("synthetic drawer confirmation unavailable");
            const next = options.audioClosedReplies?.[audioClosedCount++];
            return [{ result: next === undefined ? !drawerOpen : next }];
          }
          case "closeBlooketAudioCapabilityDrawer":
            if (options.cleanupFails) return [{ result: false }];
            drawerOpen = false;
            return [{ result: true }];
          case "isBlooketCapabilityQuestionPanelClosed": {
            if (!panelOpen && options.cleanupPollThrows === "question")
              throw new Error("synthetic question confirmation unavailable");
            const next = options.questionClosedReplies?.[questionClosedCount++];
            return [{ result: next === undefined ? !panelOpen && !drawerOpen :
              next }];
          }
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
  assert.equal(page.scripts.filter(
    (name) => name === "inspectBlooketPage",
  ).length, 3);
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
  assert.equal(
      page.currentUrl(), "https://dashboard.blooket.com/edit?id=set-fixture",
    );
  assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
  },
);

test(
  "failed Audio drawer cleanup never clicks the underlying question modal",
  async () => {
  const page = fixture({ cleanupFails: true });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(
      page.currentUrl(), "https://dashboard.blooket.com/edit?id=set-fixture",
    );
  assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
  assert.equal(page.scripts.includes(
    "closeBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test(
  "unconfirmed modal or drawer open never navigates away or guesses cleanup",
  async () => {
  for (const options of [
    { questionOpenThrows: true },
    { questionOpenMalformed: true },
    { drawerOpenThrows: true },
    { drawerOpenMalformed: true },
  ]) {
    const page = fixture(options);
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.currentUrl(),
      "https://dashboard.blooket.com/edit?id=set-fixture");
    assert.equal(page.scripts.includes(
      "closeBlooketAudioCapabilityDrawer",
    ), false);
    assert.equal(page.scripts.includes(
      "closeBlooketCapabilityQuestionPanel",
    ), false);
    assert.notEqual(page.navigations.at(-1), page.originalUrl);
  }
  },
);

test("existing unsaved editor blocks capability navigation", async () => {
  const page = fixture({ unsafeOriginalEditor: true });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.equal(page.navigations.length, 0);
  assert.deepEqual(page.scripts, [
    "inspectBlooketDocumentOrigin", "canLeaveBlooketPageForRead",
  ]);
});

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

test("unconfirmed cleanup preserves the edit route", async () => {
  for (const cleanupPollThrows of ["drawer", "question"] as const) {
    const page = fixture({ cleanupPollThrows });
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(
      page.currentUrl(), "https://dashboard.blooket.com/edit?id=set-fixture",
    );
    // If Audio closure could not be verified, do not click through its
    // overlay. A failure at the parent modal still permits its own cleanup.
    assert.equal(page.scripts.includes(
      "closeBlooketCapabilityQuestionPanel",
    ), cleanupPollThrows === "question");
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

test(
  "a slow page aborts before the bridge deadline and restores the tab",
  async () => {
  const page = fixture();
  let clock = 0;
  const get = page.chrome.tabs.get;
  page.chrome.tabs.get = async (id: number) => {
    const tab = await get(id);
    return tab.url?.endsWith("/my-sets")
      ? { ...tab, status: "loading" }
      : tab;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome,
    7,
    async (ms) => { clock += ms * 10; },
    () => clock,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.ok(clock <= 9_000);
  assert.equal(page.scripts.includes(
    "openBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test(
  "expiration during a Blooket list script never opens Add Question",
  async () => {
  const page = fixture();
  let clock = 0;
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const result = await execute(request);
    if (request.func.name === "inspectBlooketPage" &&
        (request.args?.[0] as { kind?: string } | undefined)?.kind ===
          "sets.list") clock = 6_500;
    return result;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, async () => {}, () => clock,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.equal(page.scripts.includes(
    "openBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test("rejected UI opens are never mistaken for owned open modals", async () => {
  for (const options of [
    { questionOpenRejected: true },
    { drawerOpenRejected: true },
  ]) {
    const page = fixture(options);
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.currentUrl(), page.originalUrl);
    assert.equal(page.scripts.includes("closeBlooketAudioCapabilityDrawer"),
      false);
    assert.equal(page.scripts.includes("closeBlooketCapabilityQuestionPanel"),
      !!options.drawerOpenRejected);
  }
});

test(
  "a late successful open must still be canceled before restoring",
  async () => {
  const page = fixture();
  let clock = 0;
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const result = await execute(request);
    if (request.func.name === "openBlooketCapabilityQuestionPanel")
      clock = 6_100;
    return result;
  };
  const outcome = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, async () => {}, () => clock,
  ).inspect();
  assert.deepEqual(outcome, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.equal(page.scripts.includes(
    "openBlooketAudioCapabilityDrawer",
  ), false);
  },
);

test("restoration polling cannot overrun the final bridge budget", async () => {
  const page = fixture();
  let clock = 0;
  const get = page.chrome.tabs.get;
  page.chrome.tabs.get = async (id: number) => {
    const tab = await get(id);
    return page.navigations.length > 1 &&
        tab.url === page.originalUrl
      ? { ...tab, status: "loading" }
      : tab;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, async (ms) => { clock += ms * 10; },
    () => clock,
  ).inspect();
  assert.deepEqual(result, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.ok(clock <= 9_000);
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
  assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
});

test(
  "a late audio-drawer open still closes both owned modal levels",
  async () => {
  const page = fixture();
  let clock = 0;
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const result = await execute(request);
    if (request.func.name === "openBlooketAudioCapabilityDrawer")
      clock = 6_100;
    return result;
  };
  const outcome = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, async () => {}, () => clock,
  ).inspect();
  assert.deepEqual(outcome, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
  assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
  assert.equal(page.currentUrl(), page.originalUrl);
  },
);

test(
  "user navigation during set listing is not overwritten by inspection",
  async () => {
  const page = fixture();
  const manualRoute = "https://example.invalid/manual-destination";
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const reply = await execute(request);
    if (
      request.func.name === "inspectBlooketPage" &&
      (request.args?.[0] as { kind: string } | undefined)?.kind ===
        "sets.list"
    ) await page.chrome.tabs.update(7, { url: manualRoute });
    return reply;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.currentUrl(), manualRoute);
  assert.equal(page.navigations.at(-1), manualRoute);
  assert.equal(page.scripts.includes("openBlooketCapabilityQuestionPanel"),
    false);
  },
);

test(
  "user navigation while a drawer is open survives failed cleanup",
  async () => {
  const page = fixture();
  const manualRoute = "https://example.invalid/user-switched-tab";
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const reply = await execute(request);
    if (request.func.name === "inspectBlooketAudioCapabilityDrawer")
      await page.chrome.tabs.update(7, { url: manualRoute });
    return reply;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.currentUrl(), manualRoute);
  assert.equal(page.navigations.at(-1), manualRoute);
  assert.equal(page.scripts.includes("closeBlooketAudioCapabilityDrawer"),
    false);
  assert.equal(page.scripts.includes("closeBlooketCapabilityQuestionPanel"),
    false);
  },
);

test(
  "a user-selected same-origin route is not an owned probe route",
  async () => {
  const page = fixture();
  const manualRoute = "https://dashboard.blooket.com/create";
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const result = await execute(request);
    if (request.func.name === "inspectBlooketAudioCapabilityDrawer")
      await page.chrome.tabs.update(7, { url: manualRoute });
    return result;
  };
  const outcome = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(outcome, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.currentUrl(), manualRoute);
  assert.equal(page.navigations.at(-1), manualRoute);
  assert.equal(page.scripts.includes("closeBlooketAudioCapabilityDrawer"),
    false);
  assert.equal(page.scripts.includes("closeBlooketCapabilityQuestionPanel"),
    false);
  },
);

test(
  "malformed audio evidence is never retried into a successful snapshot",
  async () => {
  const invalid = [
    { ok: true, value: "supported", unexpected: "private" },
    { ok: true, value: "unverified" },
    { ok: false, code: "private-provider-error" },
    { ok: false, code: "blooket-browser-failed", secret: "private" },
    null,
    "supported",
  ];
  for (const first of invalid) {
    const page = fixture({ audioProbeReplies: [
      first,
      { ok: true, value: "supported" },
    ] });
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.scripts.filter(
      (name) => name === "inspectBlooketAudioCapabilityDrawer",
    ).length, 1);
    assert.equal(page.currentUrl(), page.originalUrl);
    assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
    assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
  }
  },
);

test(
  "exact transient Audio unavailability may recover by polling",
  async () => {
  const page = fixture({ audioProbeReplies: [
    { ok: false, code: "blooket-browser-failed" },
    { ok: false, code: "blooket-browser-failed" },
    { ok: true, value: "unsupported" },
    { ok: true, value: "unsupported" },
  ] });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.equal(result.ok, true);
  if (result.ok) {
    const decoded = decodeBlooketCapabilitySnapshot(result.value);
    assert.equal(decoded.ok, true);
    if (decoded.ok) assert.equal(decoded.value.features.audio, "unsupported");
  }
  assert.equal(page.scripts.filter(
    (name) => name === "inspectBlooketAudioCapabilityDrawer",
  ).length, 4);
  assert.equal(page.currentUrl(), page.originalUrl);
  },
);

test(
  "malformed modal-readiness replies never become ready by polling",
  async () => {
  const page = fixture({ panelReadyReplies: ["true", true] });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.scripts.filter(
    (name) => name === "isBlooketCapabilityQuestionPanelReady",
  ).length, 1);
  assert.equal(page.scripts.includes("openBlooketAudioCapabilityDrawer"),
    false);
  assert.equal(page.currentUrl(), page.originalUrl);
  },
);

test(
  "malformed cleanup readiness cannot confirm success after a retry",
  async () => {
  for (const options of [
    { audioClosedReplies: [false, "true", true] },
    { questionClosedReplies: [false, "true", true] },
  ]) {
    const page = fixture(options);
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
    assert.equal(
      page.currentUrl(), "https://dashboard.blooket.com/edit?id=set-fixture",
    );
  }
  },
);

test("malformed already-closed evidence never authorizes Cancel", async () => {
  for (const options of [
    { audioClosedReplies: ["false", true] },
    { questionClosedReplies: ["false", true] },
  ]) {
    const page = fixture(options);
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
    assert.equal(
      page.currentUrl(), "https://dashboard.blooket.com/edit?id=set-fixture",
    );
    if ("audioClosedReplies" in options)
      assert.equal(page.scripts.includes(
        "closeBlooketAudioCapabilityDrawer",
      ), false);
    if ("questionClosedReplies" in options)
      assert.equal(page.scripts.includes(
        "closeBlooketCapabilityQuestionPanel",
      ), false);
  }
});

test(
  "media availability must agree across two exact drawer observations",
  async () => {
  for (const audioProbeReplies of [
    [
      { ok: true, value: "supported" },
      { ok: true, value: "unsupported" },
    ],
    [
      { ok: true, value: "unsupported" },
      { ok: true, value: "supported" },
    ],
    [
      { ok: true, value: "supported" },
      { ok: true, value: "supported", extra: "provider-secret" },
    ],
    [
      { ok: true, value: "supported" },
      { ok: false, code: "blooket-browser-failed" },
    ],
  ]) {
    const page = fixture({ audioProbeReplies });
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.scripts.filter(
      (name) => name === "inspectBlooketAudioCapabilityDrawer",
    ).length, 2);
    assert.equal(page.currentUrl(), page.originalUrl);
    assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
    assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
    assert.equal(JSON.stringify(result).includes("provider-secret"), false);
  }
  },
);


test(
  "expiring before capability confirmation invalidates the snapshot",
  async () => {
  const page = fixture();
  let clock = 0;
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const result = await execute(request);
    if (request.func.name === "inspectBlooketAudioCapabilityDrawer") {
      clock = 5_950;
    }
    return result;
  };
  const outcome = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, async (ms) => { clock += ms; }, () => clock,
  ).inspect();
  assert.deepEqual(outcome, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(page.scripts.filter(
    (name) => name === "inspectBlooketAudioCapabilityDrawer",
  ).length, 1);
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.ok(page.scripts.includes("closeBlooketAudioCapabilityDrawer"));
  assert.ok(page.scripts.includes("closeBlooketCapabilityQuestionPanel"));
  },
);


test(
  "capability inspection rejects a changing My Sets collection",
  async () => {
  const empty = { ok: true, value: {
    completeness: "complete", items: [],
  } };
  const present = { ok: true, value: {
    completeness: "unknown", items: [{
      schemaVersion: 1, id: "set-fixture", title: "Synthetic fixture",
    }],
  } };
  const changed = { ok: true, value: {
    completeness: "unknown", items: [{
      schemaVersion: 1, id: "set-fixture", title: "Changed title",
    }],
  } };
  for (const setListReplies of [
    [empty, present],
    [present, empty],
    [present, changed],
    [present, { ok: true, value: present.value, private: "secret" }],
  ]) {
    const page = fixture({ setListReplies });
    const outcome = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(outcome, {
      ok: false, code: "blooket-browser-failed",
    });
    assert.equal(page.currentUrl(), page.originalUrl);
    assert.equal(page.scripts.filter(
      (name) => name === "inspectBlooketPage",
    ).length, 3);
    assert.equal(page.scripts.includes(
      "openBlooketCapabilityQuestionPanel",
    ), false);
  }
  },
);


test(
  "a user route change during My Sets confirmation aborts the probe",
  async () => {
  const page = fixture();
  const manuallySelected = "https://dashboard.blooket.com/create";
  let listReads = 0;
  const script = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (input) => {
    const result = await script(input);
    if (input.func.name === "inspectBlooketPage" &&
        (input.args?.[0] as { readonly kind?: string } | undefined)?.kind ===
          "sets.list" && ++listReads === 2)
      await page.chrome.tabs.update(7, { url: manuallySelected });
    return result;
  };
  const outcome = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(outcome, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(listReads, 2);
  assert.equal(page.currentUrl(), manuallySelected);
  assert.equal(page.navigations.at(-1), manuallySelected);
  assert.equal(page.scripts.includes(
    "openBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test(
  "an overdue My Sets confirmation never begins an editor probe",
  async () => {
  const page = fixture({ empty: true });
  let clock = 0;
  let listReads = 0;
  const script = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (input) => {
    const result = await script(input);
    if (input.func.name === "inspectBlooketPage" &&
        (input.args?.[0] as { readonly kind?: string } | undefined)?.kind ===
          "sets.list" && ++listReads === 2)
      clock = 6_100;
    return result;
  };
  const outcome = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause, () => clock,
  ).inspect();
  assert.deepEqual(outcome, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(listReads, 2);
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.equal(page.scripts.includes(
    "openBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test(
  "an edit-page navigation during observation cannot open Add Question",
  async () => {
  const page = fixture();
  const manualRoute = "https://dashboard.blooket.com/create";
  const script = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (input) => {
    const result = await script(input);
    if (input.func.name === "inspectBlooketPage" &&
        (input.args?.[0] as { kind?: string } | undefined)?.kind ===
          "session.observe" && page.currentUrl().includes("/edit?id="))
      await page.chrome.tabs.update(7, { url: manualRoute });
    return result;
  };
  const outcome = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(outcome, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(page.currentUrl(), manualRoute);
  assert.equal(page.navigations.at(-1), manualRoute);
  assert.equal(page.scripts.includes(
    "openBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test(
  "a switched tab during question readiness never opens Audio",
  async () => {
  const page = fixture();
  const manualRoute = "https://dashboard.blooket.com/create";
  const script = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (input) => {
    const result = await script(input);
    if (input.func.name === "isBlooketCapabilityQuestionPanelReady")
      await page.chrome.tabs.update(7, { url: manualRoute });
    return result;
  };
  const outcome = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(outcome, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(page.currentUrl(), manualRoute);
  assert.equal(page.scripts.includes(
    "openBlooketAudioCapabilityDrawer",
  ), false);
  assert.equal(page.scripts.includes(
    "closeBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test(
  "a user route change before the modal opener skips the click script",
  async () => {
  const page = fixture();
  const manualRoute = "https://dashboard.blooket.com/create";
  let afterEditObservation = false;
  let editTabReads = 0;
  const script = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (input) => {
    const result = await script(input);
    if (input.func.name === "inspectBlooketPage" &&
        (input.args?.[0] as { kind?: string } | undefined)?.kind ===
          "session.observe" && page.currentUrl().includes("/edit?id="))
      afterEditObservation = true;
    return result;
  };
  const get = page.chrome.tabs.get;
  page.chrome.tabs.get = async (id: number) => {
    const tab = await get(id);
    if (afterEditObservation && ++editTabReads === 2) {
      await page.chrome.tabs.update(id, { url: manualRoute });
      return { status: "complete", url: manualRoute };
    }
    return tab;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.currentUrl(), manualRoute);
  assert.equal(page.scripts.includes(
    "openBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test(
  "a user route change before the Audio opener skips its click script",
  async () => {
  const page = fixture();
  const manualRoute = "https://dashboard.blooket.com/create";
  let afterQuestionReady = false;
  let postReadyTabReads = 0;
  const script = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (input) => {
    const result = await script(input);
    if (input.func.name === "isBlooketCapabilityQuestionPanelReady")
      afterQuestionReady = true;
    return result;
  };
  const get = page.chrome.tabs.get;
  page.chrome.tabs.get = async (id: number) => {
    const tab = await get(id);
    if (afterQuestionReady && ++postReadyTabReads === 2) {
      await page.chrome.tabs.update(id, { url: manualRoute });
      return { status: "complete", url: manualRoute };
    }
    return tab;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  assert.equal(page.currentUrl(), manualRoute);
  assert.equal(page.scripts.includes(
    "openBlooketAudioCapabilityDrawer",
  ), false);
  assert.equal(page.scripts.includes(
    "closeBlooketCapabilityQuestionPanel",
  ), false);
  },
);

test(
  "manual navigation during Audio cancellation stops remaining cleanup",
  async () => {
  const page = fixture();
  const manualRoute = "https://dashboard.blooket.com/create";
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const response = await execute(request);
    if (request.func.name === "closeBlooketAudioCapabilityDrawer")
      await page.chrome.tabs.update(7, { url: manualRoute });
    return response;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  const cancellation = page.scripts.indexOf(
    "closeBlooketAudioCapabilityDrawer",
  );
  assert.ok(cancellation >= 0);
  assert.equal(page.scripts.length, cancellation + 1);
  assert.equal(page.currentUrl(), manualRoute);
  },
);

test(
  "manual navigation during question cancellation stops closure polling",
  async () => {
  const page = fixture();
  const manualRoute = "https://dashboard.blooket.com/create";
  const execute = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async (request) => {
    const response = await execute(request);
    if (request.func.name === "closeBlooketCapabilityQuestionPanel")
      await page.chrome.tabs.update(7, { url: manualRoute });
    return response;
  };
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
  const cancellation = page.scripts.indexOf(
    "closeBlooketCapabilityQuestionPanel",
  );
  assert.ok(cancellation >= 0);
  assert.equal(page.scripts.length, cancellation + 1);
  assert.equal(page.currentUrl(), manualRoute);
  },
);

test("capability probing rejects a same-route document replacement",
  async () => {
  for (const phase of [
    "inspectBlooketPage",
    "openBlooketCapabilityQuestionPanel",
    "openBlooketAudioCapabilityDrawer",
    "inspectBlooketAudioCapabilityDrawer",
    "closeBlooketAudioCapabilityDrawer",
  ]) {
    const page = fixture({ replaceAt: phase });
    const result = await createExtensionCapabilityInspectionHost(
      page.chrome, 7, noPause,
    ).inspect();
    assert.deepEqual(result, { ok: false, code: "blooket-browser-failed" });
    assert.notEqual(page.navigations.at(-1), page.originalUrl);
    // A replacement editor is teacher-owned, even at the identical URL.
    if (phase === "openBlooketCapabilityQuestionPanel" ||
        phase === "openBlooketAudioCapabilityDrawer" ||
        phase === "inspectBlooketAudioCapabilityDrawer" ||
        phase === "closeBlooketAudioCapabilityDrawer") {
      assert.equal(page.scripts.includes(
        "closeBlooketCapabilityQuestionPanel"), false);
    }
    if (phase === "closeBlooketAudioCapabilityDrawer")
      assert.equal(page.scripts.filter(name =>
        name === "closeBlooketAudioCapabilityDrawer").length, 1);
  }
  },
);

test("capability navigation never leaves a reloaded source document",
  async () => {
  const page = fixture({ replaceAt: "canLeaveBlooketPageForRead" });
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.deepEqual(result, {
    ok: false, code: "blooket-browser-failed",
  });
  assert.equal(page.navigations.length, 0);
  assert.equal(page.currentUrl(), page.originalUrl);
  assert.deepEqual(page.scripts, [
    "inspectBlooketDocumentOrigin",
    "canLeaveBlooketPageForRead",
    "inspectBlooketDocumentOrigin",
  ]);
  },
);

test("capability navigation rejects missing native source identity",
  async () => {
  const page = fixture();
  const original = page.chrome.scripting.executeScript;
  page.chrome.scripting.executeScript = async options =>
    options.func.name === "inspectBlooketDocumentOrigin"
      ? [{ result: null }] : await original(options);
  const result = await createExtensionCapabilityInspectionHost(
    page.chrome, 7, noPause,
  ).inspect();
  assert.equal(result.ok, false);
  assert.equal(page.navigations.length, 0);
  assert.equal(page.scripts.includes("canLeaveBlooketPageForRead"), false);
  },
);
