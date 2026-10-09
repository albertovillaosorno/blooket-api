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
//   - Bounded byte identity reads for an owned Blooket question image.
// - Must-Not:
//   - Submit, expose URLs or bytes, send credentials, or follow redirects.
// - Allows:
//   - Inputs: Exact owned set/question and a bounded remaining read budget.
//   - Outputs: Byte count/digest, unknown evidence, or an ownership failure.
//   - Side effects: One credential-free CORS GET to Blooket's media origin.
// - Split-When:
//   - Other media families need different authorities or identity semantics.
// - Merge-When:
//   - Provider question reads include trustworthy immutable media receipts.
// - Summary:
//   - Hashes saved bytes without treating image presence as content identity.
// - Description:
//   - Rechecks the exact form and human watch after every asynchronous read.
// - Usage:
//   - Execute in the same isolated world that opened the read-only modal.
// - Defaults:
//   - Unreadable media remains unknown; changed ownership fails closed.
//
export async function inspectOpenedBlooketQuestionImage(
  setId: string,
  number: number,
  budgetMs: number,
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: "blooket-browser-failed" }
> {
  const failed = () => ({
    ok: false as const, code: "blooket-browser-failed" as const,
  });
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let body: ReadableStream<Uint8Array> | null = null;
  try {
    // Chrome serializes each injected helper without its module imports.
    const visible = (node: Element): boolean => {
      const bounds = node.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    };
    const uniqueVisible = (selector: string): boolean => {
      const nodes = Array.from(document.querySelectorAll(selector));
      return nodes.length === 1 && visible(nodes[0]!);
    };
    const world = globalThis as typeof globalThis & {
      __blooketQuestionEditWatch?: {
        document: Document; setId: string; number: number; dirty: boolean;
      };
    };
    const watch = world.__blooketQuestionEditWatch;
    const route = location.href;
    const fields = document.querySelectorAll('input#question[name="question"]');
    if (fields.length !== 1) return failed();
    const hidden = fields[0] as HTMLInputElement;
    const form = hidden.closest("form");
    const raw = hidden.value;
    const owned = (): boolean => {
      const url = new URL(location.href);
      if (!watch || world.__blooketQuestionEditWatch !== watch ||
          watch.document !== document || watch.dirty ||
          watch.setId !== setId || watch.number !== number ||
          location.href !== route ||
          url.origin !== "https://dashboard.blooket.com" ||
          url.pathname !== "/edit" ||
          url.searchParams.getAll("id").length !== 1 ||
          url.searchParams.get("id") !== setId ||
          document.title === "Just a moment..." ||
          document.querySelector('input[type="password"]') !== null ||
          !uniqueVisible("main") ||
          !uniqueVisible('nav a[href="/my-sets"]')) return false;
      const logout = Array.from(document.querySelectorAll(
        'a[href="https://id.blooket.com/logout"]',
      ));
      if (logout.length !== 1 || logout[0]!.textContent?.trim() !== "Logout")
        return false;
      if (!visible(logout[0]!)) {
        const profile = 'a[href="https://id.blooket.com/login"]';
        if (!uniqueVisible(profile) ||
            !document.querySelector(profile)?.textContent?.trim()) return false;
      }
      if (Array.from(document.querySelectorAll(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
      )).some(visible) || Array.from(document.querySelectorAll(
        '[role="dialog"][aria-modal="true"] h3',
      )).some(node => visible(node) &&
        node.textContent?.trim() === "Select your organization")) return false;
      const current = document.querySelectorAll(
        'input#question[name="question"]',
      );
      if (current.length !== 1 || current[0] !== hidden ||
          hidden.tagName !== "INPUT" ||
          hidden.getAttribute("type") !== "hidden" || hidden.value !== raw ||
          form?.tagName !== "FORM" || hidden.closest("form") !== form)
        return false;
      const identities = form.querySelectorAll('input#setId[name="setId"]');
      if (identities.length !== 1 || identities[0]?.tagName !== "INPUT" ||
          identities[0].getAttribute("type") !== "hidden" ||
          (identities[0] as HTMLInputElement).value !== setId) return false;
      for (const [selector, label] of [
        ['button[type="submit"]', "Save Question"],
        ['button[type="button"]', "Cancel"],
      ] as const) {
        const buttons = Array.from(form.querySelectorAll(selector)).filter(
          button => button.textContent?.replace(/\s+/gu, " ").trim() === label,
        );
        if (buttons.length !== 1 || buttons[0]?.tagName !== "BUTTON" ||
            !visible(buttons[0]) ||
            (buttons[0] as HTMLButtonElement).disabled ||
            buttons[0].getAttribute("aria-disabled") === "true") return false;
      }
      return true;
    };
    if (!setId || setId.length > 512 || /[\x00-\x1f\x7f]/u.test(setId) ||
        !Number.isSafeInteger(number) || number < 1 || number > 10_000 ||
        !Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 5_000 ||
        typeof raw !== "string" || raw.length < 2 || raw.length > 100_000 ||
        !owned()) return failed();
    const question = JSON.parse(raw) as Record<string, unknown>;
    if (!question || Array.isArray(question) || question["number"] !== number ||
        typeof question["image"] !== "string" ||
        question["image"].length < 1 || question["image"].length > 8_192)
      return failed();
    const unknown = () => owned()
      ? { ok: true as const, value: null } : failed();
    let url: URL;
    try { url = new URL(question["image"]); } catch { return unknown(); }
    if (url.protocol !== "https:" || url.hostname !== "media.blooket.com" ||
        url.port || url.username || url.password || url.hash ||
        url.href !== question["image"]) return unknown();
    controller = new AbortController();
    const started = Date.now();
    timer = setTimeout(() => controller!.abort(), budgetMs);
    const stillOwned = () => !controller!.signal.aborted &&
      Date.now() - started < budgetMs && owned();
    try {
      const response = await fetch(url.href, {
        credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        cache: "no-store", signal: controller.signal,
      });
      body = response.body;
      if (!stillOwned()) return failed();
      if (!response.ok || response.redirected || !response.body)
        return unknown();
      const length = response.headers.get("content-length");
      if (length !== null && (!/^[1-9][0-9]*$/u.test(length) ||
          Number(length) >= 2_500_000)) return unknown();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      for (;;) {
        const chunk = await reader.read();
        if (!stillOwned()) return failed();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) ||
            chunk.value.byteLength === 0 || chunks.length >= 2_048)
          return unknown();
        byteLength += chunk.value.byteLength;
        if (byteLength >= 2_500_000) return unknown();
        chunks.push(chunk.value);
      }
      if (byteLength === 0 ||
          (length !== null && Number(length) !== byteLength))
        return unknown();
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const png = bytes.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
      const jpeg = bytes.length >= 3 && bytes[0] === 255 &&
        bytes[1] === 216 && bytes[2] === 255;
      const gif = bytes.length >= 6 &&
        bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 &&
        bytes[3] === 56 && (bytes[4] === 55 || bytes[4] === 57) &&
        bytes[5] === 97;
      if (!png && !jpeg && !gif) return unknown();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      if (!stillOwned()) return failed();
      const sha256 = Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, "0")).join("");
      return { ok: true, value: { byteLength, sha256 } };
    } catch { return unknown(); }
  } catch { return failed(); }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    controller?.abort();
    // Cancel any unread response without extending the caller's deadline.
    if (reader) void reader.cancel().catch(() => {});
    else if (body) void body.cancel().catch(() => {});
  }
}
