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
    // Every function is serialized independently by Chrome scripting.
    // Do not interact with a stale authenticated shell or a human prompt.
    // Chrome serializes this function without shared module helpers.
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
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return failed();
    // A teacher-owned edit modal must not be mistaken for an unoccupied page.
    if (document.querySelector('input#question[name="question"]'))
      return failed();
    const url = new URL(location.href);
    if (
      url.origin !== "https://dashboard.blooket.com" ||
      url.pathname !== "/edit" ||
      !setId ||
      setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      url.searchParams.getAll("id").length !== 1 ||
      url.searchParams.get("id") !== setId
    )
      return failed();
    // Recovered module 35211 renders one accessible edit control per question.
    const selector =
      '[role="button"]' + '[aria-label^="Edit question "]';
    const controls = Array.from(document.querySelectorAll(selector));
    // Modules 34719/80409 render the set counter beside its title,
    // independently of question cards. Live Edit confirms 0 and 2 Questions.
    // Add Question alone cannot establish emptiness or complete hydration.
    const headings = Array.from(document.querySelectorAll("main h1"));
    if (headings.length !== 1) return failed();
    const headingBounds = headings[0]!.getBoundingClientRect();
    const header = headings[0]!.parentElement?.parentElement;
    if (!header || headingBounds.width <= 0 || headingBounds.height <= 0)
      return failed();
    const headerButtons = Array.from(header.querySelectorAll("button"));
    for (const label of ["Save Set", "Edit Info"]) {
      const matches = headerButtons.filter(button =>
        button.textContent?.replace(/\u00a0/gu, " ").trim() === label);
      if (matches.length !== 1) return failed();
      const bounds = matches[0]!.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return failed();
    }
    const counters = Array.from(header.querySelectorAll("div")).filter(node =>
      node.querySelectorAll("*").length === 0 &&
      /^(0|[1-9][0-9]*) Questions?$/u
        .test(node.textContent?.trim() ?? ""));
    if (counters.length !== 1) return failed();
    const counter = counters[0]!;
    const counterBounds = counter.getBoundingClientRect();
    const count = Number(counter.textContent!.trim().split(" ")[0]);
    if (counterBounds.width <= 0 || counterBounds.height <= 0 ||
        !Number.isSafeInteger(count) || count > 200 ||
        controls.length !== count) return failed();
    const numbers: number[] = [];
    const seen = new Set<number>();
    for (const control of controls) {
      const bounds = control.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return failed();
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

export function openBlooketQuestionPanel(
  setId: string,
  questionNumber: number,
): boolean {
  try {
    // Every function is serialized independently by Chrome scripting.
    // Do not interact with a stale authenticated shell or a human prompt.
    // Chrome serializes this function without shared module helpers.
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
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    // Do not click another question while the teacher is editing a modal.
    if (document.querySelector('input#question[name="question"]'))
      return false;
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/edit" ||
      !setId ||
      setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      new URL(location.href).searchParams.getAll("id").length !== 1 ||
      new URL(location.href).searchParams.get("id") !== setId ||
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
    const cardBounds = controls[0]!.getBoundingClientRect();
    if (cardBounds.width <= 0 || cardBounds.height <= 0) return false;
    const buttons = Array.from(controls[0]!.querySelectorAll("button")).filter(
      (button) =>
        button.textContent?.replace(/\u00a0/gu, " ").trim() === "Edit",
    );
    if (buttons.length !== 1) return false;
    const editBounds = buttons[0]!.getBoundingClientRect();
    if (editBounds.width <= 0 || editBounds.height <= 0 ||
        (buttons[0] as HTMLButtonElement).disabled ||
        buttons[0]!.getAttribute("aria-disabled") === "true") return false;
    // A question reader owns this modal only until the teacher interacts.
    // Injected helpers use the same isolated browser world, not a page-global
    // DOM attribute that a provider script could forge.
    const world = globalThis as typeof globalThis & {
      __blooketQuestionEditWatch?: {
        document: Document;
        setId: string;
        number: number;
        dirty: boolean;
        dispose: () => void;
      };
    };
    world.__blooketQuestionEditWatch?.dispose();
    const watch = {
      document,
      setId,
      number: questionNumber,
      dirty: false,
      dispose: () => {},
    };
    const onInteraction = (event: Event) => {
      if (event.isTrusted) watch.dirty = true;
    };
    const eventTypes = ["pointerdown", "keydown", "input", "change"];
    watch.dispose = () => {
      for (const type of eventTypes)
        document.removeEventListener(type, onInteraction, true);
      if (world.__blooketQuestionEditWatch === watch)
        delete world.__blooketQuestionEditWatch;
    };
    for (const type of eventTypes)
      document.addEventListener(type, onInteraction, true);
    world.__blooketQuestionEditWatch = watch;
    try {
      (buttons[0] as HTMLButtonElement).click();
      return true;
    } catch {
      watch.dispose();
      return false;
    }
  } catch {
    return false;
  }
}

export function inspectOpenedBlooketQuestion(
  setId: string,
  expectedNumber: number,
): QuestionPanelResult {
  const failed = (): QuestionPanelResult => ({
    ok: false,
    code: "blooket-browser-failed",
  });
  try {
    // Every function is serialized independently by Chrome scripting.
    // Do not interact with a stale authenticated shell or a human prompt.
    // Chrome serializes this function without shared module helpers.
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
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return failed();
    if (
      location.origin !== "https://dashboard.blooket.com" ||
      location.pathname !== "/edit" ||
      !setId ||
      setId.length > 512 ||
      /[\x00-\x1f\x7f]/u.test(setId) ||
      new URL(location.href).searchParams.getAll("id").length !== 1 ||
      new URL(location.href).searchParams.get("id") !== setId ||
      !Number.isSafeInteger(expectedNumber) ||
      expectedNumber < 1
    )
      return failed();
    // Recovered module 89770 serializes the current question into this field.
    const fields = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (
      fields.length !== 1 ||
      fields[0]?.tagName !== "INPUT" ||
      fields[0].getAttribute("type") !== "hidden"
    ) return failed();
    const hidden = fields[0]! as HTMLInputElement;
    const form = hidden.closest("form");
    if (form?.tagName !== "FORM") return failed();
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return failed();
    // The serialized hidden field alone can survive an obsolete/closed modal.
    // The recovered edit form displays both controls only when loaded and
    // interactive; a pending Save loader also hides these controls.
    const saves = Array.from(form.querySelectorAll('button[type="submit"]'))
      .filter(button => button.textContent?.replace(/\s+/gu, " ").trim() ===
        "Save Question");
    const cancels = Array.from(form.querySelectorAll('button[type="button"]'))
      .filter(button => button.textContent?.replace(/\s+/gu, " ").trim() ===
        "Cancel");
    if (saves.length !== 1 || cancels.length !== 1) return failed();
    for (const button of [...saves, ...cancels]) {
      const bounds = button.getBoundingClientRect();
      if (button.tagName !== "BUTTON" || bounds.width <= 0 ||
          bounds.height <= 0 || (button as HTMLButtonElement).disabled ||
          button.getAttribute("aria-disabled") === "true") return failed();
    }
    const raw = hidden.value;
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
    if (
      typeof question !== "string" ||
      question.length < 1 ||
      question.length > 20_000
    )
      return failed();
    const firstQuestionMath = question.indexOf(mathAnswerMarker);
    const finalQuestionMath = question.length - mathAnswerMarker.length;
    let questionText = question;
    let equation: string | null = null;
    if (firstQuestionMath !== -1) {
      const nextQuestionMath = question.indexOf(
        mathAnswerMarker,
        firstQuestionMath + mathAnswerMarker.length,
      );
      if (
        firstQuestionMath < 1 ||
        finalQuestionMath <= firstQuestionMath + mathAnswerMarker.length ||
        !question.endsWith(mathAnswerMarker) ||
        nextQuestionMath !== finalQuestionMath
      )
        return failed();
      questionText = question.slice(0, firstQuestionMath);
      equation = question.slice(
        firstQuestionMath + mathAnswerMarker.length,
        finalQuestionMath,
      );
    }
    const normalizedAnswerTypes =
      qType === "mc" && Array.isArray(answerTypes) && answerTypes.length === 0
        ? null
        : answerTypes;
    const uniqueCorrect = Array.isArray(correctAnswers)
      ? new Set(correctAnswers)
      : new Set<unknown>();
    if (
      number !== expectedNumber ||
      (qType !== "mc" && qType !== "typing") ||
      typeof random !== "boolean" ||
      !Number.isSafeInteger(timeLimit) ||
      (timeLimit as number) < 1 ||
      (timeLimit as number) > 86_400 ||
      !Array.isArray(answers) ||
      answers.length > 100 ||
      // The provider identifies correct rows by their string value. Duplicate
      // values can fabricate correctness for more than one distinct answer.
      new Set(answers).size !== answers.length ||
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
    if (
      Number(equation !== null) +
        Number(image.length > 0) +
        Number(audio.length > 0) > 1
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
        const finalMarker = answer.length - mathAnswerMarker.length;
        const nextMarker = answer.indexOf(
          mathAnswerMarker,
          mathAnswerMarker.length,
        );
        if (
          qType !== "mc" ||
          !answer.endsWith(mathAnswerMarker) ||
          answer.length <= mathAnswerMarker.length * 2 ||
          nextMarker !== finalMarker
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
        schemaVersion: 3,
        number,
        question: questionText,
        equation,
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

export function closeBlooketQuestionPanel(setId: string): boolean {
  try {
    // Every function is serialized independently by Chrome scripting.
    // Do not interact with a stale authenticated shell or a human prompt.
    // Chrome serializes this function without shared module helpers.
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
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
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
    const fields = Array.from(
      document.querySelectorAll('input#question[name="question"]'),
    );
    if (
      fields.length !== 1 ||
      fields[0]?.tagName !== "INPUT" ||
      fields[0].getAttribute("type") !== "hidden"
    ) return false;
    const form = fields[0]!.closest("form");
    if (form?.tagName !== "FORM") return false;
    const identities = Array.from(form.querySelectorAll(
      'input#setId[name="setId"]',
    ));
    if (
      identities.length !== 1 ||
      identities[0]?.tagName !== "INPUT" ||
      identities[0].getAttribute("type") !== "hidden" ||
      (identities[0] as HTMLInputElement).value !== setId
    ) return false;
    const buttons = Array.from(form.querySelectorAll('button[type="button"]'))
      .filter((button) => button.textContent?.trim() === "Cancel");
    if (buttons.length !== 1) return false;
    const cancel = buttons[0] as HTMLButtonElement;
    const bounds = cancel.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || cancel.disabled ||
        cancel.getAttribute("aria-disabled") === "true") return false;
    const world = globalThis as typeof globalThis & {
      __blooketQuestionEditWatch?: {
        document: Document;
        setId: string;
        number: number;
        dirty: boolean;
        dispose: () => void;
      };
    };
    const watch = world.__blooketQuestionEditWatch;
    if (!watch || watch.document !== document || watch.setId !== setId ||
        watch.dirty) return false;
    // A different question modal is not ours, even when the set ID is equal.
    // Only its ordinal is inspected here; the untrusted draft is never sent
    // back to the extension during cancellation.
    const raw = (fields[0] as HTMLInputElement).value;
    if (typeof raw !== "string" || raw.length < 2 || raw.length > 100_000)
      return false;
    const question = JSON.parse(raw) as unknown;
    if (!question || typeof question !== "object" ||
        Array.isArray(question) || !("number" in question) ||
        question.number !== watch.number) return false;
    cancel.click();
    watch.dispose();
    return true;
  } catch {
    return false;
  }
}

export function isBlooketQuestionPanelClosed(setId: string): boolean {
  try {
    // Every function is serialized independently by Chrome scripting.
    // Do not interact with a stale authenticated shell or a human prompt.
    // Chrome serializes this function without shared module helpers.
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
    const blockedByOrganization = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some((heading) => {
      const bounds = heading.getBoundingClientRect();
      return heading.textContent?.trim() === "Select your organization" &&
        bounds.width > 0 && bounds.height > 0;
    });
    const blockedByChallenge = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some((frame) => {
      const bounds = frame.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    if (!authenticated || blockedByOrganization || blockedByChallenge)
      return false;
    return (
      location.origin === "https://dashboard.blooket.com" &&
      location.pathname === "/edit" &&
      !!setId &&
      setId.length <= 512 &&
      !/[\x00-\x1f\x7f]/u.test(setId) &&
      new URL(location.href).searchParams.getAll("id").length === 1 &&
      new URL(location.href).searchParams.get("id") === setId &&
      document.querySelector('input#question[name="question"]') === null
    );
  } catch {
    return false;
  }
}
