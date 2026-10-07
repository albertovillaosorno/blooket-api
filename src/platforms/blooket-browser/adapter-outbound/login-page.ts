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

export function prepareBlooketLoginForm(
  input: BlooketLoginPageInput,
): BlooketLoginPageResult {
  const failed = (): BlooketLoginPageResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    if (!validInput(input)) return failed();
    const controls = loginControls();
    if (controls === null) return failed();
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    if (descriptor?.set === undefined) return failed();
    descriptor.set.call(controls.identifier, input.loginIdentifier);
    controls.identifier.dispatchEvent(new Event("input", { bubbles: true }));
    controls.identifier.dispatchEvent(new Event("change", { bubbles: true }));
    descriptor.set.call(controls.password, input.password);
    controls.password.dispatchEvent(new Event("input", { bubbles: true }));
    controls.password.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  } catch {
    return failed();
  }
}

export function isBlooketLoginFormPrepared(
  input: BlooketLoginPageInput,
): boolean {
  try {
    if (!validInput(input)) return false;
    const controls = loginControls();
    return (
      controls !== null &&
      controls.identifier.value === input.loginIdentifier &&
      controls.password.value === input.password &&
      !controls.submit.disabled
    );
  } catch {
    return false;
  }
}

export function submitBlooketLoginForm(
  input: BlooketLoginPageInput,
): BlooketLoginPageResult {
  const failed = (): BlooketLoginPageResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    if (!isBlooketLoginFormPrepared(input)) return failed();
    const controls = loginControls();
    if (controls === null || controls.submit.disabled) return failed();
    controls.submit.click();
    return { ok: true };
  } catch {
    return failed();
  }
}

function validInput(input: BlooketLoginPageInput): boolean {
  return (
    typeof input.loginIdentifier === "string" &&
    input.loginIdentifier.length >= 1 &&
    input.loginIdentifier.length <= 254 &&
    !input.loginIdentifier.includes("\0") &&
    typeof input.password === "string" &&
    input.password.length >= 1 &&
    input.password.length <= 2048 &&
    !input.password.includes("\0")
  );
}

function loginControls(): {
  readonly identifier: HTMLInputElement;
  readonly password: HTMLInputElement;
  readonly submit: HTMLButtonElement;
} | null {
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
  ).some(visible);
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
}
