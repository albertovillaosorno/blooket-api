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

export function openBlooketAddQuestionPanel(setId: string): boolean {
  try {
    if (!editRoute(setId)) return false;
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (button) => normalizedText(button) === "Add Question",
    );
    if (buttons.length !== 1) return false;
    (buttons[0] as HTMLButtonElement).click();
    return true;
  } catch {
    return false;
  }
}

export function isBlooketAddQuestionPanelReady(setId: string): boolean {
  try {
    return questionForm(setId) !== null;
  } catch {
    return false;
  }
}

export function prepareBlooketAddQuestionForm(
  input: BlooketTextQuestionPageInput,
): BlooketAddQuestionPageResult {
  const failed = (): BlooketAddQuestionPageResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    const expected = serializedQuestion(input);
    if (expected === null) return failed();
    const resolved = questionForm(input.setId);
    if (resolved === null) return failed();
    if (!emptyFileInputs(resolved.form)) return failed();

    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    if (descriptor?.set === undefined) return failed();
    descriptor.set.call(resolved.question, JSON.stringify(expected));
    resolved.question.dispatchEvent(new Event("input", { bubbles: true }));
    resolved.question.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  } catch {
    return failed();
  }
}

export function submitBlooketAddQuestionForm(
  input: BlooketTextQuestionPageInput,
): BlooketAddQuestionPageResult {
  const failed = (): BlooketAddQuestionPageResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    const expected = serializedQuestion(input);
    if (expected === null) return failed();
    const resolved = questionForm(input.setId);
    if (
      resolved === null ||
      !emptyFileInputs(resolved.form) ||
      resolved.question.value !== JSON.stringify(expected)
    )
      return failed();

    const submits = Array.from(
      resolved.form.querySelectorAll('button[type="submit"]'),
    ).filter((button) => normalizedText(button) === "Save Question");
    if (submits.length !== 1) return failed();
    (submits[0] as HTMLButtonElement).click();
    return { ok: true };
  } catch {
    return failed();
  }
}

function questionForm(setId: string): {
  readonly form: HTMLFormElement;
  readonly question: HTMLInputElement;
} | null {
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
}

function editRoute(setId: string): boolean {
  if (!setId || setId.length > 512 || setId.includes("\0")) return false;
  const url = new URL(location.href);
  return (
    url.origin === "https://dashboard.blooket.com" &&
    url.pathname === "/edit" &&
    url.searchParams.getAll("id").length === 1 &&
    url.searchParams.get("id") === setId
  );
}

function emptyFileInputs(form: HTMLFormElement): boolean {
  return Array.from(form.querySelectorAll('input[type="file"]')).every(
    (candidate) => {
      const input = candidate as HTMLInputElement;
      return input.value === "" && (input.files?.length ?? 0) === 0;
    },
  );
}

function normalizedText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/gu, " ").trim();
}

function serializedQuestion(
  input: BlooketTextQuestionPageInput,
): {
  readonly number: number;
  readonly question: string;
  readonly answers: readonly string[];
  readonly correctAnswers: readonly string[];
  readonly image: "";
  readonly audio: "";
  readonly qType: "mc" | "typing";
  readonly random: boolean;
  readonly answerTypes: readonly ("exactly" | "contains")[] | null;
  readonly timeLimit: number;
} | null {
  if (
    typeof input.setId !== "string" ||
    input.setId.length < 1 ||
    input.setId.length > 512 ||
    input.setId.includes("\0") ||
    !Number.isSafeInteger(input.number) ||
    input.number < 1 ||
    input.number > 10_000 ||
    typeof input.question !== "string" ||
    input.question.length < 1 ||
    input.question.length > 20_000 ||
    typeof input.random !== "boolean" ||
    !Number.isSafeInteger(input.timeLimit) ||
    input.timeLimit < 1 ||
    input.timeLimit > 86_400 ||
    !Array.isArray(input.answers) ||
    input.answers.length < 1 ||
    input.answers.length > 100
  )
    return null;

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
      seen.has(answer.text)
    )
      return null;
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
    )
      return null;
  } else if (input.qType === "mc") {
    if (
      input.answerTypes !== null ||
      answers.length < 2 ||
      answers.length > 4
    )
      return null;
  } else {
    return null;
  }

  return {
    number: input.number,
    question: input.question,
    answers,
    correctAnswers,
    image: "",
    audio: "",
    qType: input.qType,
    random: input.random,
    answerTypes: input.answerTypes,
    timeLimit: input.timeLimit,
  };
}
