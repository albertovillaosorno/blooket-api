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
//   - Native control preparation and one guarded existing-text Save.
// - Must-Not:
//   - Upload media, alter hidden serialization, or repeat a submitted Save.
// - Allows:
//   - Inputs: Validated text revision and exact read-owned native form.
//   - Outputs: Prepared media identity, verification or one submission.
//   - Side effects: Visible text controls, correctness toggles and one Save.
// - Split-When:
//   - Provider text editors require independently versioned controls.
// - Merge-When:
//   - All existing-question editing shares native control ownership.
// - Summary:
//   - Corrects text while retaining the provider's existing media fields.
// - Description:
//   - The original serialized non-text fields must remain exact.
// - Usage:
//   - Inject only into the dedicated admitted Blooket edit document.
// - Defaults:
//   - Foreign forms, human dialogs, drift and repeated Save refuse action.
//
import type { BlooketTextRevision } from
  "../../../ir/blooket-publication-commands/contract/text-revision.ts";

type NativeWatch = { document: Document; setId: string; number?: number;
  dirty: boolean; dispose(): void };
interface RevisionWatch {
  document: Document; owner: NativeWatch; form: HTMLFormElement;
  request: string; preserved: string; prepared: boolean; submitted: boolean;
}

export async function runBlooketTextRevisionPageAction(
  action: "prepare" | "submit" | "verify" | "verify-original" | "release" |
    "inspect-pending" | "release-confirmed",
  input: BlooketTextRevision,
  expectedMediaIdentity?: string,
): Promise<{ readonly ok: true; readonly mediaIdentity?: string } |
  { readonly ok: false; readonly stage?: string }> {
  // Chrome serializes this function; keep every runtime helper inside it.
  const world = globalThis as typeof globalThis & {
    __blooketQuestionEditWatch?: NativeWatch;
    __blooketDetailEditWatch?: NativeWatch;
    __blooketTextRevisionWatch?: RevisionWatch;
  };
  let phase = "ownership";
  const failed = () => ({ ok: false as const,
    ...(action === "prepare" ? { stage: phase } : {}) });
  const change = input.change;
  const set = input.expectedSet;
  const visible = (node: Element): boolean => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== "none" && style.visibility === "visible";
  };
  const guarded = (): boolean => {
    const url = new URL(location.href);
    if (url.origin !== "https://dashboard.blooket.com" ||
        url.pathname !== "/edit" || url.hash ||
        url.searchParams.size !== 1 ||
        url.searchParams.get("id") !== set.id ||
        document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]')) return false;
    if (['dialog[open]', '[role="alertdialog"]', ':popover-open',
      '[role="dialog"][aria-modal="true"]', 'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]'].some(selector =>
        Array.from(document.querySelectorAll(selector)).some(node => {
          if (!visible(node)) return false;
          // Blooket's question editor is itself an ARIA dialog. Exempt only
          // the exact read-owned form; another visible modal still stops.
          const hidden = document.querySelector(
            'input#question[name="question"]');
          const nativeForm = hidden?.closest("form");
          if (change.kind === "question-text" &&
              selector === '[role="dialog"][aria-modal="true"]' &&
              node === nativeForm?.closest(selector) &&
              world.__blooketQuestionEditWatch?.document === document &&
              world.__blooketQuestionEditWatch.setId === set.id &&
              world.__blooketQuestionEditWatch.number ===
                change.previous.number)
            return false;
          return true;
        })))
      return false;
    const mains = document.querySelectorAll("main");
    const nav = document.querySelectorAll('nav a[href="/my-sets"]');
    const logout = document.querySelectorAll(
      'a[href="https://id.blooket.com/logout"]');
    const profile = document.querySelectorAll(
      'a[href="https://id.blooket.com/login"]');
    return mains.length === 1 && visible(mains[0]!) &&
      nav.length === 1 && visible(nav[0]!) && logout.length === 1 &&
      logout[0]!.textContent?.trim() === "Logout" &&
      (visible(logout[0]!) || (profile.length === 1 &&
        visible(profile[0]!) && !!profile[0]!.textContent?.trim()));
  };
  const owner = change.kind === "set-title"
    ? world.__blooketDetailEditWatch : world.__blooketQuestionEditWatch;
  const owned = () => guarded() && owner?.document === document &&
    owner.setId === set.id && !owner.dirty &&
    (change.kind === "set-title" || owner.number === change.previous.number);
  let form: HTMLFormElement | null = null;
  const one = (selector: string): HTMLInputElement |
    HTMLTextAreaElement | null => {
    const nodes = form?.querySelectorAll(selector);
    if (nodes?.length !== 1 || !visible(nodes[0]!)) return null;
    const node = nodes[0] as HTMLInputElement | HTMLTextAreaElement;
    return !node.disabled && !node.readOnly ? node : null;
  };
  const raw = (): Record<string, unknown> | undefined => {
    const nodes = document.querySelectorAll('input#question[name="question"]');
    if (nodes.length !== 1) return undefined;
    const hidden = nodes[0] as HTMLInputElement;
    if (hidden.type !== "hidden" || hidden.value.length > 100_000)
      return undefined;
    const value = JSON.parse(hidden.value);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    form = hidden.closest("form");
    return value;
  };
  const preserved = (): string | undefined => {
    if (change.kind === "question-text") {
      const value = raw();
      if (!value) return undefined;
      return JSON.stringify(Object.fromEntries(Object.entries(value)
        .filter(([key]) => !["question", "answers", "correctAnswers"]
          .includes(key))));
    }
    const forms = document.querySelectorAll("form#question-set-form");
    if (forms.length !== 1) return undefined;
    form = forms[0] as HTMLFormElement;
    const id = form.querySelector('input[type="hidden"][name="setId"]') as
      HTMLInputElement | null;
    if (id?.value !== set.id) return undefined;
    return JSON.stringify(Array.from(form.querySelectorAll(
      "input,textarea,select")).filter(node => node.id !== "title")
      .map(node => {
        const control = node as HTMLInputElement;
        return [control.tagName, control.id, control.name, control.type,
          control.value, control.checked ?? null,
          control.getAttribute("aria-checked")];
      }));
  };
  const digest = async (text: string): Promise<string> => {
    const bytes = await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), n => n.toString(16)
      .padStart(2, "0")).join("");
  };
  const media = async (): Promise<string | undefined> => {
    if (change.kind === "set-title") {
      const fields = preserved();
      return fields === undefined ? undefined : digest(fields);
    }
    const value = raw();
    return value ? digest(JSON.stringify([value["image"], value["audio"]]))
      : undefined;
  };
  const questionMatches = (desired: boolean): boolean => {
    if (change.kind !== "question-text") return false;
    const prior = change.previous, value = raw();
    const answers = desired ? change.answers
      : prior.answers.map(a => a.content);
    const correct = answers.filter((_, i) => prior.answers[i]!.correct);
    return !!value && value["number"] === prior.number &&
      value["question"] === (desired ? change.question : prior.question) &&
      value["qType"] === prior.qType && value["random"] === prior.random &&
      value["timeLimit"] === prior.timeLimit &&
      typeof value["image"] === "string" &&
      Boolean(value["image"]) === prior.hasImage && value["audio"] === "" &&
      JSON.stringify(value["answers"]) === JSON.stringify(answers) &&
      JSON.stringify(value["correctAnswers"]) === JSON.stringify(correct) &&
      (prior.qType === "mc" || JSON.stringify(value["answerTypes"]) ===
        JSON.stringify(prior.answers.map(a => a.match)));
  };
  const titleMatches = (desired: boolean): boolean => {
    const title = one('input#title[name="title"]');
    const desc = one('textarea#desc[name="desc"]');
    const privacy = one('input#private[name="private"]');
    return change.kind === "set-title" && !!title && !!desc && !!privacy &&
      title.value === (desired ? change.title : set.title) &&
      desc.value === set.description &&
      privacy.getAttribute("aria-checked") ===
        (set.visibility === "private" ? "false" : "true");
  };
  const matches = (desired: boolean) => change.kind === "set-title"
    ? titleMatches(desired) : questionMatches(desired);
  const wait = async (check: () => boolean): Promise<boolean> => {
    for (let i = 0; i < 50; i++) {
      if (!owned()) return false;
      if (check()) return true;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return false;
  };
  const setText = async (node: HTMLInputElement | HTMLTextAreaElement | null,
    text: string): Promise<boolean> => {
    if (!node || !owned() ||
        (node.maxLength >= 0 && text.length > node.maxLength)) return false;
    const prototype = node.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    setter.call(node, text);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return wait(() => node.isConnected && node.value === text);
  };
  const correctButton = (index: number): HTMLButtonElement | undefined => {
    const nodes = form?.querySelectorAll('button[aria-label="Mark Answer ' +
      (index + 1) + ' as Correct"]');
    const node = nodes?.length === 1 ? nodes[0] as HTMLButtonElement : null;
    return node && visible(node) && !node.disabled ? node : undefined;
  };
  try {
    if (!owned()) return failed();
    phase = "form";
    const before = preserved();
    const capturedForm = form as HTMLFormElement | null;
    if (before === undefined || !capturedForm) return failed();
    if (action === "inspect-pending" || action === "release-confirmed") {
      const watch = world.__blooketTextRevisionWatch;
      if (change.kind !== "question-text" || !watch ||
          watch.document !== document || watch.owner !== owner ||
          watch.form !== capturedForm || !watch.prepared || !watch.submitted ||
          watch.request !== JSON.stringify(input) || !matches(true) ||
          before !== watch.preserved) return failed();
      const identity = await media();
      if (!owned() || world.__blooketTextRevisionWatch !== watch ||
          preserved() !== watch.preserved || !matches(true) ||
          identity === undefined || (expectedMediaIdentity !== undefined &&
          identity !== expectedMediaIdentity)) return failed();
      if (action === "inspect-pending")
        return { ok: true, mediaIdentity: identity };
      // Only the trusted recovery host calls this after independently
      // confirming the remote row. No pending form is canceled by a read.
      if (expectedMediaIdentity === undefined) return failed();
      const buttons = Array.from(capturedForm.querySelectorAll(
        'button[type="button"]')).filter(button =>
          visible(button) && button.textContent?.trim() === "Cancel");
      const cancel = buttons.length === 1
        ? buttons[0] as HTMLButtonElement : undefined;
      if (!cancel || cancel.disabled ||
          cancel.getAttribute("aria-disabled") === "true") return failed();
      cancel.click();
      watch.owner.dispose();
      delete world.__blooketTextRevisionWatch;
      return { ok: true };
    }
    if (action === "release") {
      if (world.__blooketTextRevisionWatch?.submitted) return failed();
      delete world.__blooketTextRevisionWatch;
      return { ok: true };
    }
    if (action === "verify" || action === "verify-original") {
      const identity = await media();
      return owned() && matches(action === "verify") &&
        identity !== undefined &&
        (expectedMediaIdentity === undefined ||
          identity === expectedMediaIdentity)
        ? { ok: true, mediaIdentity: identity } : failed();
    }
    if (action === "prepare") {
      phase = "baseline";
      if (world.__blooketTextRevisionWatch || !matches(false)) return failed();
      const watch: RevisionWatch = { document, owner: owner!,
        form: capturedForm,
        request: JSON.stringify(input), preserved: before,
        prepared: false, submitted: false };
      world.__blooketTextRevisionWatch = watch;
      if (change.kind === "set-title") {
        phase = "title-control";
        if (!await setText(one('input#title[name="title"]'), change.title))
          return failed();
      } else {
        const prior = change.previous;
        // Remove a changed correct text through its native toggle first;
        // React must not retain the former answer as a hidden correct value.
        if (prior.qType === "mc") for (let i = 0; i < prior.answers.length;
          i++) {
          if (prior.answers[i]!.correct &&
              prior.answers[i]!.content !== change.answers[i]) {
            const button = correctButton(i);
            if (!button) return failed();
            button.click();
            if (!await wait(() => !(raw()?.["correctAnswers"] as unknown[])
              ?.includes(prior.answers[i]!.content))) return failed();
          }
        }
        if (!await setText(one("textarea#question"), change.question))
          return failed();
        for (let i = 0; i < change.answers.length; i++) {
          const node = prior.qType === "mc"
            ? one("textarea#answer-" + i)
            : capturedForm.querySelectorAll(
              'input[name="accepted-answers"]')[i] as
              HTMLInputElement | undefined;
          if (!node || !visible(node) || node.disabled || node.readOnly ||
              !await setText(node, change.answers[i]!)) return failed();
        }
        if (prior.qType === "mc") for (let i = 0; i < prior.answers.length;
          i++) {
          const correct = raw()?.["correctAnswers"];
          if (!Array.isArray(correct)) return failed();
          if (correct.includes(change.answers[i]) !==
              prior.answers[i]!.correct) {
            const button = correctButton(i);
            if (!button) return failed();
            button.click();
            if (!await wait(() => (raw()?.["correctAnswers"] as unknown[])
              ?.includes(change.answers[i]) === prior.answers[i]!.correct))
              return failed();
          }
        }
      }
      phase = "echo";
      if (!await wait(() => matches(true) && preserved() === before))
        return failed();
      const identity = await media();
      phase = "media-identity";
      if (!owned() || identity === undefined || preserved() !== before)
        return failed();
      watch.prepared = true;
      return { ok: true, mediaIdentity: identity };
    }
    const watch = world.__blooketTextRevisionWatch;
    if (action !== "submit" || !watch || watch.document !== document ||
        watch.owner !== owner || watch.form !== capturedForm ||
        watch.request !== JSON.stringify(input) || !watch.prepared ||
        watch.submitted || !matches(true) ||
        preserved() !== watch.preserved) return failed();
    // Edit Info's Done control is outside the form and uses HTML's explicit
    // form association. Question Save remains a descendant of its own form.
    const candidates = change.kind === "set-title"
      ? Array.from(document.querySelectorAll('button[type="submit"]'))
          .filter(button => (button as HTMLButtonElement).form ===
            capturedForm)
      : Array.from(capturedForm.querySelectorAll('button[type="submit"]'));
    const buttons = candidates
      .filter(button => visible(button) && button.textContent?.trim() ===
        (change.kind === "set-title" ? "Done" : "Save Question"));
    const save = buttons.length === 1 ? buttons[0] as HTMLButtonElement : null;
    if (!save || save.disabled || save.getAttribute("aria-disabled") ===
        "true" || !owned() || !matches(true) ||
        preserved() !== watch.preserved) return failed();
    watch.submitted = true;
    // Never catch click errors as a safe refusal: submission may have begun.
    save.click();
    return { ok: true };
  } catch (error) {
    if (world.__blooketTextRevisionWatch?.submitted) throw error;
    return failed();
  }
}
