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
//   - Preparation and post-submit observation for the observed Create Set form.
// - Must-Not:
//   - Submit the form, read React internals, upload media, or infer success.
// - Allows:
//   - Inputs: Exact text/private submission facts on the dashboard create page.
//   - Outputs: Prepared-state acknowledgement or observed created set identity.
//   - Side effects: Updates observed form controls without clicking submit.
// - Split-When:
//   - Media-backed creation requires independently verified upload mechanics.
// - Merge-When:
//   - Blooket exposes a stable provider-owned Create Set API.
// - Summary:
//   - Fills the observed create form and separately observes success
//     navigation.
// - Description:
//   - Successful creation is only observed from the provider's edit redirect.
// - Usage:
//   - Execute prepare before one explicit submit; observe only after
//     navigation.
// - Defaults:
//   - Wrong route, ambiguous controls, media, and malformed values fail closed.
//
export interface BlooketCreateSetPageInput {
  readonly title: string;
  readonly description: string;
  readonly private: boolean;
}

export type BlooketCreateSetPrepareResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

export type BlooketCreateSetObservation =
  | { readonly ok: true; readonly remoteSetId: string }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

export function prepareBlooketCreateSetForm(
  input: BlooketCreateSetPageInput,
): BlooketCreateSetPrepareResult {
  const failed = (): BlooketCreateSetPrepareResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    // Each Chrome-injected step must still own a confirmed dashboard shell.
    // The account menu may hide Logout while the signed-in page stays live.
    const visibleUnique = (selector: string): boolean => {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length !== 1) return false;
      const bounds = nodes[0]!.getBoundingClientRect();
      const style = getComputedStyle(nodes[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible";
    };
    const logoutSelector = 'a[href="https://id.blooket.com/logout"]';
    const logout = Array.from(document.querySelectorAll(logoutSelector));
    const accountSelector = 'a[href="https://id.blooket.com/login"]';
    const authenticated = visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      logout.length === 1 && logout[0]!.textContent?.trim() === "Logout" &&
      (visibleUnique(logoutSelector) ||
        (visibleUnique(accountSelector) &&
          !!document.querySelector(accountSelector)?.textContent?.trim()));
    if (!authenticated) return failed();
    // Chrome executes each function in isolation. The prior preparation
    // cannot authorize a click behind a newly mounted human/security stop.
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        heading.textContent?.trim() === "Select your organization";
    });
    if (document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]') !== null ||
        blockedByChallenge || blockedByOrganization)
      return failed();
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/create" || location.search || location.hash ||
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 1_000 || /[\r\n]/u.test(input.title) ||
      input.title.includes("\0") ||
      typeof input.description !== "string" ||
      input.description.length > 10_000 ||
      input.description.includes("\0") ||
      typeof input.private !== "boolean"
    )
      return failed();

    const forms = Array.from(document.querySelectorAll(
      "form#question-set-form",
    ));
    if (forms.length !== 1 || forms[0]?.tagName !== "FORM")
      return failed();
    const form = forms[0];
    // This must be checked inside the same injected click/fill operation:
    // a separate host preflight cannot close the human-input race window.
    const watch = (globalThis as typeof globalThis & {
      __blooketCreateSetWatch?: {
        document: Document; form: Element; dirty: boolean; submitted: boolean;
        privacyChangeTarget?: HTMLInputElement;
      };
    }).__blooketCreateSetWatch;
    if (!watch || watch.document !== document ||
        watch.form !== form || watch.dirty || watch.submitted ||
        !form.isConnected)
      return failed();
    const titles = Array.from(form.querySelectorAll(
      'input#title[name="title"]',
    ));
    const descriptions = Array.from(form.querySelectorAll(
      'textarea#desc[name="desc"]',
    ));
    const switches = Array.from(form.querySelectorAll(
      'input#private[name="private"]',
    ));
    const title = titles[0];
    const description = descriptions[0];
    const privacy = switches[0];
    if (
      titles.length !== 1 || descriptions.length !== 1 ||
      switches.length !== 1 ||
      title?.tagName !== "INPUT" ||
      description?.tagName !== "TEXTAREA" ||
      privacy?.tagName !== "INPUT" ||
      privacy.getAttribute("type") !== "checkbox" ||
      privacy.getAttribute("role") !== "switch"
    ) return failed();

    const buttons = Array.from(form.querySelectorAll("button")).filter(
      (button) => button.textContent?.trim() === "Create Set",
    );
    // Blooket disables Create Set while the fresh required title is empty.
    // Preparation may fill that title; intact() below still requires the same
    // enabled button after input, and submission independently checks it.
    if (buttons.length !== 1 || buttons[0]?.tagName !== "BUTTON" ||
        buttons[0]?.getAttribute("aria-disabled") === "true")
      return failed();
    const submitStyle = getComputedStyle(buttons[0]!);
    const submitBounds = buttons[0]!.getBoundingClientRect();
    if (submitBounds.width <= 0 || submitBounds.height <= 0 ||
        submitStyle.display === "none" ||
        submitStyle.visibility !== "visible") return failed();

    const titleInput = title as HTMLInputElement;
    const descriptionInput = description as HTMLTextAreaElement;
    const privacyInput = privacy as HTMLInputElement;
    const readyControl = (element: Element): boolean => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible";
    };
    if (!readyControl(form) || !readyControl(titleInput) ||
        !readyControl(descriptionInput)) return failed();
    const privacyBounds = privacyInput.getBoundingClientRect();
    const privacyStyle = getComputedStyle(privacyInput);
    if (privacyBounds.width <= 0 || privacyBounds.height <= 0 ||
        privacyStyle.display === "none" ||
        privacyStyle.visibility !== "visible" || privacyInput.disabled ||
        privacyInput.getAttribute("aria-disabled") === "true")
      return failed();
    // Recovered module 31017 puts the current privacy words in a direct
    // <p> beside the switch, not inside its associated toggle label.
    const rows = Array.from(privacyInput.labels ?? [])
      .filter(label => label.tagName === "LABEL")
      .map(label => label.parentElement?.tagName === "SPAN"
        ? label.parentElement.parentElement : label.parentElement)
      .filter(row => row?.tagName === "DIV" &&
        row.querySelectorAll(":scope > p").length === 1);
    if (rows.length !== 1) return failed();
    const paragraph = rows[0]!.querySelectorAll(":scope > p")[0]!;
    const stateBounds = paragraph.getBoundingClientRect();
    const rowBounds = rows[0]!.getBoundingClientRect();
    const paragraphStyle = getComputedStyle(paragraph);
    const rowStyle = getComputedStyle(rows[0]!);
    if (paragraph.tagName !== "P" || stateBounds.width <= 0 ||
        stateBounds.height <= 0 || rowBounds.width <= 0 ||
        rowBounds.height <= 0 ||
        paragraphStyle.display === "none" ||
        paragraphStyle.visibility !== "visible" ||
        rowStyle.display === "none" ||
        rowStyle.visibility !== "visible") return failed();
    const state = paragraph.textContent?.replace(/\s+/gu, " ").trim();
    const ariaChecked = privacyInput.getAttribute("aria-checked");
    const currentPrivate =
      ariaChecked === "false" &&
      state === "Private (Only playable by you)"
        ? true
        : ariaChecked === "true" &&
            state === "Public (Playable by everyone)"
          ? false
          : undefined;
    if (currentPrivate === undefined) return failed();

    const intact = (expectedPrivate: boolean): boolean => {
      if (location.origin !== "https://dashboard.blooket.com" ||
          location.pathname !== "/create" || location.search ||
          location.hash || document.title === "Just a moment..." ||
          document.querySelector('input[type="password"]') ||
          watch.document !== document || watch.form !== form ||
          watch.dirty || watch.submitted || !form.isConnected ||
          document.querySelectorAll("form#question-set-form").length !== 1 ||
          document.querySelector("form#question-set-form") !== form ||
          form.querySelectorAll('input#title[name="title"]').length !== 1 ||
          form.querySelector('input#title[name="title"]') !== titleInput ||
          form.querySelectorAll('textarea#desc[name="desc"]').length !== 1 ||
          form.querySelector('textarea#desc[name="desc"]') !==
            descriptionInput ||
          form.querySelectorAll('input#private[name="private"]').length !== 1 ||
          form.querySelector('input#private[name="private"]') !==
            privacyInput ||
          !readyControl(form) || !readyControl(titleInput) ||
          !readyControl(descriptionInput) || !readyControl(privacyInput) ||
          privacyInput.disabled ||
          privacyInput.getAttribute("aria-disabled") === "true" ||
          document.querySelectorAll(logoutSelector).length !== 1 ||
          document.querySelector(logoutSelector)?.textContent?.trim() !==
            "Logout" ||
          !readyControl(rows[0]!) || !readyControl(paragraph) ||
          Array.from(privacyInput.labels ?? []).filter(label =>
            label.tagName === "LABEL" &&
            (label.parentElement?.tagName === "SPAN"
              ? label.parentElement.parentElement : label.parentElement)
              === rows[0]).length !== 1 ||
          rows[0]!.querySelectorAll(":scope > p").length !== 1 ||
          rows[0]!.querySelector(":scope > p") !== paragraph ||
          (expectedPrivate
            ? privacyInput.getAttribute("aria-checked") !== "false" ||
              paragraph.textContent?.trim() !==
                "Private (Only playable by you)"
            : privacyInput.getAttribute("aria-checked") !== "true" ||
              paragraph.textContent?.trim() !==
                "Public (Playable by everyone)")) return false;
      if (Array.from(document.querySelectorAll(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
      )).some(readyControl) || Array.from(document.querySelectorAll(
        '[role="dialog"][aria-modal="true"] h3',
      )).some(node => readyControl(node) &&
        node.textContent?.trim() === "Select your organization"))
        return false;
      const currentButtons = Array.from(form.querySelectorAll("button"))
        .filter(button => button.textContent?.trim() === "Create Set");
      if (currentButtons.length !== 1 || currentButtons[0] !== buttons[0] ||
          !readyControl(buttons[0]!) ||
          (buttons[0] as HTMLButtonElement).disabled ||
          buttons[0]!.getAttribute("aria-disabled") === "true") return false;
      return visibleUnique("main") &&
        visibleUnique('nav a[href="/my-sets"]') &&
        document.querySelectorAll(logoutSelector).length === 1 &&
        (visibleUnique(logoutSelector) ||
          (visibleUnique(accountSelector) &&
            !!document.querySelector(accountSelector)?.textContent?.trim()));
    };

    const setValue = (
      element: HTMLInputElement | HTMLTextAreaElement,
      value: string,
    ) => {
      const prototype = element.tagName === "INPUT"
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set === undefined)
        throw new Error("browser-control-unavailable");
      descriptor.set.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };

    setValue(titleInput, input.title);
    if (!intact(currentPrivate) || titleInput.value !== input.title)
      return failed();
    setValue(descriptionInput, input.description);
    if (!intact(currentPrivate) || titleInput.value !== input.title ||
        descriptionInput.value !== input.description) return failed();
    if (currentPrivate !== input.private) {
      // Checkbox activation fires trusted input/change even for click().
      // Own only these synchronous events on this exact privacy control.
      watch.privacyChangeTarget = privacyInput;
      try { privacyInput.click(); }
      finally { delete watch.privacyChangeTarget; }
    }
    if (!intact(input.private) || titleInput.value !== input.title ||
        descriptionInput.value !== input.description) return failed();
    return { ok: true };
  } catch {
    return failed();
  }
}

export function submitBlooketCreateSetForm(
  expected: BlooketCreateSetPageInput,
): BlooketCreateSetPrepareResult {
  const failed = (): BlooketCreateSetPrepareResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    // Each Chrome-injected step must still own a confirmed dashboard shell.
    // The account menu may hide Logout while the signed-in page stays live.
    const visibleUnique = (selector: string): boolean => {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length !== 1) return false;
      const bounds = nodes[0]!.getBoundingClientRect();
      const style = getComputedStyle(nodes[0]!);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible";
    };
    const logoutSelector = 'a[href="https://id.blooket.com/logout"]';
    const logout = Array.from(document.querySelectorAll(logoutSelector));
    const accountSelector = 'a[href="https://id.blooket.com/login"]';
    const authenticated = visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      logout.length === 1 && logout[0]!.textContent?.trim() === "Logout" &&
      (visibleUnique(logoutSelector) ||
        (visibleUnique(accountSelector) &&
          !!document.querySelector(accountSelector)?.textContent?.trim()));
    if (!authenticated) return failed();
    // Chrome executes each function in isolation. The prior preparation
    // cannot authorize a click behind a newly mounted human/security stop.
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        heading.textContent?.trim() === "Select your organization";
    });
    if (document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]') !== null ||
        blockedByChallenge || blockedByOrganization)
      return failed();
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/create" || location.search || location.hash ||
      typeof expected.title !== "string" || !expected.title.trim() ||
      expected.title.length > 1_000 || /[\r\n]/u.test(expected.title) ||
      expected.title.includes("\0") ||
      typeof expected.description !== "string" ||
      expected.description.length > 10_000 ||
      expected.description.includes("\0") ||
      typeof expected.private !== "boolean"
    )
      return failed();
    const forms = Array.from(document.querySelectorAll(
      "form#question-set-form",
    ));
    if (forms.length !== 1 || forms[0]?.tagName !== "FORM")
      return failed();
    const form = forms[0];
    // This must be checked inside the same injected click/fill operation:
    // a separate host preflight cannot close the human-input race window.
    const watch = (globalThis as typeof globalThis & {
      __blooketCreateSetWatch?: {
        document: Document; form: Element; dirty: boolean; submitted: boolean;
      };
    }).__blooketCreateSetWatch;
    if (!watch || watch.document !== document ||
        watch.form !== form || watch.dirty || watch.submitted ||
        !form.isConnected)
      return failed();
    const titles = Array.from(form.querySelectorAll(
      'input#title[name="title"]',
    ));
    const descriptions = Array.from(form.querySelectorAll(
      'textarea#desc[name="desc"]',
    ));
    const switches = Array.from(form.querySelectorAll(
      'input#private[name="private"]',
    ));
    const title = titles[0];
    const description = descriptions[0];
    const privacy = switches[0];
    if (
      titles.length !== 1 || descriptions.length !== 1 ||
      switches.length !== 1 || title?.tagName !== "INPUT" ||
      description?.tagName !== "TEXTAREA" ||
      privacy?.tagName !== "INPUT" ||
      privacy.getAttribute("type") !== "checkbox" ||
      privacy.getAttribute("role") !== "switch"
    ) return failed();

    const titleInput = title as HTMLInputElement;
    const descriptionInput = description as HTMLTextAreaElement;
    const privacyInput = privacy as HTMLInputElement;
    const readyControl = (element: Element): boolean => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible";
    };
    if (!readyControl(form) || !readyControl(titleInput) ||
        !readyControl(descriptionInput)) return failed();
    const privacyBounds = privacyInput.getBoundingClientRect();
    const privacyStyle = getComputedStyle(privacyInput);
    if (privacyBounds.width <= 0 || privacyBounds.height <= 0 ||
        privacyStyle.display === "none" ||
        privacyStyle.visibility !== "visible" || privacyInput.disabled ||
        privacyInput.getAttribute("aria-disabled") === "true")
      return failed();
    // Recovered module 31017 puts the current privacy words in a direct
    // <p> beside the switch, not inside its associated toggle label.
    const rows = Array.from(privacyInput.labels ?? [])
      .filter(label => label.tagName === "LABEL")
      .map(label => label.parentElement?.tagName === "SPAN"
        ? label.parentElement.parentElement : label.parentElement)
      .filter(row => row?.tagName === "DIV" &&
        row.querySelectorAll(":scope > p").length === 1);
    if (rows.length !== 1) return failed();
    const paragraph = rows[0]!.querySelectorAll(":scope > p")[0]!;
    const stateBounds = paragraph.getBoundingClientRect();
    const rowBounds = rows[0]!.getBoundingClientRect();
    const paragraphStyle = getComputedStyle(paragraph);
    const rowStyle = getComputedStyle(rows[0]!);
    if (paragraph.tagName !== "P" || stateBounds.width <= 0 ||
        stateBounds.height <= 0 || rowBounds.width <= 0 ||
        rowBounds.height <= 0 ||
        paragraphStyle.display === "none" ||
        paragraphStyle.visibility !== "visible" ||
        rowStyle.display === "none" ||
        rowStyle.visibility !== "visible") return failed();
    const state = paragraph.textContent?.replace(/\s+/gu, " ").trim();
    const ariaChecked = privacyInput.getAttribute("aria-checked");
    const currentPrivate =
      ariaChecked === "false" &&
      state === "Private (Only playable by you)"
        ? true
        : ariaChecked === "true" &&
            state === "Public (Playable by everyone)"
          ? false
          : undefined;
    if (
      currentPrivate === undefined ||
      titleInput.value !== expected.title ||
      descriptionInput.value !== expected.description ||
      currentPrivate !== expected.private
    )
      return failed();

    const buttons = Array.from(form.querySelectorAll("button")).filter(
      (button) => button.textContent?.trim() === "Create Set",
    );
    if (buttons.length !== 1 || buttons[0]?.tagName !== "BUTTON")
      return failed();
    const submit = buttons[0] as HTMLButtonElement;
    const bounds = submit.getBoundingClientRect();
    const style = getComputedStyle(submit);
    if (bounds.width <= 0 || bounds.height <= 0 ||
        style.display === "none" || style.visibility !== "visible" ||
        submit.disabled ||
        submit.getAttribute("aria-disabled") === "true")
      return failed();
    // A lost click acknowledgement must never authorize a second submit.
    watch.submitted = true;
    submit.click();
    return { ok: true };
  } catch {
    return failed();
  }
}

export function observeBlooketCreateSetSuccess():
  BlooketCreateSetObservation {
  const failed = (): BlooketCreateSetObservation => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    // A provider interstitial can retain the previous edit URL while the
    // authenticated controls are unavailable. Its URL is not a receipt.
    const challenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    const organization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        heading.textContent?.trim() === "Select your organization";
    });
    if (document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]') !== null ||
        challenge || organization)
      return failed();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" || url.hash ||
      url.searchParams.size !== 1
    )
      return failed();
    const id = url.searchParams.get("id");
    if (
      !id ||
      id.length > 512 ||
      id.includes("\0") ||
      url.searchParams.getAll("id").length !== 1
    )
      return failed();
    return { ok: true, remoteSetId: id };
  } catch {
    return failed();
  }
}

// Claim only a freshly navigated form and relinquish ownership immediately
// upon any genuine user input. Both steps run in Chrome's isolated world.
export function runBlooketCreateSetOwnership(
  action: "claim" | "check",
): boolean {
  try {
    const revoke = (): false => {
      const owned = (globalThis as typeof globalThis & {
        __blooketCreateSetWatch?: { document: Document; dirty: boolean };
      }).__blooketCreateSetWatch;
      if (owned?.document === document) owned.dirty = true;
      return false;
    };
    if (location.origin !== "https://dashboard.blooket.com" ||
        location.pathname !== "/create" || location.search || location.hash ||
        document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]')) return revoke();
    const dialogs = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"]',
    ));
    const visibleStop = (node: Element): boolean => {
      const bounds = node.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return false;
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility === "visible";
    };
    const challenged = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some(visibleStop);
    if (dialogs.some(visibleStop) || challenged) return revoke();
    const forms = Array.from(document.querySelectorAll(
      "form#question-set-form",
    ));
    if (forms.length !== 1 || forms[0]?.tagName !== "FORM")
      return revoke();
    const form = forms[0] as HTMLFormElement;
    if (!form.isConnected) return revoke();
    const world = globalThis as typeof globalThis & {
      __blooketCreateSetWatch?: {
        document: Document;
        form: HTMLFormElement;
        dirty: boolean;
        submitted: boolean;
        privacyChangeTarget?: HTMLInputElement;
        dispose: () => void;
      };
    };
    const previous = world.__blooketCreateSetWatch;
    if (action === "check")
      return !!previous && previous.document === document &&
        previous.form === form && !previous.dirty && !previous.submitted
        ? true : revoke();
    if (action !== "claim") return false;
    // A still-mounted form was already claimed: never reassign a pending
    // submission or silently discard teacher interactions.
    if (previous && previous.form.isConnected) return false;
    // The form might have been filled before the extension installed its
    // input watch. Never adopt or overwrite existing teacher draft text.
    const titles = Array.from(form.querySelectorAll(
      'input#title[name="title"]',
    ));
    const descriptions = Array.from(form.querySelectorAll(
      'textarea#desc[name="desc"]',
    ));
    if (titles.length !== 1 || titles[0]?.tagName !== "INPUT" ||
        descriptions.length !== 1 ||
        descriptions[0]?.tagName !== "TEXTAREA" ||
        (titles[0] as HTMLInputElement).value !== "" ||
        (descriptions[0] as HTMLTextAreaElement).value !== "")
      return false;
    previous?.dispose();
    const watch: NonNullable<typeof world.__blooketCreateSetWatch> = {
      document, form, dirty: false, submitted: false, dispose: () => {},
    };
    const types = ["pointerdown", "keydown", "input", "change"];
    const onInteraction = (event: Event) => {
      const ownedPrivacyChange = watch.privacyChangeTarget !== undefined &&
        event.target === watch.privacyChangeTarget &&
        (event.type === "input" || event.type === "change");
      if (event.isTrusted && !ownedPrivacyChange) watch.dirty = true;
    };
    let observer: MutationObserver | undefined;
    watch.dispose = () => {
      for (const type of types)
        watch.document.removeEventListener(type, onInteraction, true);
      observer?.disconnect();
      if (world.__blooketCreateSetWatch === watch)
        delete world.__blooketCreateSetWatch;
    };
    try {
      for (const type of types)
        document.addEventListener(type, onInteraction, true);
      observer = new MutationObserver(() => {
        if (!watch.form.isConnected) watch.dispose();
      });
      observer.observe(document, { childList: true, subtree: true });
      world.__blooketCreateSetWatch = watch;
      return true;
    } catch { watch.dispose(); return false; }
  } catch { return false; }
}
