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
//   - Non-mutating Blooket capability controls inside Add Question.
// - Must-Not:
//   - Submit forms, upload media, read React state, or expose account data.
// - Allows:
//   - Inputs: One exact set ID on the authenticated edit route.
//   - Outputs: Plus-gated media availability and bounded capability candidates.
//   - Side effects: Open and cancel Add Question and its audio drawer only.
// - Split-When:
//   - Capability families require different observable account probes.
// - Merge-When:
//   - Blooket exposes stable provider-owned account capabilities.
// - Summary:
//   - Resolves the shared answer-image/audio Plus gate without saving.
// - Description:
//   - Every injected page function is self-contained for Chrome scripting.
// - Usage:
//   - Orchestrate through the extension capability inspection host.
// - Defaults:
//   - Ambiguous controls and cleanup state fail closed.
//
export type BlooketAccountMediaAvailability =
  | "supported"
  | "unsupported"
  | "account-dependent";

export type BlooketCapabilityPageResult =
  | { readonly ok: true; readonly value: "supported" | "unsupported" }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

// A capability probe may navigate the teacher's tab to My Sets. Refuse that
// navigation when an existing editor, modal, or human stop may contain work.
// This is a conservative navigation guard, not authentication evidence.
export function canLeaveBlooketPageForRead(): boolean {
  try {
    if (location.origin !== "https://dashboard.blooket.com" ||
        document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]')) return false;
    const path = location.pathname;
    // The Create Set page is itself a draft form, even when no control has
    // focus. A route change could silently discard the teacher's work.
    if (path === "/create") return false;
    if (path !== "/my-sets" && path !== "/edit" &&
        !path.startsWith("/set/")) return false;
    const visible = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    };
    const dialogs = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"]',
    ));
    if (dialogs.some(visible)) return false;
    if (document.querySelector('input#question[name="question"]') ||
        document.querySelector('aside[data-drawer-open="true"]'))
      return false;
    const editorFields = Array.from(document.querySelectorAll(
      'form#question-set-form input#title[name="title"], ' +
      'form#question-set-form textarea#desc[name="desc"]',
    ));
    if (editorFields.some(visible)) return false;
    const active = document.activeElement;
    if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" ||
        active?.getAttribute("contenteditable") === "true") return false;
    return true;
  } catch {
    return false;
  }
}

export function openBlooketCapabilityQuestionPanel(setId: string): boolean {
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        (text === undefined || elements[0]!.textContent?.trim() === text);
    };
    const authenticated =
      document.title !== "Just a moment..." &&
      document.querySelector('input[type="password"]') === null &&
      visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      (() => {
        const links = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/logout"]',
        ));
        if (links.length !== 1 || links[0]!.textContent?.trim() !== "Logout")
          return false;
        if (visibleUnique('a[href="https://id.blooket.com/logout"]'))
          return true;
        // The real dashboard hides Logout while the account menu is closed.
        const profile = 'a[href="https://id.blooket.com/login"]';
        return visibleUnique(profile) &&
          Boolean(document.querySelector(profile)?.textContent?.trim());
      })();
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    const normalized = (element: Element) =>
      (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      !setId ||
      setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    )
      return false;
    if (document.querySelector('input#question[name="question"]')) return false;
    let buttons = Array.from(document.querySelectorAll("button")).filter(
      (button) => normalized(button) === "Add Question",
    );
    // The live Edit page repeats Add Question in its header and list.
    // Resolve the observed list toolbar instead of choosing by DOM order.
    if (buttons.length === 2) {
      buttons = buttons.filter(button => {
        const peers = Array.from(
          button.parentElement?.querySelectorAll("button") ?? [],
        );
        return peers.filter(peer =>
          normalized(peer) === "Add Question").length === 1 &&
          peers.filter(peer =>
            normalized(peer) === "Show all answers").length === 1;
      });
    }
    if (buttons.length !== 1) return false;
    const control = buttons[0] as HTMLButtonElement;
    const bounds = control.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || control.disabled ||
        control.getAttribute("aria-disabled") === "true") return false;
    // Only this read may cancel the question form; any trusted human action
    // relinquishes ownership, including interactions in its Audio drawer.
    const world = globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document;
        setId: string;
        dirty: boolean;
        dispose: () => void;
      };
    };
    world.__blooketCapabilityEditWatch?.dispose();
    const watch = {
      document,
      setId,
      dirty: false,
      dispose: () => {},
    };
    const onInteraction = (event: Event) => {
      if (event.isTrusted) watch.dirty = true;
    };
    const types = ["pointerdown", "keydown", "input", "change"];
    watch.dispose = () => {
      for (const type of types)
        document.removeEventListener(type, onInteraction, true);
      if (world.__blooketCapabilityEditWatch === watch)
        delete world.__blooketCapabilityEditWatch;
    };
    for (const type of types)
      document.addEventListener(type, onInteraction, true);
    world.__blooketCapabilityEditWatch = watch;
    try {
      control.click();
      return true;
    } catch {
      watch.dispose();
      return false;
    }
  } catch {
    return false;
  }
}

export function isBlooketCapabilityQuestionPanelReady(setId: string): boolean {
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        (text === undefined || elements[0]!.textContent?.trim() === text);
    };
    const authenticated =
      document.title !== "Just a moment..." &&
      document.querySelector('input[type="password"]') === null &&
      visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      (() => {
        const links = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/logout"]',
        ));
        if (links.length !== 1 || links[0]!.textContent?.trim() !== "Logout")
          return false;
        if (visibleUnique('a[href="https://id.blooket.com/logout"]'))
          return true;
        // The real dashboard hides Logout while the account menu is closed.
        const profile = 'a[href="https://id.blooket.com/login"]';
        return visibleUnique(profile) &&
          Boolean(document.querySelector(profile)?.textContent?.trim());
      })();
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean
      };
    }).__blooketCapabilityEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty) return false;
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      !setId ||
      setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    )
      return false;
    const inputs = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (inputs.length !== 1 || inputs[0]?.tagName !== "INPUT") return false;
    const question = inputs[0] as HTMLInputElement;
    if (question.getAttribute("type") !== "hidden") return false;
    const form = question.closest("form");
    if (!form || form.tagName !== "FORM") return false;
    const setIds = Array.from(
      form.querySelectorAll('input#setId[name="setId"]'),
    );
    return (
      setIds.length === 1 &&
      setIds[0]?.tagName === "INPUT" &&
      setIds[0].getAttribute("type") === "hidden" &&
      (setIds[0] as HTMLInputElement).value === setId
    );
  } catch {
    return false;
  }
}

export function openBlooketAudioCapabilityDrawer(setId: string): boolean {
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        (text === undefined || elements[0]!.textContent?.trim() === text);
    };
    const authenticated =
      document.title !== "Just a moment..." &&
      document.querySelector('input[type="password"]') === null &&
      visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      (() => {
        const links = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/logout"]',
        ));
        if (links.length !== 1 || links[0]!.textContent?.trim() !== "Logout")
          return false;
        if (visibleUnique('a[href="https://id.blooket.com/logout"]'))
          return true;
        // The real dashboard hides Logout while the account menu is closed.
        const profile = 'a[href="https://id.blooket.com/login"]';
        return visibleUnique(profile) &&
          Boolean(document.querySelector(profile)?.textContent?.trim());
      })();
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean
      };
    }).__blooketCapabilityEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty) return false;
    const normalized = (element: Element) =>
      (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId ||
      document.querySelectorAll('aside[data-drawer-open="true"]').length !== 0
    )
      return false;
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT")
      return false;
    const question = questions[0]!;
    if (question.getAttribute("type") !== "hidden") return false;
    const form = question.closest("form");
    if (form?.tagName !== "FORM") return false;
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return false;
    const buttons = Array.from(form.querySelectorAll("button")).filter(
      (button) => normalized(button) === "Audio",
    );
    if (buttons.length !== 1) return false;
    const control = buttons[0] as HTMLButtonElement;
    const bounds = control.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || control.disabled ||
        control.getAttribute("aria-disabled") === "true") return false;
    control.click();
    return true;
  } catch {
    return false;
  }
}

export function inspectBlooketAudioCapabilityDrawer(
  setId: string,
): BlooketCapabilityPageResult {
  const failed = (): BlooketCapabilityPageResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        (text === undefined || elements[0]!.textContent?.trim() === text);
    };
    const authenticated =
      document.title !== "Just a moment..." &&
      document.querySelector('input[type="password"]') === null &&
      visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      (() => {
        const links = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/logout"]',
        ));
        if (links.length !== 1 || links[0]!.textContent?.trim() !== "Logout")
          return false;
        if (visibleUnique('a[href="https://id.blooket.com/logout"]'))
          return true;
        // The real dashboard hides Logout while the account menu is closed.
        const profile = 'a[href="https://id.blooket.com/login"]';
        return visibleUnique(profile) &&
          Boolean(document.querySelector(profile)?.textContent?.trim());
      })();
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return failed();
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean
      };
    }).__blooketCapabilityEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty) return failed();
    const normalized = (element: Element) =>
      (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    )
      return failed();
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT" ||
        questions[0].getAttribute("type") !== "hidden")
      return failed();
    const form = questions[0]!.closest("form");
    if (form?.tagName !== "FORM") return failed();
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return failed();
    const drawers = Array.from(
      document.querySelectorAll('aside[data-drawer-open="true"]'),
    );
    if (drawers.length !== 1) return failed();
    const drawer = drawers[0]!;
    const titles = Array.from(drawer.querySelectorAll("span"))
      .map((span) => normalized(span))
      .filter(
        (text) =>
          text === "Upgrade to Plus" ||
          /^Question [1-9][0-9]* Audio$/u.test(text),
      );
    if (titles.length !== 1) return failed();
    const audioInputs = Array.from(
      drawer.querySelectorAll('input[type="file"][accept="audio/*"]'),
    );
    if (titles[0] === "Upgrade to Plus") {
      const exactUpsell = normalized(drawer).includes(
        "Add audio to your questions and unlock many other premium features " +
          "with Blooket Plus.",
      );
      return exactUpsell && audioInputs.length === 0
        ? { ok: true, value: "unsupported" }
        : failed();
    }
    return audioInputs.length === 1 &&
        audioInputs[0]?.tagName === "INPUT" &&
        !(audioInputs[0] as HTMLInputElement).disabled
      ? { ok: true, value: "supported" }
      : failed();
  } catch {
    return failed();
  }
}

export function closeBlooketAudioCapabilityDrawer(setId: string): boolean {
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        (text === undefined || elements[0]!.textContent?.trim() === text);
    };
    const authenticated =
      document.title !== "Just a moment..." &&
      document.querySelector('input[type="password"]') === null &&
      visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      (() => {
        const links = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/logout"]',
        ));
        if (links.length !== 1 || links[0]!.textContent?.trim() !== "Logout")
          return false;
        if (visibleUnique('a[href="https://id.blooket.com/logout"]'))
          return true;
        // The real dashboard hides Logout while the account menu is closed.
        const profile = 'a[href="https://id.blooket.com/login"]';
        return visibleUnique(profile) &&
          Boolean(document.querySelector(profile)?.textContent?.trim());
      })();
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean
      };
    }).__blooketCapabilityEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty) return false;
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    )
      return false;
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT" ||
        questions[0].getAttribute("type") !== "hidden")
      return false;
    const form = questions[0]!.closest("form");
    if (form?.tagName !== "FORM") return false;
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return false;
    const drawers = Array.from(
      document.querySelectorAll('aside[data-drawer-open="true"]'),
    );
    if (drawers.length !== 1) return false;
    const cancels = Array.from(
      drawers[0]!.querySelectorAll('button[aria-label="Cancel"]'),
    );
    if (cancels.length !== 1) return false;
    const control = cancels[0] as HTMLButtonElement;
    const bounds = control.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || control.disabled ||
        control.getAttribute("aria-disabled") === "true") return false;
    control.click();
    return true;
  } catch {
    return false;
  }
}

export function isBlooketAudioCapabilityDrawerClosed(setId: string): boolean {
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        (text === undefined || elements[0]!.textContent?.trim() === text);
    };
    const authenticated =
      document.title !== "Just a moment..." &&
      document.querySelector('input[type="password"]') === null &&
      visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      (() => {
        const links = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/logout"]',
        ));
        if (links.length !== 1 || links[0]!.textContent?.trim() !== "Logout")
          return false;
        if (visibleUnique('a[href="https://id.blooket.com/logout"]'))
          return true;
        // The real dashboard hides Logout while the account menu is closed.
        const profile = 'a[href="https://id.blooket.com/login"]';
        return visibleUnique(profile) &&
          Boolean(document.querySelector(profile)?.textContent?.trim());
      })();
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    const url = new URL(location.href);
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT" ||
        questions[0].getAttribute("type") !== "hidden")
      return false;
    const form = questions[0]!.closest("form");
    if (form?.tagName !== "FORM") return false;
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return false;
    return (
      url.origin === "https://dashboard.blooket.com" &&
      url.pathname === "/edit" &&
      !/[\x00-\x1f\x7f]/u.test(setId) &&
      url.searchParams.getAll("id").length === 1 &&
      url.searchParams.get("id") === setId &&
      document.querySelectorAll(
        'aside[data-drawer-open="true"]',
      ).length === 0
    );
  } catch {
    return false;
  }
}

export function closeBlooketCapabilityQuestionPanel(setId: string): boolean {
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        (text === undefined || elements[0]!.textContent?.trim() === text);
    };
    const authenticated =
      document.title !== "Just a moment..." &&
      document.querySelector('input[type="password"]') === null &&
      visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      (() => {
        const links = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/logout"]',
        ));
        if (links.length !== 1 || links[0]!.textContent?.trim() !== "Logout")
          return false;
        if (visibleUnique('a[href="https://id.blooket.com/logout"]'))
          return true;
        // The real dashboard hides Logout while the account menu is closed.
        const profile = 'a[href="https://id.blooket.com/login"]';
        return visibleUnique(profile) &&
          Boolean(document.querySelector(profile)?.textContent?.trim());
      })();
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean
      };
    }).__blooketCapabilityEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty) return false;
    const normalized = (element: Element) =>
      (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId ||
      document.querySelectorAll('aside[data-drawer-open="true"]').length !== 0
    )
      return false;
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT" ||
        questions[0].getAttribute("type") !== "hidden")
      return false;
    const form = questions[0]!.closest("form");
    if (form?.tagName !== "FORM") return false;
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return false;
    const cancels = Array.from(
      form.querySelectorAll('button[type="button"]'),
    ).filter((button) => normalized(button) === "Cancel");
    if (cancels.length !== 1) return false;
    const control = cancels[0] as HTMLButtonElement;
    const bounds = control.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || control.disabled ||
        control.getAttribute("aria-disabled") === "true") return false;
    control.click();
    const owned = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: { dispose: () => void };
    }).__blooketCapabilityEditWatch;
    owned?.dispose();
    return true;
  } catch {
    return false;
  }
}

export function isBlooketCapabilityQuestionPanelClosed(setId: string): boolean {
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        (text === undefined || elements[0]!.textContent?.trim() === text);
    };
    const authenticated =
      document.title !== "Just a moment..." &&
      document.querySelector('input[type="password"]') === null &&
      visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      (() => {
        const links = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/logout"]',
        ));
        if (links.length !== 1 || links[0]!.textContent?.trim() !== "Logout")
          return false;
        if (visibleUnique('a[href="https://id.blooket.com/logout"]'))
          return true;
        // The real dashboard hides Logout while the account menu is closed.
        const profile = 'a[href="https://id.blooket.com/login"]';
        return visibleUnique(profile) &&
          Boolean(document.querySelector(profile)?.textContent?.trim());
      })();
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    const url = new URL(location.href);
    return (
      url.origin === "https://dashboard.blooket.com" &&
      url.pathname === "/edit" &&
      !/[\x00-\x1f\x7f]/u.test(setId) &&
      url.searchParams.getAll("id").length === 1 &&
      url.searchParams.get("id") === setId &&
      document.querySelector('input#question[name="question"]') === null &&
      document.querySelectorAll('aside[data-drawer-open="true"]').length === 0
    );
  } catch {
    return false;
  }
}

export function blooketCapabilitySnapshotCandidate(
  verifiedOn: string,
  accountMedia: BlooketAccountMediaAvailability,
): unknown {
  return {
    schemaVersion: 3,
    verifiedOn,
    evidence: [
      {
        kind: "official-doc",
        reference: "Blooket Question Types Explained (retrieved 2026-10-05)",
      },
      {
        kind: "official-doc",
        reference:
          "Blooket How to Create a Question Set (retrieved 2026-10-05)",
      },
      {
        kind: "browser-observation",
        reference: "86784c3d4c38fcd559c92f38fbadd7a160947de2",
      },
      ...(accountMedia === "account-dependent"
        ? []
        : [{
            kind: "browser-observation",
            reference: "authenticated Add Question audio Plus gate",
          }]),
    ],
    questionTypes: {
      multipleChoice: {
        availability: "supported",
        minAnswers: 2,
        maxAnswers: 4,
        requiresQuestionText: true,
        allowsMultipleCorrect: true,
      },
      typingAnswer: {
        availability: "supported",
        matchModes: ["exact", "contains"],
      },
    },
    features: {
      questionImages: "supported",
      answerImages: accountMedia,
      audio: accountMedia,
    },
    setMetadata: {
      titleRequired: true,
      descriptionRequired: false,
      titleMaxLength: 75,
      descriptionMaxLength: 300,
      coverImageOptional: true,
      visibility: ["public", "private"],
    },
    upload: {
      maxBytes: 2_500_000,
      canvasWidth: null,
      canvasHeight: null,
      maxPixels: null,
    },
  };
}
