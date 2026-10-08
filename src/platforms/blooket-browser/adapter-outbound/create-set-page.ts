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
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/create" ||
      typeof input.title !== "string" ||
      input.title.length < 1 ||
      input.title.length > 1_000 ||
      typeof input.description !== "string" ||
      input.description.length > 10_000 ||
      typeof input.private !== "boolean"
    )
      return failed();

    const forms = Array.from(document.querySelectorAll(
      "form#question-set-form",
    ));
    if (forms.length !== 1 || forms[0]?.tagName !== "FORM")
      return failed();
    const form = forms[0];
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
    if (buttons.length !== 1) return failed();

    const titleInput = title as HTMLInputElement;
    const descriptionInput = description as HTMLTextAreaElement;
    const privacyInput = privacy as HTMLInputElement;
    const label = Array.from(privacyInput.labels ?? [])
      .map((item) => item.textContent ?? "")
      .join(" ");
    const ariaChecked = privacyInput.getAttribute("aria-checked");
    const currentPrivate =
      ariaChecked === "false" &&
      /Private\s*\(Only playable by you\)/u.test(label)
        ? true
        : ariaChecked === "true" &&
            /Public\s*\(Playable by everyone\)/u.test(label)
          ? false
          : undefined;
    if (currentPrivate === undefined) return failed();

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
    setValue(descriptionInput, input.description);
    if (currentPrivate !== input.private) privacyInput.click();
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
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/create"
    )
      return failed();
    const forms = Array.from(document.querySelectorAll(
      "form#question-set-form",
    ));
    if (forms.length !== 1 || forms[0]?.tagName !== "FORM")
      return failed();
    const form = forms[0];
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
    const label = Array.from(privacyInput.labels ?? [])
      .map((item) => item.textContent ?? "")
      .join(" ");
    const ariaChecked = privacyInput.getAttribute("aria-checked");
    const currentPrivate =
      ariaChecked === "false" &&
      /Private\s*\(Only playable by you\)/u.test(label)
        ? true
        : ariaChecked === "true" &&
            /Public\s*\(Playable by everyone\)/u.test(label)
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
    if (buttons.length !== 1) return failed();
    (buttons[0] as HTMLButtonElement).click();
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
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit"
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
