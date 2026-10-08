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
//   - Bounded extraction from observed Blooket page controls.
// - Must-Not:
//   - Read hidden framework state, cookies, credentials, or raw page HTML.
// - Allows:
//   - Inputs: One admitted read on the dashboard or exact public login page.
//   - Outputs: Untrusted visible facts or a stable browser failure.
//   - Side effects: DOM inspection and opening details without saving edits.
// - Split-When:
//   - Question reading gains independently verified control semantics.
// - Merge-When:
//   - Visible page reads no longer require a browser-specific boundary.
// - Summary:
//   - Extracts set summaries and detail without guessing unavailable fields.
// - Description:
//   - Application IR decoders remain the authority for returned values.
// - Usage:
//   - Compile for the extension and execute in its dedicated Blooket tab.
// - Defaults:
//   - Unknown routes, incomplete controls, and ambiguous values fail closed.
//
export type PageReadOperation =
  | { readonly kind: "session.observe" }
  | { readonly kind: "sets.list" }
  | { readonly kind: "sets.get"; readonly setId: string };

export type PageReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

// Self-contained so WebExtension scripting can serialize it without closures.
export function inspectBlooketPage(
  operation: PageReadOperation,
): PageReadResult {
  const failed = (): PageReadResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    const url = new URL(location.href);
    const visible = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    };
    const visibleChallenges = Array.from(
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
        return !(
          url.origin === "https://id.blooket.com" &&
          url.pathname === "/login" &&
          challengeUrl.origin === "https://www.google.com" &&
          challengeUrl.pathname === "/recaptcha/api2/anchor" &&
          challengeUrl.searchParams.getAll("size").length === 1 &&
          challengeUrl.searchParams.get("size") === "invisible"
        );
      } catch {
        return true;
      }
    });
    // Observed Chrome for Testing interstitial on both Blooket origins:
    // a document-complete Cloudflare verification without a captcha iframe.
    // This is a human/provider stop, never an authenticated page or login form.
    const securityInterstitial =
      document.title === "Just a moment..." &&
      Array.from(document.querySelectorAll("h1, h2, h3")).some((heading) =>
        visible(heading) &&
        heading.textContent?.trim() === "Performing security verification"
      );
    if (securityInterstitial) {
      return operation.kind === "session.observe" &&
          (url.origin === "https://id.blooket.com" ||
            url.origin === "https://dashboard.blooket.com")
        ? { ok: true, value: "security-challenge" }
        : failed();
    }
    // Interstitials can temporarily keep an old React shell mounted while
    // its verification heading is replaced. Never use that shell as evidence.
    if (document.title === "Just a moment...") {
      return operation.kind === "session.observe" &&
          (url.origin === "https://id.blooket.com" ||
            url.origin === "https://dashboard.blooket.com")
        ? { ok: true, value: "unexpected-page" }
        : failed();
    }
    if (
      operation.kind === "session.observe" &&
      url.origin === "https://id.blooket.com"
    ) {
      if (visibleChallenges)
        return { ok: true, value: "security-challenge" };
      if (url.pathname !== "/login")
        return { ok: true, value: "unexpected-page" };
      const headings = Array.from(
        document.querySelectorAll("h1, h2, h3"),
      ).filter(
        (heading) =>
          visible(heading) && heading.textContent?.trim() === "Log in",
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
        (button) =>
          visible(button) && button.textContent?.trim() === "Let's go!",
      );
      return {
        ok: true,
        value:
          headings.length === 1 &&
          identifiers.length === 1 &&
          passwords.length === 1 &&
          submits.length === 1
            ? "signed-out"
            : "unexpected-page",
      };
    }
    if (url.origin !== "https://dashboard.blooket.com") return failed();
    const mains = Array.from(document.querySelectorAll("main"));
    const main = mains[0] ?? null;
    const mySetsNavigation = Array.from(document.querySelectorAll(
      'nav a[href="/my-sets"]',
    ));
    const logoutLinks = Array.from(document.querySelectorAll(
      'a[href="https://id.blooket.com/logout"]',
    ));
    const authenticatedShell =
      mains.length === 1 && main !== null && visible(main) &&
      mySetsNavigation.length === 1 && visible(mySetsNavigation[0]!) &&
      logoutLinks.length === 1 &&
      logoutLinks[0]!.textContent?.trim() === "Logout" &&
      (visible(logoutLinks[0]!) || (() => {
        // Closing the account menu hides Logout, not the authenticated page.
        const profiles = Array.from(document.querySelectorAll(
          'a[href="https://id.blooket.com/login"]',
        ));
        return profiles.length === 1 && visible(profiles[0]!) &&
          Boolean(profiles[0]!.textContent?.trim());
      })());
    const organizationPrompt = Array.from(
      document.querySelectorAll(
        '[role="dialog"][aria-modal="true"] h3',
      ),
    ).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        heading.textContent?.trim() === "Select your organization"
      );
    });
    if (operation.kind === "session.observe" && visibleChallenges)
      return { ok: true, value: "security-challenge" };
    if (operation.kind === "session.observe" && organizationPrompt)
      return { ok: true, value: "organization-prompt" };
    // Only the exact public identity login form can prove "signed-out".
    // A dashboard password control is an unknown authentication overlay, not
    // permission to read cached set cards or submit credentials automatically.
    if (document.querySelector('input[type="password"]')) {
      return operation.kind === "session.observe"
        ? { ok: true, value: "unexpected-page" }
        : failed();
    }
    if (operation.kind === "session.observe") {
      if (!authenticatedShell)
        return { ok: true, value: "unexpected-page" };
      const heading = main.querySelector("h1");
      if (
        url.pathname === "/my-sets" &&
        heading !== null && visible(heading) &&
        heading.textContent?.trim() === "My Sets"
      )
        return { ok: true, value: "my-sets" };
      if (url.pathname === "/create") {
        const forms = Array.from(
          document.querySelectorAll("form#question-set-form"),
        );
        const submits = Array.from(
          document.querySelectorAll("form#question-set-form button"),
        ).filter((button) => button.textContent?.trim() === "Create Set");
        if (
          forms.length === 1 && forms[0]?.tagName === "FORM" &&
          visible(forms[0]) && submits.length === 1 && visible(submits[0]!)
        ) return { ok: true, value: "create" };
      }
      if (url.pathname === "/edit") {
        const heading = main.querySelector("h1");
        const saves = Array.from(main.querySelectorAll("button"))
          .filter((button) => button.textContent?.trim() === "Save Set");
        if (
          heading && visible(heading) && saves.length === 1 &&
          visible(saves[0]!)
        ) return { ok: true, value: "edit" };
      }
      return { ok: true, value: "unexpected-page" };
    }
    if (
      visibleChallenges ||
      organizationPrompt ||
      !authenticatedShell
    )
      return failed();
    if (operation.kind === "sets.list") {
      const heading = main.querySelector("h1");
      if (
        url.pathname !== "/my-sets" ||
        !heading || !visible(heading) ||
        heading.textContent?.trim() !== "My Sets"
      )
        return failed();
      const articles = Array.from(main.querySelectorAll("article"));
      if (articles.length > 200) return failed();
      const result: { schemaVersion: 1; id: string; title: string }[] = [];
      const ids = new Set<string>();
      for (const article of articles) {
        if (!visible(article)) return failed();
        const headings = article.querySelectorAll("h3");
        const links = Array.from(article.querySelectorAll("a[href]")).filter(
          (link) => link.textContent?.trim() === "Edit",
        );
        if (
          headings.length !== 1 || links.length !== 1 ||
          !visible(headings[0]!) || !visible(links[0]!)
        ) return failed();
        const href = links[0]!.getAttribute("href");
        if (!href) return failed();
        const link = new URL(href, url.origin);
        const id = link.searchParams.get("id");
        const title = headings[0]?.textContent?.trim();
        if (
          link.origin !== url.origin ||
          link.pathname !== "/edit" ||
          link.searchParams.getAll("id").length !== 1 ||
          !id ||
          id.length > 512 ||
          /[\x00-\x1f\x7f]/u.test(id) ||
          !title ||
          title.length > 1000 ||
          ids.has(id)
        )
          return failed();
        ids.add(id);
        result.push({ schemaVersion: 1, id, title });
      }
      if (result.length === 0) {
        const emptyHeadings = Array.from(main.querySelectorAll("h2"))
          .filter((heading) =>
            heading.textContent?.trim() ===
            "You'll need a question set to host!"
          );
        const createButtons = Array.from(main.querySelectorAll("button"))
          .filter((button) => button.textContent?.trim() === "Create a Set");
        // Zero cards alone can be loading, search, or folder state. The
        // recovered empty-account banner and action must both be visible.
        if (
          emptyHeadings.length !== 1 || createButtons.length !== 1 ||
          !visible(emptyHeadings[0]!) || !visible(createButtons[0]!)
        ) return failed();
      }
      return {
        ok: true,
        value: {
          items: result,
          completeness: result.length === 0 ? "complete" : "unknown",
        },
      };
    }
    if (
      operation.kind !== "sets.get" ||
      url.pathname !== "/edit" ||
      !operation.setId ||
      operation.setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(operation.setId) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== operation.setId
    )
      return failed();
    const forms = Array.from(
      document.querySelectorAll("form#question-set-form"),
    );
    if (forms.length !== 1) return failed();
    const identities = Array.from(forms[0]!.querySelectorAll(
      'input[type="hidden"][name="setId"]',
    ));
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      (identities[0] as HTMLInputElement).value !== operation.setId
    ) return failed();
    const titles = Array.from(forms[0]!.querySelectorAll(
      'input#title[name="title"]',
    ));
    const descriptions = Array.from(forms[0]!.querySelectorAll(
      'textarea#desc[name="desc"]',
    ));
    const switches = Array.from(forms[0]!.querySelectorAll(
      'input#private[name="private"]',
    ));
    if (
      titles.length !== 1 ||
      descriptions.length !== 1 ||
      switches.length !== 1
    ) return failed();
    const title = titles[0]!;
    const description = descriptions[0]!;
    const privacy = switches[0]!;
    if (
      title.tagName !== "INPUT" ||
      description.tagName !== "TEXTAREA" ||
      privacy.tagName !== "INPUT" ||
      privacy.getAttribute("type") !== "checkbox" ||
      privacy.getAttribute("role") !== "switch" ||
      !visible(title) ||
      !visible(description)
    )
      return failed();
    const titleValue = (title as HTMLInputElement).value;
    const descriptionValue = (description as HTMLTextAreaElement).value;
    if (
      typeof titleValue !== "string" ||
      !titleValue.trim() ||
      titleValue.length > 1000 ||
      typeof descriptionValue !== "string" ||
      descriptionValue.length > 10_000
    )
      return failed();
    // Module 31017 renders the state wording in a paragraph *beside* the
    // toggle's <label>, not inside it. Check the visible direct sibling and
    // the inverted aria-checked state without guessing framework CSS classes.
    const labels = Array.from((privacy as HTMLInputElement).labels ?? []);
    if (labels.length !== 1 || labels[0]?.tagName !== "LABEL")
      return failed();
    const row = labels[0]!.parentElement;
    if (row?.tagName !== "DIV") return failed();
    const states = Array.from(row.querySelectorAll(":scope > p"));
    if (
      states.length !== 1 || states[0]?.tagName !== "P" ||
      !visible(states[0])
    ) return failed();
    const text = states[0]!.textContent?.replace(/\s+/gu, " ").trim();
    const checked = privacy.getAttribute("aria-checked");
    let visibility: "private" | "public";
    if (checked === "false" && text === "Private (Only playable by you)")
      visibility = "private";
    else if (checked === "true" && text === "Public (Playable by everyone)")
      visibility = "public";
    else return failed();
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        id: operation.setId,
        title: titleValue,
        description: descriptionValue,
        visibility,
      },
    };
  } catch {
    return failed();
  }
}

export function blooketReadUrl(operation: PageReadOperation): string | null {
  if (operation.kind === "session.observe") return null;
  if (operation.kind === "sets.list")
    return "https://dashboard.blooket.com/my-sets";
  if (
    !operation.setId ||
    operation.setId.length > 512 ||
    /[\x00-\x1f\x7f]/u.test(operation.setId)
  )
    throw new Error("invalid-set-id");
  return (
    "https://dashboard.blooket.com/edit?id=" +
    encodeURIComponent(operation.setId)
  );
}

// Opening an existing detail panel changes presentation without saving a set.
export function openBlooketDetailPanel(setId: string): boolean {
  // This opener executes separately from the guarded metadata read. A prior
  // session observation cannot authorize a click behind a new human prompt.
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
  const organizationPrompt = Array.from(document.querySelectorAll(
    '[role="dialog"][aria-modal="true"] h3',
  )).some((heading) => {
    const bounds = heading.getBoundingClientRect();
    return heading.textContent?.trim() === "Select your organization" &&
      bounds.width > 0 && bounds.height > 0;
  });
  const securityChallenge = Array.from(document.querySelectorAll(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
  )).some((frame) => {
    const bounds = frame.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
  if (!authenticated || organizationPrompt || securityChallenge) return false;
  if (
    location.origin !== "https://dashboard.blooket.com" ||
    location.pathname !== "/edit" ||
    !setId ||
    setId.length > 512 ||
    /[\x00-\x1f\x7f]/u.test(setId) ||
    new URL(location.href).searchParams.getAll("id").length !== 1 ||
    new URL(location.href).searchParams.get("id") !== setId
  )
    return false;
  const forms = Array.from(
    document.querySelectorAll("form#question-set-form"),
  );
  if (forms.length !== 1) return false;
  const identities = Array.from(forms[0]!.querySelectorAll(
    'input[type="hidden"][name="setId"]',
  ));
  if (
    identities.length !== 1 ||
    identities[0]?.tagName !== "INPUT" ||
    (identities[0] as HTMLInputElement).value !== setId
  ) return false;
  const titles = Array.from(forms[0]!.querySelectorAll(
    'input#title[name="title"]',
  ));
  if (titles.length !== 1 || titles[0]?.tagName !== "INPUT")
    return false;
  const bounds = titles[0]!.getBoundingClientRect();
  if (bounds.width > 0 && bounds.height > 0) return true;
  const buttons = Array.from(document.querySelectorAll("main button")).filter(
    (button) => button.textContent?.trim() === "Edit Info",
  );
  if (buttons.length !== 1) return false;
  (buttons[0] as HTMLButtonElement).click();
  return true;
}
