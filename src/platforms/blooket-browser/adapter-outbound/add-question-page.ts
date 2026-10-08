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
//   - Preparation and submission of observed text-only Add Question forms.
// - Must-Not:
//   - Upload media, infer success, read React internals, or retry submission.
// - Allows:
//   - Inputs: Exact set/question text semantics on one Blooket edit page.
//   - Outputs: Panel readiness and exact prepare/submit acknowledgements.
//   - Side effects: Open the Add Question modal, set one hidden form value,
//     and click one verified Save Question submit control.
// - Split-When:
//   - Media-backed questions gain independently verified upload mechanics.
// - Merge-When:
//   - Blooket exposes a stable provider-owned question write API.
// - Summary:
//   - Uses the observed serialized question field as the mutation boundary.
// - Description:
//   - Visible React controls are not treated as a remote success signal.
// - Usage:
//   - Open, prepare, revalidate-submit, then verify through fresh read-back.
// - Defaults:
//   - Ambiguous controls, media, duplicate answers, or malformed state fail.
//
export interface BlooketTextQuestionPageInput {
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
}

export type BlooketAddQuestionPageResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

export type BlooketAddQuestionPageAction =
  | "open"
  | "is-ready"
  | "prepare"
  | "submit";

export function runBlooketAddQuestionPageAction(
  action: BlooketAddQuestionPageAction,
  value: string | BlooketTextQuestionPageInput,
): boolean | BlooketAddQuestionPageResult {
  const failed = (): BlooketAddQuestionPageResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
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
      image: "" as const,
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
      return action === "open" || action === "is-ready" ? false : failed();
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
      return action === "open" || action === "is-ready" ? false : failed();
    if (
      action !== "open" &&
      action !== "is-ready" &&
      action !== "prepare" &&
      action !== "submit"
    ) return failed();
    if (action === "open") {
      if (typeof value !== "string" || !editRoute(value)) return false;
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
      if (buttons.length !== 1) return false;
      (buttons[0] as HTMLButtonElement).click();
      return true;
    }
    if (action === "is-ready")
      return typeof value === "string" && questionForm(value) !== null;
    if (typeof value === "string") return failed();
    const input = value;
    const expected = serializedQuestion(input);
    if (expected === null) return failed();
    const resolved = questionForm(input.setId);
    if (resolved === null || !emptyFileInputs(resolved.form)) return failed();
    if (action === "prepare") {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      if (descriptor?.set === undefined) return failed();
      descriptor.set.call(resolved.question, JSON.stringify(expected));
      resolved.question.dispatchEvent(new Event("input", { bubbles: true }));
      resolved.question.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }
    if (resolved.question.value !== JSON.stringify(expected)) return failed();
    const submits = Array.from(
      resolved.form.querySelectorAll('button[type="submit"]'),
    ).filter((button) => normalizedText(button) === "Save Question");
    if (submits.length !== 1) return failed();
    (submits[0] as HTMLButtonElement).click();
    return { ok: true };
  } catch {
    return action === "open" || action === "is-ready" ? false : failed();
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
