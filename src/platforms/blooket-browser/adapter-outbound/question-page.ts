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
//   - Bounded normalized question extraction from the observed Blooket modal.
// - Must-Not:
//   - Submit forms, read React internals, expose media URLs, or mutate.
// - Allows:
//   - Inputs: Exact set/question identity on the confirmed dashboard edit page.
//   - Outputs: Normalized question facts for the canonical runtime IR decoder.
//   - Side effects: Open and cancel one existing question edit modal at a time.
// - Split-When:
//   - Another question family needs different page controls or media semantics.
// - Merge-When:
//   - Blooket exposes a stable provider-owned question read API.
// - Summary:
//   - Reads verified question form state without minified CSS classes.
// - Description:
//   - Uses recovered accessible controls and serialized question form state.
// - Usage:
//   - Execute through WebExtension scripting as one serial read workflow.
// - Defaults:
//   - Ambiguous, loading, oversized, or malformed provider state fails.
//
export type QuestionPanelResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: "blooket-browser-failed" };

export function listBlooketQuestionNumbers(setId: string): QuestionPanelResult {
  const failed = (): QuestionPanelResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      !setId ||
      setId.length > 512 ||
      url.searchParams.get("id") !== setId
    )
      return failed();
    // Recovered module 35211 renders one accessible edit control per question.
    const selector =
      '[role="button"]' + '[aria-label^="Edit question "]';
    const controls = Array.from(document.querySelectorAll(selector));
    if (controls.length > 200) return failed();
    if (
      controls.length === 0 &&
      !Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Add Question",
      )
    )
      return failed();
    const numbers: number[] = [];
    const seen = new Set<number>();
    for (const control of controls) {
      const label = control.getAttribute("aria-label") ?? "";
      const match = /^Edit question ([1-9][0-9]*)$/u.exec(label);
      if (!match) return failed();
      const number = Number(match[1]);
      if (
        !Number.isSafeInteger(number) ||
        number < 1 ||
        number > 10_000 ||
        seen.has(number)
      )
        return failed();
      seen.add(number);
      numbers.push(number);
    }
    return { ok: true, value: numbers };
  } catch {
    return failed();
  }
}

export function openBlooketQuestionPanel(questionNumber: number): boolean {
  try {
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/edit" ||
      !Number.isSafeInteger(questionNumber) ||
      questionNumber < 1
    )
      return false;
    const controls = Array.from(
      document.querySelectorAll(
        '[role="button"][aria-label="Edit question ' +
          String(questionNumber) +
          '"]',
      ),
    );
    if (controls.length !== 1) return false;
    const buttons = Array.from(controls[0]!.querySelectorAll("button")).filter(
      (button) =>
        button.textContent?.replace(/\u00a0/gu, " ").trim() === "Edit",
    );
    if (buttons.length !== 1) return false;
    (buttons[0] as HTMLButtonElement).click();
    return true;
  } catch {
    return false;
  }
}

export function inspectOpenedBlooketQuestion(
  expectedNumber: number,
): QuestionPanelResult {
  const failed = (): QuestionPanelResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/edit" ||
      !Number.isSafeInteger(expectedNumber) ||
      expectedNumber < 1
    )
      return failed();
    // Recovered module 89770 serializes the current question into this field.
    const hidden = document.querySelector('input#question[name="question"]');
    if (hidden?.tagName !== "INPUT") return failed();
    const raw = (hidden as HTMLInputElement).value;
    if (typeof raw !== "string" || raw.length < 2 || raw.length > 100_000)
      return failed();
    const candidate = JSON.parse(raw) as unknown;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return failed();
    const value = candidate as Record<string, unknown>;
    const {
      number,
      question,
      qType,
      random,
      timeLimit,
      answers,
      correctAnswers,
      answerTypes,
      image,
      audio,
    } = value;
    const imageAnswerMarker = "\u0060~\u0060";
    const mathAnswerMarker = "\u0060*\u0060";
    const normalizedAnswerTypes =
      qType === "mc" && Array.isArray(answerTypes) && answerTypes.length === 0
        ? null
        : answerTypes;
    const uniqueCorrect = Array.isArray(correctAnswers)
      ? new Set(correctAnswers)
      : new Set<unknown>();
    if (
      number !== expectedNumber ||
      typeof question !== "string" ||
      question.length < 1 ||
      question.length > 20_000 ||
      (qType !== "mc" && qType !== "typing") ||
      typeof random !== "boolean" ||
      !Number.isSafeInteger(timeLimit) ||
      (timeLimit as number) < 1 ||
      (timeLimit as number) > 86_400 ||
      !Array.isArray(answers) ||
      answers.length > 100 ||
      !answers.every(
        (answer) =>
          typeof answer === "string" &&
          answer.length > 0 &&
          answer.length <= 10_000,
      ) ||
      !Array.isArray(correctAnswers) ||
      correctAnswers.length > answers.length ||
      uniqueCorrect.size !== correctAnswers.length ||
      !correctAnswers.every(
        (answer) => typeof answer === "string" && answers.includes(answer),
      ) ||
      !(
        (qType === "mc" && normalizedAnswerTypes === null) ||
        (qType === "typing" &&
          Array.isArray(normalizedAnswerTypes) &&
          normalizedAnswerTypes.length === answers.length &&
          normalizedAnswerTypes.every(
            (kind) => kind === "exactly" || kind === "contains",
          ))
      ) ||
      typeof image !== "string" ||
      image.length > 20_000 ||
      typeof audio !== "string" ||
      audio.length > 20_000
    )
      return failed();
    const typingAnswerTypes = qType === "typing"
      ? normalizedAnswerTypes as ("exactly" | "contains")[]
      : [];
    const normalizedAnswers = answers.map((answer, index) => {
      const correct = correctAnswers.includes(answer);
      const match = qType === "typing"
        ? typingAnswerTypes[index] ?? null
        : null;
      if (answer.startsWith(imageAnswerMarker)) {
        if (
          qType !== "mc" ||
          answer.length <= imageAnswerMarker.length ||
          answer.indexOf(imageAnswerMarker, imageAnswerMarker.length) !== -1
        )
          return undefined;
        return { kind: "image", content: null, correct, match: null };
      }
      if (answer.includes(imageAnswerMarker)) return undefined;
      if (answer.startsWith(mathAnswerMarker)) {
        if (
          qType !== "mc" ||
          !answer.endsWith(mathAnswerMarker) ||
          answer.length <= mathAnswerMarker.length * 2
        )
          return undefined;
        return {
          kind: "math",
          content: answer.slice(
            mathAnswerMarker.length,
            -mathAnswerMarker.length,
          ),
          correct,
          match: null,
        };
      }
      return { kind: "text", content: answer, correct, match };
    });
    if (normalizedAnswers.some((answer) => answer === undefined))
      return failed();
    return {
      ok: true,
      value: {
        schemaVersion: 2,
        number,
        question,
        qType,
        random,
        timeLimit,
        answers: normalizedAnswers,
        hasImage: image.length > 0,
        hasAudio: audio.length > 0,
      },
    };
  } catch {
    return failed();
  }
}

export function closeBlooketQuestionPanel(): boolean {
  try {
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/edit"
    )
      return false;
    const forms = Array.from(
      document.querySelectorAll('form input#question[name="question"]'),
    );
    if (forms.length !== 1) return false;
    const form = forms[0]!.closest("form");
    if (!form) return false;
    const buttons = Array.from(form.querySelectorAll('button[type="button"]'))
      .filter((button) => button.textContent?.trim() === "Cancel");
    if (buttons.length !== 1) return false;
    (buttons[0] as HTMLButtonElement).click();
    return true;
  } catch {
    return false;
  }
}export function isBlooketQuestionPanelClosed(): boolean {
  try {
    return (
      location.origin === "https://dashboard.blooket.com" &&
      location.pathname === "/edit" &&
      document.querySelector('input#question[name="question"]') === null
    );
  } catch {
    return false;
  }
}
