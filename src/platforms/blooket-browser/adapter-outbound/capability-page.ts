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
    const url = new URL(location.href);
    const path = url.pathname;
    // The Create Set page is itself a draft form, even when no control has
    // focus. A route change could silently discard the teacher's work.
    if (path === "/create") return false;
    // An owned opener can have clicked before React mounts its modal. DOM
    // absence alone never authorizes navigation over a pending read or write.
    // Property existence is read without invoking extension-world accessors.
    if ([
      "__blooketCapabilityEditWatch", "__blooketQuestionEditWatch",
      "__blooketAddQuestionFormWatch", "__blooketCreateSetWatch",
    ].some(key => Object.hasOwn(globalThis, key))) return false;
    if (path !== "/my-sets" && path !== "/edit" &&
        !path.startsWith("/set/")) return false;
    // Do not abandon a teacher-selected variant that may carry page state
    // not understood by the capability inspector.
    if (url.hash || (path === "/edit"
      ? url.searchParams.size !== 1 ||
        url.searchParams.getAll("id").length !== 1 ||
        !url.searchParams.get("id") ||
        url.searchParams.get("id")!.length > 512 ||
        /[\x00-\x1f\x7f]/u.test(url.searchParams.get("id")!)
      : Boolean(url.search))) return false;
    const visible = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;
      // Hidden consent dialogs can retain layout boxes. Computed visibility
      // includes inherited styles without dismissing any provider controls.
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" &&
        style.visibility !== "collapse";
    };
    const challenges = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    ));
    if (challenges.some(visible)) return false;
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
        active?.tagName === "SELECT" ||
        (active as HTMLElement | null)?.isContentEditable === true ||
        active?.getAttribute("contenteditable") === "true" ||
        active?.getAttribute("role") === "textbox") return false;
    return true;
  } catch {
    return false;
  }
}

export function openBlooketCapabilityQuestionPanel(setId: string): boolean {
  let clicked = false;
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      const style = getComputedStyle(elements[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
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
    if (!authenticated || blockedByOrganization || blockedByChallenge) {
      const pending = (globalThis as typeof globalThis & {
        __blooketCapabilityEditWatch?: {
          document: Document; dirty: boolean;
        };
      }).__blooketCapabilityEditWatch;
      if (pending?.document === document) pending.dirty = true;
      return false;
    }
    const normalized = (element: Element) =>
      (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      !setId ||
      setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.hash || url.searchParams.size !== 1 ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    )
      return false;
    if (document.querySelector('input#question[name="question"]') ||
        document.querySelector('aside[data-drawer-open="true"]')) return false;
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
    const style = getComputedStyle(control);
    if (bounds.width <= 0 || bounds.height <= 0 ||
        style.display === "none" || style.visibility !== "visible" ||
        control.disabled ||
        control.getAttribute("aria-disabled") === "true") return false;
    // Only this read may cancel the question form; any trusted human action
    // relinquishes ownership, including interactions in its Audio drawer.
    const world = globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document;
        setId: string;
        dirty: boolean;
        form?: Element;
        question?: Element;
        drawer?: Element;
        dispose: () => void;
      };
    };
    const previous = world.__blooketCapabilityEditWatch;
    // Repeated requests must never replace a pending owner whose opener
    // already ran in this document, even if the form is still hydrating.
    if (previous?.document === document) return false;
    previous?.dispose();
    const watch: NonNullable<typeof world.__blooketCapabilityEditWatch> = {
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
    clicked = true;
    control.click();
    return true;
  } catch {
    // A browser click may have opened the panel before its acknowledgement
    // failed. Throw a fixed failure so the host preserves the editor URL.
    if (clicked) throw new Error("browser-capability-open-unconfirmed");
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
      const style = getComputedStyle(elements[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
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
    if (!authenticated || blockedByOrganization || blockedByChallenge) {
      const pending = (globalThis as typeof globalThis & {
        __blooketCapabilityEditWatch?: {
          document: Document; dirty: boolean;
        };
      }).__blooketCapabilityEditWatch;
      if (pending?.document === document) pending.dirty = true;
      return false;
    }
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean;
        form?: Element; question?: Element; drawer?: Element;
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
      url.hash || url.searchParams.size !== 1 ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    ) {
      watch.dirty = true;
      return false;
    }
    const inputs = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    // A once-verified modal cannot vanish and later regain read ownership.
    if (watch.form && (inputs.length !== 1 ||
        inputs[0] !== watch.question ||
        inputs[0]?.getAttribute("type") !== "hidden")) {
      watch.dirty = true;
      return false;
    }
    if (inputs.length !== 1 || inputs[0]?.tagName !== "INPUT") return false;
    const question = inputs[0] as HTMLInputElement;
    if (question.getAttribute("type") !== "hidden") return false;
    const form = question.closest("form");
    if (!form || form.tagName !== "FORM") return false;
    const setIds = Array.from(
      form.querySelectorAll('input#setId[name="setId"]'),
    );
    // Changes to a previously verified set binding are not hydration.
    if (watch.form && (setIds.length !== 1 ||
        setIds[0]?.tagName !== "INPUT" ||
        setIds[0]?.getAttribute("type") !== "hidden" ||
        (setIds[0] as HTMLInputElement).value !== setId)) {
      watch.dirty = true;
      return false;
    }
    if (setIds.length !== 1 || setIds[0]?.tagName !== "INPUT" ||
        setIds[0].getAttribute("type") !== "hidden" ||
        (setIds[0] as HTMLInputElement).value !== setId) return false;
    if (watch.form && (watch.form !== form ||
        watch.question !== question)) {
      watch.dirty = true;
      return false;
    }
    // A hidden or missing Cancel would leave a read-owned panel stranded.
    // Do not bind readiness until the panel can safely be relinquished.
    const cancels = Array.from(form.querySelectorAll(
      'button[type="button"]',
    )).filter(button => button.textContent?.replace(/\s+/gu, " ").trim() ===
      "Cancel");
    if (cancels.length !== 1 || cancels[0]?.tagName !== "BUTTON")
      return false;
    const cancel = cancels[0] as HTMLButtonElement;
    const bounds = cancel.getBoundingClientRect();
    const style = getComputedStyle(cancel);
    if (bounds.width <= 0 || bounds.height <= 0 ||
        style.display === "none" || style.visibility !== "visible" ||
        cancel.disabled || cancel.getAttribute("aria-disabled") === "true")
      return false;
    // The first verified panel becomes the only owned read-only form.
    watch.form = form;
    watch.question = question;
    return true;
  } catch {
    return false;
  }
}

export function openBlooketAudioCapabilityDrawer(setId: string): boolean {
  let clicked = false;
  try {
    // Independently enforce the session and human-stop boundary on this tab.
    // Chrome serializes this function without shared module helpers.
    const visibleUnique = (selector: string, text?: string): boolean => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length !== 1) return false;
      const bounds = elements[0]!.getBoundingClientRect();
      const style = getComputedStyle(elements[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
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
    if (!authenticated || blockedByOrganization || blockedByChallenge) {
      const pending = (globalThis as typeof globalThis & {
        __blooketCapabilityEditWatch?: {
          document: Document; dirty: boolean;
        };
      }).__blooketCapabilityEditWatch;
      if (pending?.document === document) pending.dirty = true;
      return false;
    }
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean;
        form?: Element; question?: Element; drawer?: Element;
        audioOpened?: boolean;
      };
    }).__blooketCapabilityEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty || watch.audioOpened || !watch.form || !watch.question)
      return false;
    const normalized = (element: Element) =>
      (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.hash || url.searchParams.size !== 1 ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId ||
      document.querySelectorAll('aside[data-drawer-open="true"]').length !== 0
    ) {
      watch.dirty = true;
      return false;
    }
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    // A once-verified modal cannot vanish and later regain read ownership.
    if (watch.form && (questions.length !== 1 ||
        questions[0] !== watch.question ||
        questions[0]?.getAttribute("type") !== "hidden")) {
      watch.dirty = true;
      return false;
    }
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT")
      return false;
    const question = questions[0]!;
    if (question.getAttribute("type") !== "hidden") return false;
    const form = question.closest("form");
    if (form?.tagName !== "FORM") return false;
    if (watch.form && (watch.form !== form ||
        watch.question !== questions[0])) {
      watch.dirty = true;
      return false;
    }
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    // Changes to a previously verified set binding are not hydration.
    if (watch.form && (identities.length !== 1 ||
        identities[0]?.tagName !== "INPUT" ||
        identities[0]?.getAttribute("type") !== "hidden" ||
        (identities[0] as HTMLInputElement).value !== setId)) {
      watch.dirty = true;
      return false;
    }
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
    const style = getComputedStyle(control);
    if (bounds.width <= 0 || bounds.height <= 0 ||
        style.display === "none" || style.visibility !== "visible" ||
        control.disabled ||
        control.getAttribute("aria-disabled") === "true") return false;
    // Latch before the browser click. Lost acknowledgements must not
    // reopen or toggle a drawer while its first render is still pending.
    watch.audioOpened = true;
    clicked = true;
    control.click();
    return true;
  } catch {
    if (clicked) throw new Error("browser-capability-audio-open-unconfirmed");
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
      const style = getComputedStyle(elements[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
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
    if (!authenticated || blockedByOrganization || blockedByChallenge) {
      const pending = (globalThis as typeof globalThis & {
        __blooketCapabilityEditWatch?: {
          document: Document; dirty: boolean;
        };
      }).__blooketCapabilityEditWatch;
      if (pending?.document === document) pending.dirty = true;
      return failed();
    }
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean;
        form?: Element; question?: Element; drawer?: Element;
        audioOpened?: boolean;
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
      url.hash || url.searchParams.size !== 1 ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    ) {
      watch.dirty = true;
      return failed();
    }
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    // A once-verified modal cannot vanish and later regain read ownership.
    if (watch.form && (questions.length !== 1 ||
        questions[0] !== watch.question ||
        questions[0]?.getAttribute("type") !== "hidden")) {
      watch.dirty = true;
      return failed();
    }
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT" ||
        questions[0].getAttribute("type") !== "hidden")
      return failed();
    const form = questions[0]!.closest("form");
    if (form?.tagName !== "FORM") return failed();
    if (watch.form && (watch.form !== form ||
        watch.question !== questions[0])) {
      watch.dirty = true;
      return failed();
    }
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    // Changes to a previously verified set binding are not hydration.
    if (watch.form && (identities.length !== 1 ||
        identities[0]?.tagName !== "INPUT" ||
        identities[0]?.getAttribute("type") !== "hidden" ||
        (identities[0] as HTMLInputElement).value !== setId)) {
      watch.dirty = true;
      return failed();
    }
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return failed();
    if (!watch.audioOpened || !watch.form || !watch.question)
      return failed();

    const drawers = Array.from(
      document.querySelectorAll('aside[data-drawer-open="true"]'),
    );
    if (drawers.length !== 1) return failed();
    const drawer = drawers[0]!;
    const drawerBounds = drawer.getBoundingClientRect();
    const drawerStyle = getComputedStyle(drawer);
    if (drawerBounds.width <= 0 || drawerBounds.height <= 0 ||
        drawerStyle.display === "none" ||
        drawerStyle.visibility !== "visible") return failed();
    if (watch.drawer && watch.drawer !== drawer) {
      watch.dirty = true;
      return failed();
    }
    const titles = Array.from(drawer.querySelectorAll("span"))
      // The live upsell repeats its title inside the subscription link.
      // Interactive labels are not drawer headings; duplicate headings stop.
      .filter((span) => !span.closest("a") && !span.closest("button"))
      .filter((span) => {
        const bounds = span.getBoundingClientRect();
        const style = getComputedStyle(span);
        return bounds.width > 0 && bounds.height > 0 &&
          style.display !== "none" && style.visibility === "visible";
      })
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
      if (!exactUpsell || audioInputs.length !== 0) return failed();
      watch.drawer = drawer;
      return { ok: true, value: "unsupported" };
    }
    if (audioInputs.length !== 1 || audioInputs[0]?.tagName !== "INPUT" ||
        (audioInputs[0] as HTMLInputElement).disabled) return failed();
    watch.drawer = drawer;
    return { ok: true, value: "supported" };
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
      const style = getComputedStyle(elements[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
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
    if (!authenticated || blockedByOrganization || blockedByChallenge) {
      const pending = (globalThis as typeof globalThis & {
        __blooketCapabilityEditWatch?: {
          document: Document; dirty: boolean;
        };
      }).__blooketCapabilityEditWatch;
      if (pending?.document === document) pending.dirty = true;
      return false;
    }
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean;
        form?: Element; question?: Element; drawer?: Element;
        audioOpened?: boolean; audioCancelled?: boolean;
      };
    }).__blooketCapabilityEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty || watch.audioCancelled) return false;
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.hash || url.searchParams.size !== 1 ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    ) {
      watch.dirty = true;
      return false;
    }
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    // A once-verified modal cannot vanish and later regain read ownership.
    if (watch.form && (questions.length !== 1 ||
        questions[0] !== watch.question ||
        questions[0]?.getAttribute("type") !== "hidden")) {
      watch.dirty = true;
      return false;
    }
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT" ||
        questions[0].getAttribute("type") !== "hidden")
      return false;
    const form = questions[0]!.closest("form");
    if (form?.tagName !== "FORM") return false;
    if (watch.form && (watch.form !== form ||
        watch.question !== questions[0])) {
      watch.dirty = true;
      return false;
    }
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    // Changes to a previously verified set binding are not hydration.
    if (watch.form && (identities.length !== 1 ||
        identities[0]?.tagName !== "INPUT" ||
        identities[0]?.getAttribute("type") !== "hidden" ||
        (identities[0] as HTMLInputElement).value !== setId)) {
      watch.dirty = true;
      return false;
    }
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return false;
    if (!watch.audioOpened || !watch.form || !watch.question)
      return false;

    const drawers = Array.from(
      document.querySelectorAll('aside[data-drawer-open="true"]'),
    );
    if (drawers.length !== 1) return false;
    if (watch.drawer && watch.drawer !== drawers[0]) {
      watch.dirty = true;
      return false;
    }
    const cancels = Array.from(
      drawers[0]!.querySelectorAll('button[aria-label="Cancel"]'),
    );
    if (cancels.length !== 1) return false;
    const control = cancels[0] as HTMLButtonElement;
    const bounds = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    if (bounds.width <= 0 || bounds.height <= 0 ||
        style.display === "none" || style.visibility !== "visible" ||
        control.disabled ||
        control.getAttribute("aria-disabled") === "true") return false;
    // A lost Cancel acknowledgement must not trigger a second click.
    watch.audioCancelled = true;
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
      const style = getComputedStyle(elements[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
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
    if (!authenticated || blockedByOrganization || blockedByChallenge) {
      const pending = (globalThis as typeof globalThis & {
        __blooketCapabilityEditWatch?: {
          document: Document; dirty: boolean;
        };
      }).__blooketCapabilityEditWatch;
      if (pending?.document === document) pending.dirty = true;
      return false;
    }
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean;
        form?: Element; question?: Element; drawer?: Element;
        audioOpened?: boolean; audioCancelled?: boolean;
      };
    }).__blooketCapabilityEditWatch;
    // Absence alone cannot prove cleanup of an opener whose drawer may
    // still hydrate. Only the owned one-click Cancel authorizes closure.
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty) return false;
    const url = new URL(location.href);
    if (url.origin !== "https://dashboard.blooket.com" ||
        url.pathname !== "/edit" || url.hash ||
        url.searchParams.size !== 1 ||
        url.searchParams.getAll("id").length !== 1 ||
        url.searchParams.get("id") !== setId) {
      watch.dirty = true;
      return false;
    }
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    // A once-verified modal cannot vanish and later regain read ownership.
    if (watch.form && (questions.length !== 1 ||
        questions[0] !== watch.question ||
        questions[0]?.getAttribute("type") !== "hidden")) {
      watch.dirty = true;
      return false;
    }
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT" ||
        questions[0].getAttribute("type") !== "hidden")
      return false;
    const form = questions[0]!.closest("form");
    if (form?.tagName !== "FORM") return false;
    if (watch.form && (watch.form !== form ||
        watch.question !== questions[0])) {
      watch.dirty = true;
      return false;
    }
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    // Changes to a previously verified set binding are not hydration.
    if (watch.form && (identities.length !== 1 ||
        identities[0]?.tagName !== "INPUT" ||
        identities[0]?.getAttribute("type") !== "hidden" ||
        (identities[0] as HTMLInputElement).value !== setId)) {
      watch.dirty = true;
      return false;
    }
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return false;
    // A drawer that has not been canceled can still hydrate after this read.
    if (!watch.audioOpened || !watch.audioCancelled ||
        !watch.form || !watch.question) return false;

    return (
      url.origin === "https://dashboard.blooket.com" &&
      url.pathname === "/edit" &&
      !/[\x00-\x1f\x7f]/u.test(setId) &&
      !url.hash && url.searchParams.size === 1 &&
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
      const style = getComputedStyle(elements[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
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
    if (!authenticated || blockedByOrganization || blockedByChallenge) {
      const pending = (globalThis as typeof globalThis & {
        __blooketCapabilityEditWatch?: {
          document: Document; dirty: boolean;
        };
      }).__blooketCapabilityEditWatch;
      if (pending?.document === document) pending.dirty = true;
      return false;
    }
    const watch = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean;
        form?: Element; question?: Element; drawer?: Element;
        questionCancelled?: boolean;
      };
    }).__blooketCapabilityEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty || watch.questionCancelled) return false;
    const normalized = (element: Element) =>
      (element.textContent ?? "").replace(/\s+/gu, " ").trim();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.hash || url.searchParams.size !== 1 ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId ||
      document.querySelectorAll('aside[data-drawer-open="true"]').length !== 0
    ) {
      watch.dirty = true;
      return false;
    }
    const questions = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    // A once-verified modal cannot vanish and later regain read ownership.
    if (watch.form && (questions.length !== 1 ||
        questions[0] !== watch.question ||
        questions[0]?.getAttribute("type") !== "hidden")) {
      watch.dirty = true;
      return false;
    }
    if (questions.length !== 1 || questions[0]?.tagName !== "INPUT" ||
        questions[0].getAttribute("type") !== "hidden")
      return false;
    const form = questions[0]!.closest("form");
    if (form?.tagName !== "FORM") return false;
    if (watch.form && (watch.form !== form ||
        watch.question !== questions[0])) {
      watch.dirty = true;
      return false;
    }
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    // Changes to a previously verified set binding are not hydration.
    if (watch.form && (identities.length !== 1 ||
        identities[0]?.tagName !== "INPUT" ||
        identities[0]?.getAttribute("type") !== "hidden" ||
        (identities[0] as HTMLInputElement).value !== setId)) {
      watch.dirty = true;
      return false;
    }
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
    const style = getComputedStyle(control);
    if (bounds.width <= 0 || bounds.height <= 0 ||
        style.display === "none" || style.visibility !== "visible" ||
        control.disabled ||
        control.getAttribute("aria-disabled") === "true") return false;
    // A lost Cancel acknowledgement must not trigger a second click.
    watch.questionCancelled = true;
    control.click();
    // Retain trusted-human event ownership until the panel is really gone.
    // A Cancel click is not a verified browser cleanup receipt.
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
      const style = getComputedStyle(elements[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
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
    if (!authenticated || blockedByOrganization || blockedByChallenge) {
      const pending = (globalThis as typeof globalThis & {
        __blooketCapabilityEditWatch?: {
          document: Document; dirty: boolean;
        };
      }).__blooketCapabilityEditWatch;
      if (pending?.document === document) pending.dirty = true;
      return false;
    }
    const pending = (globalThis as typeof globalThis & {
      __blooketCapabilityEditWatch?: {
        document: Document; setId: string; dirty: boolean;
        questionCancelled?: boolean; dispose: () => void;
      };
    }).__blooketCapabilityEditWatch;
    if (!pending || pending.document !== document ||
        pending.setId !== setId || pending.dirty ||
        !pending.questionCancelled) return false;
    const url = new URL(location.href);
    const closed = (
      url.origin === "https://dashboard.blooket.com" &&
      url.pathname === "/edit" &&
      !/[\x00-\x1f\x7f]/u.test(setId) &&
      !url.hash && url.searchParams.size === 1 &&
      url.searchParams.getAll("id").length === 1 &&
      url.searchParams.get("id") === setId &&
      document.querySelector('input#question[name="question"]') === null &&
      document.querySelectorAll('aside[data-drawer-open="true"]').length === 0
    );
    if (closed) pending.dispose();
    return closed;
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
