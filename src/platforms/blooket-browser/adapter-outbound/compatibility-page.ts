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
//   - Read-only, content-free Blooket question-editor compatibility signals.
// - Must-Not:
//   - Submit, click, navigate, expose account data or infer saved state.
// - Allows:
//   - Inputs: The current browser document, without user-authored arguments.
//   - Outputs: Stable route/editor states and boolean shape observations.
//   - Side effects: None; inspecting the exact current page only.
// - Split-When:
//   - A separate provider surface needs its own independent compatibility map.
// - Merge-When:
//   - A provider-owned versioned editor schema replaces DOM observation.
// - Summary:
//   - Detects changed field contracts without moving an open user editor.
// - Description:
//   - Browser-safe serialized function for optional live read-only checks.
// - Usage:
//   - Inject into an already authorized tab as a read-only diagnostic.
// - Defaults:
//   - Unknown or partially hydrated DOM is not a write-ready confirmation.
//
export interface BlooketQuestionEditorCompatibility {
  readonly kind: "blooket-question-editor-compatibility";
  readonly state: "other-page" | "editor-closed" | "human-stop" |
    "shape-compatible" | "shape-drift";
  readonly controls: {
    readonly owner: boolean;
    readonly form: boolean;
    readonly picker: boolean;
    readonly prompt: boolean;
    readonly time: boolean;
    readonly answerRows: boolean;
    readonly serialized: boolean;
    readonly matchesVisible: boolean;
  };
}

// Intentionally self-contained for Chrome scripting. Never return the page
// URL, set ID, question, answers, security tokens or any browser-owned text.
export function inspectBlooketQuestionEditorCompatibility():
  BlooketQuestionEditorCompatibility {
  const kind = "blooket-question-editor-compatibility" as const;
  const empty = {
    owner: false, form: false, picker: false, prompt: false,
    time: false, answerRows: false, serialized: false,
    matchesVisible: false,
  };
  const result = (
    state: BlooketQuestionEditorCompatibility["state"],
    controls = empty,
  ): BlooketQuestionEditorCompatibility => ({ kind, state, controls });
  try {
    const url = new URL(location.href);
    if (url.origin !== "https://dashboard.blooket.com" ||
        url.pathname !== "/edit") return result("other-page");
    if (document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]'))
      return result("human-stop");
    const isVisible = (node: Element): boolean => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility === "visible";
    };
    const challengeFrames = Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    ));
    const organizationHeadings = Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    ));
    const alertDialogs = Array.from(document.querySelectorAll(
      '[role="alertdialog"]',
    ));
    if (challengeFrames.some(isVisible) || alertDialogs.some(isVisible) ||
        organizationHeadings.some(heading => isVisible(heading) &&
          heading.textContent?.trim() === "Select your organization"))
      return result("human-stop");
    const candidates = Array.from(document.querySelectorAll(
      'input#question[name="question"]',
    ));
    if (candidates.length === 0) {
      // A Save Question button without the expected form is structural drift,
      // not proof that no user editor exists.
      const saves = Array.from(document.querySelectorAll(
        'button[type="submit"]',
      )).some(button => button.textContent?.trim() === "Save Question");
      return result(saves ? "shape-drift" : "editor-closed");
    }
    if (candidates.length !== 1 || candidates[0]?.tagName !== "INPUT")
      return result("shape-drift");
    const hidden = candidates[0] as HTMLInputElement;
    const form = hidden.closest("form");
    if (!form) return result("shape-drift");
    const unique = (selector: string): Element | null => {
      const nodes = Array.from(form.querySelectorAll(selector));
      return nodes.length === 1 ? nodes[0]! : null;
    };
    const setId = unique('input#setId[name="setId"]') as
      HTMLInputElement | null;
    const picker = unique('[role="combobox"]');
    const prompt = unique('textarea#question') as
      HTMLTextAreaElement | null;
    const time = unique('input#time-limit') as HTMLInputElement | null;
    const owner = url.searchParams.size === 1 && !url.hash &&
      url.searchParams.getAll("id").length === 1 &&
      Boolean(setId && setId.value === url.searchParams.get("id"));
    const controls = {
      ...empty,
      owner,
      form: form.tagName === "FORM" && hidden.type === "hidden",
      picker: picker !== null,
      prompt: prompt?.tagName === "TEXTAREA",
      time: time?.tagName === "INPUT" && time.type === "number",
    };
    let data: Record<string, unknown> | null = null;
    try {
      const candidate: unknown = JSON.parse(hidden.value);
      if (candidate && typeof candidate === "object" &&
          !Array.isArray(candidate)) data = candidate as
            Record<string, unknown>;
    } catch { /* A partial hydration is not evidence of compatibility. */ }
    const keys = ["number", "question", "answers", "correctAnswers",
      "image", "audio", "qType", "random", "answerTypes", "timeLimit"];
    const expected = data?.["answers"];
    const correct = data?.["correctAnswers"];
    const mode = data?.["qType"];
    const matchModes = data?.["answerTypes"];
    const validAnswers = Array.isArray(expected) &&
      expected.length >= (mode === "mc" ? 2 : 1) &&
      expected.length <= (mode === "mc" ? 4 : 100) &&
      expected.every(answer => typeof answer === "string" &&
        answer.length >= 1 && answer.length <= 10_000) &&
      new Set(expected).size === expected.length;
    const validCorrect = validAnswers && Array.isArray(correct) &&
      correct.length >= 1 && correct.length <= expected.length &&
      correct.every(answer => expected.includes(answer)) &&
      new Set(correct).size === correct.length;
    const validModes = mode === "typing"
      ? data?.["random"] === true && validAnswers && validCorrect &&
        correct.length === expected.length &&
        Array.isArray(matchModes) && matchModes.length === expected.length &&
        matchModes.every(value => value === "exactly" ||
          value === "contains")
      : mode === "mc" && matchModes === null;
    const validSemanticShape = Boolean(data && validModes &&
      Number.isSafeInteger(data["number"]) &&
      (data["number"] as number) >= 1 &&
      (data["number"] as number) <= 10_000 &&
      typeof data["question"] === "string" &&
      data["question"].length >= 1 && data["question"].length <= 20_000 &&
      Number.isSafeInteger(data["timeLimit"]) &&
      (data["timeLimit"] as number) >= 1 &&
      (data["timeLimit"] as number) <= 86_400 &&
      typeof data["random"] === "boolean" &&
      typeof data["image"] === "string" &&
      typeof data["audio"] === "string" && validCorrect);
    const serialized = Boolean(data && hidden.value.length <= 100_000 &&
      Object.keys(data).length === keys.length &&
      keys.every(key => Object.hasOwn(data!, key)) &&
      JSON.stringify(data) === hidden.value && validSemanticShape);
    const typing = data?.["qType"] === "typing";
    const mc = data?.["qType"] === "mc";
    const answers = Array.from(form.querySelectorAll(
      typing ? 'input[name="accepted-answers"]' :
        'textarea[id^="answer-"]',
    )) as (HTMLInputElement | HTMLTextAreaElement)[];
    const expectedAnswers = data?.["answers"];
    const answerRows = (typing || mc) &&
      Array.isArray(expectedAnswers) && answers.length ===
        (typing ? expectedAnswers.length : 4) &&
      answers.every((answer, index) =>
        answer.tagName === (typing ? "INPUT" : "TEXTAREA") &&
        (typing || answer.id === "answer-" + index) &&
        answer.value === (expectedAnswers[index] ?? ""));
    const matchesVisible = serialized && Boolean(
      prompt && prompt.value === data?.["question"] &&
      time && Number(time.value) === data?.["timeLimit"] && answerRows
    );
    const observed = { ...controls, answerRows, serialized,
      matchesVisible };
    return result(Object.values(observed).every(Boolean)
      ? "shape-compatible" : "shape-drift", observed);
  } catch {
    return result("shape-drift");
  }
}
