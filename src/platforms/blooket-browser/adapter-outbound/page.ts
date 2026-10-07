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
//   - Inputs: One admitted read operation on the confirmed dashboard origin.
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
    if (url.origin !== "https://dashboard.blooket.com") return failed();
    const main = document.querySelector("main");
    const visibleChallenges = Array.from(
      document.querySelectorAll(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
      ),
    ).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (operation.kind === "session.observe") {
      if (visibleChallenges) return { ok: true, value: "security-challenge" };
      if (document.querySelector('input[type="password"]'))
        return { ok: true, value: "signed-out" };
      if (!main || !document.querySelector('nav a[href="/my-sets"]'))
        return { ok: true, value: "unexpected-page" };
      const heading = main.querySelector("h1");
      if (
        url.pathname === "/my-sets" &&
        heading?.textContent?.trim() === "My Sets"
      )
        return { ok: true, value: "my-sets" };
      if (
        url.pathname === "/edit" &&
        main.querySelector("h1") &&
        Array.from(main.querySelectorAll("button")).some(
          (button) => button.textContent?.trim() === "Save Set",
        )
      )
        return { ok: true, value: "edit" };
      return { ok: true, value: "unexpected-page" };
    }
    if (
      visibleChallenges ||
      !main ||
      !document.querySelector('nav a[href="/my-sets"]')
    )
      return failed();
    if (operation.kind === "sets.list") {
      if (
        url.pathname !== "/my-sets" ||
        main.querySelector("h1")?.textContent?.trim() !== "My Sets"
      )
        return failed();
      const articles = Array.from(main.querySelectorAll("article"));
      if (articles.length > 200) return failed();
      const result: { schemaVersion: 1; id: string; title: string }[] = [];
      const ids = new Set<string>();
      for (const article of articles) {
        const headings = article.querySelectorAll("h3");
        const links = Array.from(article.querySelectorAll("a[href]")).filter(
          (link) => link.textContent?.trim() === "Edit",
        );
        if (headings.length !== 1 || links.length !== 1) return failed();
        const href = links[0]!.getAttribute("href");
        if (!href) return failed();
        const link = new URL(href, url.origin);
        const id = link.searchParams.get("id");
        const title = headings[0]?.textContent?.trim();
        if (
          link.origin !== url.origin ||
          link.pathname !== "/edit" ||
          !id ||
          id.length > 512 ||
          !title ||
          title.length > 1000 ||
          ids.has(id)
        )
          return failed();
        ids.add(id);
        result.push({ schemaVersion: 1, id, title });
      }
      // An empty loading container must not masquerade as an empty account.
      if (result.length === 0) return failed();
      return { ok: true, value: result };
    }
    if (
      operation.kind !== "sets.get" ||
      url.pathname !== "/edit" ||
      !operation.setId ||
      operation.setId.length > 512 ||
      url.searchParams.get("id") !== operation.setId
    )
      return failed();
    const title = document.querySelector('input#title[name="title"]');
    const description = document.querySelector('textarea#desc[name="desc"]');
    const privacy = document.querySelector('input#private[name="private"]');
    if (
      title?.tagName !== "INPUT" ||
      description?.tagName !== "TEXTAREA" ||
      privacy?.tagName !== "INPUT" ||
      privacy.getAttribute("type") !== "checkbox" ||
      privacy.getAttribute("role") !== "switch"
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
    // The field name is inverted; use the displayed privacy label as evidence.
    const label = Array.from((privacy as HTMLInputElement).labels ?? [])
      .map((item) => item.textContent ?? "")
      .join(" ");
    const checked = privacy.getAttribute("aria-checked");
    let visibility: "private";
    if (
      checked === "false" &&
      /Private\s*\(Only playable by you\)/u.test(label)
    )
      visibility = "private";
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
    operation.setId.includes("\0")
  )
    throw new Error("invalid-set-id");
  return (
    "https://dashboard.blooket.com/edit?id=" +
    encodeURIComponent(operation.setId)
  );
}

// Opening an existing detail panel changes presentation without saving a set.
export function openBlooketDetailPanel(): boolean {
  if (
    location.origin !== "https://dashboard.blooket.com" ||
    location.pathname !== "/edit"
  )
    return false;
  if (document.querySelector('input#title[name="title"]')) return true;
  const buttons = Array.from(document.querySelectorAll("main button")).filter(
    (button) => button.textContent?.trim() === "Edit Info",
  );
  if (buttons.length !== 1) return false;
  (buttons[0] as HTMLButtonElement).click();
  return true;
}
