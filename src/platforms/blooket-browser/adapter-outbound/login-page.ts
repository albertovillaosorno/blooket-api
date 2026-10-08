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
//   - Exact DOM preparation and one-submit interaction for Blooket login.
// - Must-Not:
//   - Persist, return, log, infer, or bypass credentials or security
//     challenges.
// - Allows:
//   - Inputs: One bounded login identifier and password on the exact login
//     page.
//   - Outputs: Secret-free preparation/submission success or stable failure.
//   - Side effects: Input/change events and at most one login button click.
// - Split-When:
//   - Another login method requires independent page mechanics.
// - Merge-When:
//   - Blooket exposes a provider-owned browser authentication API.
// - Summary:
//   - Fills only the publicly observed username/password login surface.
// - Description:
//   - Revalidates route, controls, values, and challenge absence before submit.
// - Usage:
//   - Invoke only through the extension session-authentication host.
// - Defaults:
//   - Ambiguous controls, challenges, and malformed credentials fail closed.
//
export interface BlooketLoginPageInput {
  readonly loginIdentifier: string;
  readonly password: string;
}

export type BlooketLoginPageResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

export type BlooketLoginPageAction = "prepare" | "is-prepared" | "submit";

export function runBlooketLoginPageAction(
  action: BlooketLoginPageAction,
  input: BlooketLoginPageInput,
): BlooketLoginPageResult | boolean {
  const failed = (): BlooketLoginPageResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  const validInput = () =>
    typeof input.loginIdentifier === "string" &&
    input.loginIdentifier.length >= 1 &&
    input.loginIdentifier.length <= 254 &&
    !input.loginIdentifier.includes("\0") &&
    typeof input.password === "string" &&
    input.password.length >= 1 &&
    input.password.length <= 2048 &&
    !input.password.includes("\0");
  const controls = (): {
    readonly identifier: HTMLInputElement;
    readonly password: HTMLInputElement;
    readonly submit: HTMLButtonElement;
  } | null => {
    const url = new URL(location.href);
    if (
      url.origin !== "https://id.blooket.com" ||
      url.pathname !== "/login"
    )
      return null;
    const visible = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    };
    const challenged = Array.from(
      document.querySelectorAll(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
      ),
    ).some((frame) => {
      if (!visible(frame)) return false;
      const source = frame.getAttribute("src");
      if (!source) return true;
      if (source.includes("hcaptcha")) return true;
      try {
        const challengeUrl = new URL(source, location.href);
        return challengeUrl.searchParams.get("size") !== "invisible";
      } catch {
        return true;
      }
    });
    if (challenged) return null;
    const headings = Array.from(document.querySelectorAll("h1, h2, h3")).filter(
      (heading) => visible(heading) && heading.textContent?.trim() === "Log in",
    );
    const identifiers = Array.from(
      document.querySelectorAll('input[placeholder="Username or email"]'),
    ).filter(visible);
    const passwords = Array.from(
      document.querySelectorAll(
        'input[type="password"][placeholder="Password"]',
      ),
    ).filter(visible);
    const submits = Array.from(document.querySelectorAll("button")).filter(
      (button) => visible(button) && button.textContent?.trim() === "Let's go!",
    );
    if (
      headings.length !== 1 ||
      identifiers.length !== 1 ||
      passwords.length !== 1 ||
      submits.length !== 1 ||
      identifiers[0]?.tagName !== "INPUT" ||
      passwords[0]?.tagName !== "INPUT" ||
      submits[0]?.tagName !== "BUTTON"
    )
      return null;
    return {
      identifier: identifiers[0] as HTMLInputElement,
      password: passwords[0] as HTMLInputElement,
      submit: submits[0] as HTMLButtonElement,
    };
  };

  try {
    if (
      action !== "prepare" &&
      action !== "is-prepared" &&
      action !== "submit"
    ) return failed();
    if (!validInput()) return action === "is-prepared" ? false : failed();
    const page = controls();
    if (page === null) return action === "is-prepared" ? false : failed();
    if (action === "prepare") {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      if (descriptor?.set === undefined) return failed();
      descriptor.set.call(page.identifier, input.loginIdentifier);
      page.identifier.dispatchEvent(new Event("input", { bubbles: true }));
      page.identifier.dispatchEvent(new Event("change", { bubbles: true }));
      descriptor.set.call(page.password, input.password);
      page.password.dispatchEvent(new Event("input", { bubbles: true }));
      page.password.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }
    const prepared =
      page.identifier.value === input.loginIdentifier &&
      page.password.value === input.password &&
      !page.submit.disabled;
    if (action === "is-prepared") return prepared;
    if (!prepared) return failed();
    page.submit.click();
    return { ok: true };
  } catch {
    return action === "is-prepared" ? false : failed();
  }
}

export function prepareBlooketLoginForm(
  input: BlooketLoginPageInput,
): BlooketLoginPageResult {
  return runBlooketLoginPageAction("prepare", input) as BlooketLoginPageResult;
}

export function isBlooketLoginFormPrepared(
  input: BlooketLoginPageInput,
): boolean {
  return runBlooketLoginPageAction("is-prepared", input) === true;
}

export function submitBlooketLoginForm(
  input: BlooketLoginPageInput,
): BlooketLoginPageResult {
  return runBlooketLoginPageAction("submit", input) as BlooketLoginPageResult;
}
