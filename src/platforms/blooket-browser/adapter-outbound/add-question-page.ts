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
//   - Preparation and submission of observed Add Question forms.
// - Must-Not:
//   - Choose paths, open a file picker, infer success, or retry submission.
// - Allows:
//   - Inputs: Exact question semantics and optional bounded prepared bytes.
//   - Outputs: Panel readiness and exact prepare/submit acknowledgements.
//   - Side effects: Open the Add Question modal, set one hidden form value,
//     attach one owned File, and click one Save Question submit control.
// - Split-When:
//   - Another question media family needs different verified controls.
// - Merge-When:
//   - Blooket exposes a stable provider-owned question write API.
// - Summary:
//   - Uses the observed serialized question field as the mutation boundary.
// - Description:
//   - Visible React controls are not treated as a remote success signal.
// - Usage:
//   - Open, prepare, revalidate-submit, then verify through fresh read-back.
// - Defaults:
//   - Ambiguous controls, unowned media, or malformed state fail.
//
import type { BlooketPreparedImage } from
  "../../../ir/blooket-browser-bridge/contract/prepared-image.ts";

export interface BlooketQuestionPageInput {
  readonly setId: string;
  readonly number: number;
  readonly question: string;
  readonly answers: readonly {
    readonly text: string;
    readonly correct: boolean;
  }[];
  readonly qType: "mc" | "typing";
  readonly random: boolean;
  readonly answerTypes: readonly ("exactly" | "contains")[] | null;
  readonly timeLimit: number;
  readonly image?: BlooketPreparedImage;
}

export type BlooketTextQuestionPageInput = BlooketQuestionPageInput;

export type BlooketAddQuestionPageResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

export type BlooketAddQuestionPageAction =
  | "open"
  | "open-image"
  | "cancel-image"
  | "is-ready"
  | "is-image-ready"
  | "finalize-image"
  | "prepare"
  | "submit";

export function runBlooketAddQuestionPageAction(
  action: BlooketAddQuestionPageAction,
  value: string | BlooketTextQuestionPageInput,
  expectedNumber = 1,
): boolean | BlooketAddQuestionPageResult {
  const failed = (): BlooketAddQuestionPageResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  const opens = action === "open" || action === "open-image";
  const probes = action === "is-ready" || action === "is-image-ready";
  const world = globalThis as typeof globalThis & {
    __blooketAddQuestionFormWatch?: {
      document: Document;
      setId: string;
      dirty: boolean;
      submitted: boolean;
      prepared: boolean;
      finalized: boolean;
      form?: HTMLFormElement;
      question?: HTMLInputElement;
      fileInput?: HTMLInputElement;
      file?: File;
      number?: number;
      expectedNumber?: number;
      image?: BlooketPreparedImage;
      url?: string;
      dispose: () => void;
    };
  };
  const editRoute = (setId: string): boolean => {
    if (
      !setId ||
      setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(setId)
    ) return false;
    const url = new URL(location.href);
    return (
      url.origin === "https://dashboard.blooket.com" &&
      url.pathname === "/edit" &&
      url.searchParams.getAll("id").length === 1 &&
      url.searchParams.get("id") === setId
    );
  };
  const exactPriorCards = (number: number): boolean => {
    if (!Number.isSafeInteger(number) || number < 1 || number > 200)
      return false;
    const cards = Array.from(document.querySelectorAll(
      '[role="button"][aria-label^="Edit question "]',
    ));
    return cards.length === number - 1 && cards.every((card, index) => {
      const bounds = card.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        card.getAttribute("aria-label") ===
          "Edit question " + String(index + 1);
    });
  };
  const normalizedText = (element: Element): string =>
    (element.textContent ?? "").replace(/\s+/gu, " ").trim();
  const questionForm = (setId: string): {
    readonly form: HTMLFormElement;
    readonly question: HTMLInputElement;
  } | null => {
    if (!editRoute(setId)) return null;
    const candidates = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (candidates.length !== 1 || candidates[0]?.tagName !== "INPUT")
      return null;
    const question = candidates[0] as HTMLInputElement;
    if (question.getAttribute("type") !== "hidden") return null;
    const form = question.closest("form");
    if (!form || form.tagName !== "FORM") return null;
    const setIdInputs = Array.from(
      form.querySelectorAll('input#setId[name="setId"]'),
    );
    if (
      setIdInputs.length !== 1 ||
      setIdInputs[0]?.tagName !== "INPUT" ||
      (setIdInputs[0] as HTMLInputElement).value !== setId
    )
      return null;
    return { form: form as HTMLFormElement, question };
  };
  const emptyFileInputs = (form: HTMLFormElement): boolean =>
    Array.from(form.querySelectorAll('input[type="file"]')).every(
      (candidate) => {
        const input = candidate as HTMLInputElement;
        return input.value === "" && (input.files?.length ?? 0) === 0;
      },
    );
  const serializedQuestion = (input: BlooketTextQuestionPageInput) => {
    if (
      typeof input.setId !== "string" ||
      input.setId.length < 1 ||
      input.setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(input.setId) ||
      !Number.isSafeInteger(input.number) ||
      input.number < 1 ||
      input.number > 10_000 ||
      typeof input.question !== "string" ||
      input.question.length < 1 ||
      input.question.length > 20_000 ||
      input.question.includes("`*`") ||
      typeof input.random !== "boolean" ||
      !Number.isSafeInteger(input.timeLimit) ||
      input.timeLimit < 1 ||
      input.timeLimit > 86_400 ||
      !Array.isArray(input.answers) ||
      input.answers.length < 1 ||
      input.answers.length > 100
    ) return null;
    const answers: string[] = [];
    const correctAnswers: string[] = [];
    const seen = new Set<string>();
    for (const answer of input.answers) {
      if (
        !answer ||
        typeof answer !== "object" ||
        typeof answer.text !== "string" ||
        answer.text.length < 1 ||
        answer.text.length > 10_000 ||
        typeof answer.correct !== "boolean" ||
        answer.text.includes("\0") ||
        answer.text.includes("`*`") ||
        answer.text.includes("`~`") ||
        seen.has(answer.text)
      ) return null;
      seen.add(answer.text);
      answers.push(answer.text);
      if (answer.correct) correctAnswers.push(answer.text);
    }
    if (correctAnswers.length < 1) return null;
    if (input.qType === "typing") {
      if (
        correctAnswers.length !== answers.length ||
        input.random !== true ||
        !Array.isArray(input.answerTypes) ||
        input.answerTypes.length !== answers.length ||
        !input.answerTypes.every(
          (kind) => kind === "exactly" || kind === "contains",
        )
      ) return null;
    } else if (input.qType === "mc") {
      if (
        input.answerTypes !== null ||
        answers.length < 2 ||
        answers.length > 4
      ) return null;
    } else return null;
    return {
      number: input.number,
      question: input.question,
      answers,
      correctAnswers,
      image: "",
      audio: "" as const,
      qType: input.qType,
      random: input.random,
      answerTypes: input.answerTypes,
      timeLimit: input.timeLimit,
    };
  };

  try {
    // Browser scripts are serialized separately. A prior edit-page read
    // cannot establish that this injected action still owns a valid session.
    const visibleUnique = (selector: string): boolean => {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length !== 1) return false;
      const bounds = nodes[0]!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    };
    const logoutSelector = 'a[href="https://id.blooket.com/logout"]';
    const logout = Array.from(document.querySelectorAll(logoutSelector));
    const accountSelector = 'a[href="https://id.blooket.com/login"]';
    const authenticated = visibleUnique("main") &&
      visibleUnique('nav a[href="/my-sets"]') &&
      logout.length === 1 &&
      logout[0]!.textContent?.trim() === "Logout" &&
      (visibleUnique(logoutSelector) ||
        (visibleUnique(accountSelector) &&
          !!document.querySelector(accountSelector)?.textContent?.trim()));
    if (!authenticated)
      return opens || probes ? false : failed();
    // Independently reject human/security overlays on every injected step.
    // The old Edit controls can remain mounted behind a new provider stop.
    const challenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    const organizationPrompt = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 &&
        heading.textContent?.trim() === "Select your organization";
    });
    if (document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]') !== null ||
        challenge || organizationPrompt)
      return opens || probes ? false : failed();
    if (
      action !== "open" &&
      action !== "open-image" &&
      action !== "cancel-image" &&
      action !== "is-ready" &&
      action !== "is-image-ready" &&
      action !== "finalize-image" &&
      action !== "prepare" &&
      action !== "submit"
    ) return failed();
    if (opens) {
      if (typeof value !== "string" || !editRoute(value) ||
          !Number.isSafeInteger(expectedNumber) || expectedNumber < 1 ||
          expectedNumber > 200) return false;
      if (document.querySelector('input#question[name="question"]'))
        return false;
      // One final DOM-local preflight shares the same synchronous function
      // as the Add Question click. A late manually added card cannot
      // overtake the host's earlier two collection reads.
      if (!exactPriorCards(expectedNumber)) return false;
      const dialogs = Array.from(document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      ));
      if (dialogs.some(dialog => {
        const bounds = dialog.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return false;
        const style = getComputedStyle(dialog);
        return style.display !== "none" && style.visibility !== "hidden" &&
          style.visibility !== "collapse";
      })) return false;
      let buttons = Array.from(document.querySelectorAll("button")).filter(
        (button) => normalizedText(button) === "Add Question",
      );
      // The live Edit page repeats Add Question in its header and list.
      // Resolve the observed list toolbar instead of choosing by DOM order.
      if (buttons.length === 2) {
        buttons = buttons.filter(button => {
          const peers = Array.from(
            button.parentElement?.querySelectorAll("button") ?? [],
          );
          return peers.filter(peer =>
            normalizedText(peer) === "Add Question").length === 1 &&
            peers.filter(peer =>
              normalizedText(peer) === "Show all answers").length === 1;
        });
      }
      if (buttons.length !== 1 || buttons[0]?.tagName !== "BUTTON")
        return false;
      const opener = buttons[0] as HTMLButtonElement;
      const bounds = opener.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || opener.disabled ||
          opener.getAttribute("aria-disabled") === "true") return false;
      {
        // Do not revoke a previous upload's Blob URL or abandon a teacher's
        // local draft. A submitted modal may still have a server action in
        // flight even after the transport lease is no longer available.
        const previous = world.__blooketAddQuestionFormWatch;
        if (previous && previous.document === document &&
            (previous.submitted || previous.dirty ||
              previous.form?.isConnected !== false)) return false;
        // Only a modal opened by this isolated-world owner may be written.
        previous?.dispose();
        const watch: NonNullable<
          typeof world.__blooketAddQuestionFormWatch
        > = {
          document, setId: value, expectedNumber, dirty: false,
          prepared: false, finalized: false,
          submitted: false, dispose: () => {},
        };
        const types = ["pointerdown", "keydown", "input", "change"];
        const onInteraction = (event: Event) => {
          if (event.isTrusted) watch.dirty = true;
        };
        let observer: MutationObserver | undefined;
        watch.dispose = () => {
          for (const type of types)
            watch.document.removeEventListener(type, onInteraction, true);
          observer?.disconnect();
          // The provider owns its preview URL and its cleanup lifecycle.
          if (world.__blooketAddQuestionFormWatch === watch)
            delete world.__blooketAddQuestionFormWatch;
        };
        try {
          for (const type of types)
            document.addEventListener(type, onInteraction, true);
          observer = new MutationObserver(() => {
            if (watch.form && !watch.form.isConnected) watch.dispose();
          });
          observer.observe(document, { childList: true, subtree: true });
          world.__blooketAddQuestionFormWatch = watch;
          opener.click();
        } catch { watch.dispose(); return false; }
      }
      return true;
    }
    if (action === "is-ready") {
      if (typeof value !== "string") return false;
      const resolved = questionForm(value);
      if (!resolved) return false;
      const watch = world.__blooketAddQuestionFormWatch;
      if (!watch || watch.document !== document || watch.setId !== value ||
          watch.dirty || watch.submitted ||
          (watch.form && watch.form !== resolved.form) ||
          (watch.question && watch.question !== resolved.question))
        return false;
      watch.form = resolved.form;
      watch.question = resolved.question;
      return true;
    }
    if (action === "is-image-ready") {
      if (typeof value !== "string") return false;
      const resolved = questionForm(value);
      const watch = world.__blooketAddQuestionFormWatch;
      if (!resolved || !watch || watch.document !== document ||
          watch.setId !== value || watch.dirty || watch.submitted ||
          !watch.prepared || watch.finalized || !watch.image || !watch.file ||
          watch.form !== resolved.form || watch.question !== resolved.question)
        return false;
      const fields = resolved.form.querySelectorAll(
        'input[name="coverImageFile"]',
      );
      if (fields.length !== 1 || fields[0]?.tagName !== "INPUT") return false;
      const fileInput = fields[0] as HTMLInputElement;
      if (fileInput.type !== "file" || fileInput.name !== "coverImageFile" ||
          !fileInput.hidden || fileInput.disabled ||
          fileInput.getAttribute("form") !== null ||
          fileInput.closest("form") !== resolved.form ||
          fileInput.files?.length !== 1 || fileInput.files[0] !== watch.file)
        return false;
      const removes = Array.from(resolved.form.querySelectorAll("button"))
        .filter(button => normalizedText(button) === "Remove Image");
      if (removes.length !== 1 || removes[0]?.tagName !== "BUTTON")
        return false;
      const remove = removes[0] as HTMLButtonElement;
      const bounds = remove.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || remove.disabled ||
          remove.getAttribute("aria-disabled") === "true") return false;
      if (resolved.question.value.length > 100_000) return false;
      const raw: unknown = JSON.parse(resolved.question.value);
      if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
          !("number" in raw) || raw.number !== watch.number ||
          !("audio" in raw) || raw.audio !== "" ||
          !("image" in raw) || typeof raw.image !== "string" ||
          raw.image.length > 2_000 ||
          !raw.image.startsWith("blob:https://dashboard.blooket.com/"))
        return false;
      if ((watch.fileInput && watch.fileInput !== fileInput) ||
          (watch.url && watch.url !== raw.image)) return false;
      watch.fileInput = fileInput;
      watch.url = raw.image;
      return true;
    }
    if (action === "cancel-image") {
      if (typeof value !== "string") return failed();
      const resolved = questionForm(value);
      const watch = world.__blooketAddQuestionFormWatch;
      if (!resolved || !watch || watch.document !== document ||
          watch.setId !== value || watch.dirty || watch.submitted ||
          watch.form !== resolved.form || watch.question !== resolved.question)
        return failed();
      const buttons = Array.from(resolved.form.querySelectorAll(
        'button[type="button"]',
      )).filter(button => normalizedText(button) === "Cancel");
      if (buttons.length !== 1 || buttons[0]?.tagName !== "BUTTON")
        return failed();
      const cancel = buttons[0] as HTMLButtonElement;
      const bounds = cancel.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || cancel.disabled ||
          cancel.getAttribute("aria-disabled") === "true") return failed();
      cancel.click();
      watch.dispose();
      return { ok: true };
    }
    if (typeof value === "string") return failed();
    const input = value;
    const expected = serializedQuestion(input);
    if (expected === null) return failed();
    const resolved = questionForm(input.setId);
    if (resolved === null) return failed();
    const hasImage = Object.hasOwn(input, "image");
    const watch = world.__blooketAddQuestionFormWatch;
    if (!watch || watch.document !== document ||
        watch.setId !== input.setId || watch.dirty || watch.submitted ||
        (watch.expectedNumber !== undefined &&
          watch.expectedNumber !== input.number) ||
        (watch.form && watch.form !== resolved.form) ||
        (watch.question && watch.question !== resolved.question) ||
        (action === "prepare" && watch.prepared) ||
        (action === "finalize-image" &&
          (!hasImage || !watch.prepared || watch.finalized)) ||
        (action === "submit" && !watch.finalized)) return failed();
    if (hasImage) {
      const image = input.image;
      if (!image || typeof image !== "object" ||
          Object.keys(image).sort().join() !== "base64,format" ||
          (image.format !== "png" && image.format !== "jpeg" &&
            image.format !== "gif") || typeof image.base64 !== "string" ||
          image.base64.length < 4 || image.base64.length > 3_333_332 ||
          !watch || watch.document !== document ||
          watch.setId !== input.setId || watch.dirty || watch.submitted)
        return failed();
      if (action === "prepare") {
        if (!emptyFileInputs(resolved.form) || watch.fileInput ||
            (watch.form && watch.form !== resolved.form) ||
            resolved.form.querySelector('input[name="coverImageFile"]'))
          return failed();
        const binary = atob(image.base64);
        if (binary.length < 1 || binary.length >= 2_500_000 ||
            btoa(binary) !== image.base64) return failed();
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const valid = image.format === "png"
          ? bytes.length >= 8 &&
            [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
          : image.format === "jpeg"
            ? bytes.length >= 3 && bytes[0] === 255 &&
              bytes[1] === 216 && bytes[2] === 255
            : bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 &&
              bytes[2] === 70 && bytes[3] === 56 &&
              (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97;
        if (!valid) return failed();
        // Hand bytes to the observed provider input. Its change handler
        // prepares React media state and the hidden upload field; appending
        // our own field bypasses that state and can silently drop the image.
        const pickers = Array.from(resolved.form.querySelectorAll(
          'input[type="file"]',
        ));
        if (pickers.length !== 1 || pickers[0]?.tagName !== "INPUT")
          return failed();
        const picker = pickers[0] as HTMLInputElement;
        if (picker.name !== "" || picker.type !== "file" || picker.disabled ||
            picker.multiple || picker.getAttribute("form") !== null ||
            picker.closest("form") !== resolved.form ||
            picker.accept !== "image/jpeg,image/png,image/gif,image/svg+xml")
          return failed();
        const file = new File([bytes], "question." + image.format, {
          type: "image/" + image.format,
        });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        watch.form = resolved.form;
        watch.question = resolved.question;
        watch.file = file;
        watch.number = input.number;
        watch.image = { format: image.format, base64: image.base64 };
        // Latch before dispatch: a lost acknowledgement never permits replay.
        watch.prepared = true;
        picker.files = transfer.files;
        if (picker.files?.length !== 1 || picker.files[0] !== file)
          return failed();
        picker.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      if (watch.form !== resolved.form ||
          watch.question !== resolved.question ||
          !watch.file || !watch.fileInput || !watch.image || !watch.url ||
          watch.image.format !== image.format ||
          watch.image.base64 !== image.base64 ||
          watch.fileInput.closest("form") !== resolved.form ||
          watch.fileInput.files?.length !== 1 ||
          watch.fileInput.files[0] !== watch.file) return failed();
      const files = Array.from(resolved.form.querySelectorAll(
        'input[type="file"]',
      ));
      if (files.filter(file => file === watch.fileInput).length !== 1 ||
          files.some(file => file !== watch.fileInput &&
            ((file as HTMLInputElement).value !== "" ||
              ((file as HTMLInputElement).files?.length ?? 0) !== 0)) ||
          resolved.form.querySelectorAll('input[name="coverImageFile"]')
            .length !== 1 ||
          watch.fileInput.name !== "coverImageFile" ||
          watch.fileInput.disabled || watch.fileInput.type !== "file" ||
          watch.fileInput.getAttribute("form") !== null) return failed();
      if (action === "finalize-image") {
        if (resolved.question.value.length > 100_000) return failed();
        const raw = JSON.parse(resolved.question.value);
        if (!raw || typeof raw !== "object" ||
            raw.image !== watch.url || raw.number !== input.number ||
            raw.audio !== "") return failed();
      }
      expected.image = watch.url;
    } else if (!emptyFileInputs(resolved.form)) return failed();
    if (action === "prepare" || action === "finalize-image") {
      watch.form = resolved.form;
      watch.question = resolved.question;
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      if (descriptor?.set === undefined) return failed();
      descriptor.set.call(resolved.question, JSON.stringify(expected));
      resolved.question.dispatchEvent(new Event("input", { bubbles: true }));
      resolved.question.dispatchEvent(new Event("change", { bubbles: true }));
      watch.prepared = true;
      watch.finalized = !hasImage || action === "finalize-image";
      return { ok: true };
    }
    if (resolved.question.value !== JSON.stringify(expected) ||
        !exactPriorCards(watch.expectedNumber ?? input.number))
      return failed();
    const submits = Array.from(
      resolved.form.querySelectorAll('button[type="submit"]'),
    ).filter((button) => normalizedText(button) === "Save Question");
    if (submits.length !== 1 || submits[0]?.tagName !== "BUTTON")
      return failed();
    const submit = submits[0] as HTMLButtonElement;
    const bounds = submit.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || submit.disabled ||
        submit.getAttribute("aria-disabled") === "true")
      return failed();
    watch.submitted = true;
    submit.click();
    return { ok: true };
  } catch {
    return opens || probes ? false : failed();
  }
}

export function openBlooketAddQuestionPanel(setId: string): boolean {
  return runBlooketAddQuestionPageAction("open", setId) === true;
}

export function isBlooketAddQuestionPanelReady(setId: string): boolean {
  return runBlooketAddQuestionPageAction("is-ready", setId) === true;
}

export function prepareBlooketAddQuestionForm(
  input: BlooketTextQuestionPageInput,
): BlooketAddQuestionPageResult {
  return runBlooketAddQuestionPageAction(
    "prepare",
    input,
  ) as BlooketAddQuestionPageResult;
}

export function submitBlooketAddQuestionForm(
  input: BlooketTextQuestionPageInput,
): BlooketAddQuestionPageResult {
  return runBlooketAddQuestionPageAction(
    "submit",
    input,
  ) as BlooketAddQuestionPageResult;
}
