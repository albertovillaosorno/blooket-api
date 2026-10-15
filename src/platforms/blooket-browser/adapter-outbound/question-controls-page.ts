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
//   - Preparing provider-owned visible question editor controls.
// - Must-Not:
//   - Set hidden JSON, submit, open file pickers, or infer remote success.
// - Allows:
//   - Inputs: Admitted question semantics and an existing owned form watch.
//   - Outputs: Exact provider-generated text-state acknowledgement.
//   - Side effects: Change visible fields and their observed picker controls.
// - Split-When:
//   - Another provider editor requires independent control mechanics.
// - Merge-When:
//   - The provider supplies a stable supported question write contract.
// - Summary:
//   - Drives React editor state before its serialized form is admitted.
// - Description:
//   - Bounded waits retain form ownership and stop after human interaction.
// - Usage:
//   - Inject after opening and binding one authorized Add Question form.
// - Defaults:
//   - Ambiguity, changed documents and unmatched provider state fail closed.
//
import type { BlooketQuestionPageInput } from "./add-question-page.ts";

export async function prepareBlooketQuestionControls(
  candidate: BlooketQuestionPageInput | string,
): Promise<boolean> {
  let input: BlooketQuestionPageInput;
  try {
    input = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
    if (!input || typeof input !== "object") return false;
  } catch { return false; }
  // This function is serialized by Chrome. Keep runtime helpers inside it.
  const world = globalThis as typeof globalThis & {
    __blooketAddQuestionFormWatch?: {
      document: Document;
      setId: string;
      dirty: boolean;
      prepared: boolean;
      submitted: boolean;
      form?: HTMLFormElement;
      question?: HTMLInputElement;
      controlChangeTarget?: Element;
      controlsStarted?: boolean;
      controlsPrepared?: boolean;
    };
  };
  const watch = world.__blooketAddQuestionFormWatch;
  const form = watch?.form;
  const hidden = watch?.question;
  const visible = (element: Element): boolean => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return bounds.width > 0 && bounds.height > 0 &&
      style.display !== "none" && style.visibility === "visible" &&
      element.getAttribute("aria-disabled") !== "true";
  };
  const owned = (): boolean => {
    const url = new URL(location.href);
    return Boolean(watch && form && hidden &&
      world.__blooketAddQuestionFormWatch === watch &&
      watch.document === document && watch.setId === input.setId &&
      !watch.dirty && !watch.prepared && !watch.submitted &&
      form.isConnected && hidden.isConnected &&
      hidden.closest("form") === form &&
      url.origin === "https://dashboard.blooket.com" &&
      url.pathname === "/edit" && !url.hash &&
      url.searchParams.size === 1 &&
      url.searchParams.get("id") === input.setId &&
      document.title !== "Just a moment..." &&
      !document.querySelector('input[type="password"]') &&
      !Array.from(document.querySelectorAll(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
      )).some(visible) &&
      !Array.from(document.querySelectorAll(
        '[role="dialog"][aria-modal="true"] h3',
      )).some(node => visible(node) &&
        node.textContent?.trim() === "Select your organization"));
  };
  const pause = async (): Promise<void> =>
    await new Promise(resolve => setTimeout(resolve, 50));
  const wait = async (predicate: () => boolean): Promise<boolean> => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!owned()) return false;
      if (predicate()) return true;
      await pause();
    }
    return false;
  };
  const unique = (selector: string): HTMLElement | null => {
    const nodes = Array.from(form!.querySelectorAll(selector));
    return nodes.length === 1 && visible(nodes[0]!)
      ? nodes[0] as HTMLElement : null;
  };
  const click = (element: HTMLElement): boolean => {
    if (!owned() || !visible(element) ||
        (element as HTMLButtonElement).disabled) return false;
    // A synthetic checkbox click generates native input/change events.
    // Exempt only this exact target during this synchronous owned click.
    watch!.controlChangeTarget = element;
    try { element.click(); }
    finally { delete watch!.controlChangeTarget; }
    return owned();
  };
  const setText = async (
    element: HTMLElement | null, text: string,
  ): Promise<boolean> => {
    if (!element || !owned() ||
        (element.tagName !== "INPUT" && element.tagName !== "TEXTAREA"))
      return false;
    const control = element as HTMLInputElement | HTMLTextAreaElement;
    if (control.disabled || control.readOnly ||
        (control.maxLength >= 0 && text.length > control.maxLength))
      return false;
    const prototype = element.tagName === "INPUT"
      ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    setter.call(control, text);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    // Controlled inputs can synchronously restore their previous DOM value
    // before React commits the event's new state. Observe the same field;
    // never send another input or accept a detached replacement as its echo.
    return await wait(() => control.isConnected && control.value === text);
  };
  const raw = (): Record<string, unknown> | null => {
    if (!owned() || hidden!.value.length > 100_000) return null;
    // Chrome may report the modal ready before React publishes its initial
    // hidden state. A malformed transient value never authorizes preparation.
    try {
      const value: unknown = JSON.parse(hidden!.value);
      if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
      const record = value as Record<string, unknown>;
      const keys = ["number", "question", "answers", "correctAnswers",
        "image", "audio", "qType", "random", "answerTypes", "timeLimit"];
      if (Object.keys(record).length !== keys.length ||
          keys.some(key => !Object.hasOwn(record, key)) ||
          JSON.stringify(record) !== hidden!.value) return null;
      return record;
    } catch { return null; }
  };
  try {
    if (!owned() || watch!.controlsStarted ||
        (input.qType !== "typing" && input.qType !== "mc") ||
        (input.qType === "mc" && input.answerTypes !== null) ||
        !Array.isArray(input.answers) || input.answers.length < 1 ||
        input.answers.length > (input.qType === "mc" ? 4 : 100)) return false;
    watch!.controlsStarted = true;
    if (!await wait(() => raw() !== null)) return false;
    // Before picking a type or changing native fields, require the exact
    // intended question slot and an empty provider media state. A remounted
    // or mismatched editor must not be partly overwritten before failing.
    const initial = raw();
    if (!initial || initial["number"] !== input.number ||
        initial["image"] !== "" || initial["audio"] !== "")
      return false;
    // A provider modal may already contain a teacher's unsaved text before
    // this isolated watch was admitted. Never change its type or overwrite
    // the prompt and answers of a nonempty editor.
    if (initial["question"] !== "" ||
        !Array.isArray(initial["answers"]) ||
        initial["answers"].some(answer => answer !== "") ||
        !Array.isArray(initial["correctAnswers"]) ||
        initial["correctAnswers"].some(answer => answer !== ""))
      return false;
    // Visible React controls can contain unsaved text even while the hidden
    // serializer has not registered a first MC answer input event.
    const nativeAnswers = [
      ...Array.from(form!.querySelectorAll('textarea[id^="answer-"]')),
      ...Array.from(form!.querySelectorAll(
        'input[name="accepted-answers"]',
      )),
    ] as (HTMLTextAreaElement | HTMLInputElement)[];
    if (nativeAnswers.some(control => control.value !== "")) return false;
    // React may publish the hidden state before the visible picker mounts.
    // Waiting only for unique provider controls cannot cause another write.
    if (!await wait(() => unique('[role="combobox"]') !== null &&
        unique("textarea#question") !== null &&
        unique("input#time-limit") !== null)) return false;
    // A visible prompt may contain unsaved teacher text even while React's
    // serialized hidden value still says empty. Check before changing types.
    const originalPrompt = unique("textarea#question") as
      HTMLTextAreaElement | null;
    const originalTime = unique("input#time-limit") as
      HTMLInputElement | null;
    if (!originalPrompt || originalPrompt.value !== "" ||
        raw()?.["question"] !== "" || !originalTime ||
        originalTime.value !== String(raw()?.["timeLimit"])) return false;
    const picker = unique('[role="combobox"]');
    if (!picker) return false;
    if (raw()?.["qType"] !== input.qType) {
      if (!click(picker)) return false;
      const listId = picker.getAttribute("aria-controls");
      if (!listId || !await wait(() => {
        const list = document.getElementById(listId);
        return Boolean(list && visible(list));
      })) return false;
      const list = document.getElementById(listId)!;
      const label = input.qType === "typing"
        ? "Typing Answer" : "Multiple Choice";
      const options = Array.from(list.querySelectorAll('[role="option"]'))
        .filter(option => option.textContent?.trim() === label);
      if (options.length !== 1 || !click(options[0] as HTMLElement) ||
          !await wait(() => raw()?.["qType"] === input.qType)) return false;
    }
    // A native answer field can become populated during the provider's type
    // transition without reaching the hidden React serializer. Recheck every
    // visible input before changing the prompt, timer, or accepted answers.
    const liveAnswers = [
      ...Array.from(form!.querySelectorAll('textarea[id^="answer-"]')),
      ...Array.from(form!.querySelectorAll('input[name="accepted-answers"]')),
    ] as (HTMLTextAreaElement | HTMLInputElement)[];
    if (liveAnswers.some(answer => answer.value !== "")) return false;
    // Before changing the prompt or timer, refuse a provider editor already
    // containing unowned MC answer text in a slot this plan will not use.
    // Otherwise a partially prepared form would retain teacher data after
    // failure, but its other visible controls would already be overwritten.
    if (input.qType === "mc") {
      const existing = raw()?.["answers"];
      if (!Array.isArray(existing) || existing.length > 4 ||
          existing.some((answer, index) =>
            typeof answer !== "string" ||
            (index >= input.answers.length && answer !== "")))
        return false;
      for (let index = input.answers.length; index < 4; index++) {
        const control = unique("textarea#answer-" + index);
        if (!control || control.tagName !== "TEXTAREA" ||
            (control as HTMLTextAreaElement).value !== "") return false;
      }
    }
    if (!await wait(() => unique("textarea#question") !== null &&
        unique("input#time-limit") !== null)) return false;
    // Selecting a provider question type can replace the visible controls.
    // Recheck the teacher's text before any automated field mutation.
    const livePrompt = unique("textarea#question") as
      HTMLTextAreaElement | null;
    const liveTime = unique("input#time-limit") as HTMLInputElement | null;
    if (!livePrompt || livePrompt.value !== "" ||
        raw()?.["question"] !== "" || !liveTime ||
        liveTime.value !== String(raw()?.["timeLimit"])) return false;
    if (!await setText(livePrompt, input.question) ||
        !await wait(() => raw()?.["question"] === input.question) ||
        !await setText(unique("input#time-limit"), String(input.timeLimit)) ||
        !await wait(() => raw()?.["timeLimit"] === input.timeLimit))
      return false;
    if (input.qType === "typing") {
      if (!input.answerTypes ||
          input.answerTypes.length !== input.answers.length) return false;
      for (let index = 0; index < input.answers.length; index++) {
        if (index > 0) {
          const buttons = Array.from(form!.querySelectorAll("button"))
            .filter(button => button.textContent?.trim() ===
              "Add Alternative Answer");
          if (buttons.length !== 1 || !click(buttons[0]!) ||
              !await wait(() => form!.querySelectorAll(
                'input[name="accepted-answers"]',
              ).length === index + 1)) return false;
        }
        const fields = Array.from(form!.querySelectorAll(
          'input[name="accepted-answers"]',
        ));
        const typed = input.answers[index]!.text;
        if (fields.length !== index + 1 ||
            (fields[index] as HTMLInputElement).value !== "" ||
            !await setText(fields[index] as HTMLElement, typed) ||
            !await wait(() => {
              const value = raw()?.["answers"];
              return Array.isArray(value) &&
                value[index] === input.answers[index]!.text;
            })) return false;
        const parent = fields[index]!.parentElement;
        const matches = Array.from(parent?.querySelectorAll("button") ?? [])
          .filter(button => ["Is Exactly", "Contains"]
            .includes(button.textContent?.trim() ?? ""));
        const label = input.answerTypes[index] === "exactly"
          ? "Is Exactly" : "Contains";
        if (matches.length !== 1 ||
            (matches[0]!.textContent?.trim() !== label &&
              !click(matches[0]!)) || !await wait(() => {
              const modes = raw()?.["answerTypes"];
              return Array.isArray(modes) &&
                modes[index] === input.answerTypes![index];
            })) return false;
      }
    } else {
      const shuffle = unique("input#shuffle-toggle") as
        HTMLInputElement | null;
      if (!shuffle || shuffle.type !== "checkbox" ||
          (shuffle.checked !== input.random && !click(shuffle)) ||
          !await wait(() => raw()?.["random"] === input.random))
        return false;
      for (let index = 0; index < 4; index++) {
        const answer = input.answers[index];
        const control = unique("textarea#answer-" + index);
        if (!control || control.tagName !== "TEXTAREA") return false;
        if (answer) {
          if ((control as HTMLTextAreaElement).value !== "" ||
              !await setText(control, answer.text) || !await wait(() => {
            const serialized = raw()?.["answers"];
            return Array.isArray(serialized) &&
              serialized[index] === answer.text;
          })) return false;
        } else if ((control as HTMLTextAreaElement).value !== "") {
          // React's MC state array grows when onChange touches a slot.
          // Do not write empty strings to unused visible answer controls:
          // the provider would serialize extra blank trailing answers.
          return false;
        }
        const button = unique('button[aria-label="Mark Answer ' +
          (index + 1) + ' as Correct"]');
        const current = raw()?.["correctAnswers"];
        if (!button || !Array.isArray(current)) return false;
        const isCorrect = Boolean(answer && current.includes(answer.text));
        if (isCorrect !== Boolean(answer?.correct) &&
            (!click(button) || !await wait(() => {
              const selected = raw()?.["correctAnswers"];
              return Array.isArray(selected) &&
                selected.includes(answer!.text) === answer!.correct;
            }))) return false;
      }
    }
    const matches = await wait(() => {
      const value = raw();
      if (!value) return false;
      const answers = input.answers.map(answer => answer.text);
      const correct = input.answers.filter(answer => answer.correct)
        .map(answer => answer.text);
      return value["number"] === input.number &&
        value["question"] === input.question &&
        value["qType"] === input.qType &&
        value["random"] === input.random &&
        value["timeLimit"] === input.timeLimit && value["image"] === "" &&
        value["audio"] === "" &&
        JSON.stringify(value["answers"]) === JSON.stringify(answers) &&
        JSON.stringify(value["correctAnswers"]) === JSON.stringify(correct) &&
        JSON.stringify(value["answerTypes"]) ===
          JSON.stringify(input.answerTypes);
    });
    if (!matches) return false;
    watch!.controlsPrepared = true;
    return true;
  } catch { return false; }
}

// One last content echo is required after React finishes preparing the form.
// The hidden provider JSON alone cannot prove that the visible editor stayed
// unchanged until the one permitted Save Question click. This read-only probe
// is serialized into the same isolated world as the owned modal watch.
export function inspectBlooketPreparedQuestionEcho(
  candidate: BlooketQuestionPageInput | string,
): boolean {
  try {
    const input: BlooketQuestionPageInput = typeof candidate === "string"
      ? JSON.parse(candidate) : candidate;
    if (!input || typeof input !== "object") return false;
    const watch = (globalThis as typeof globalThis & {
      __blooketAddQuestionFormWatch?: {
        document: Document; setId: string; dirty: boolean;
        submitted: boolean; prepared: boolean; finalized: boolean;
        controlsPrepared?: boolean; form?: HTMLFormElement;
        question?: HTMLInputElement;
      };
    }).__blooketAddQuestionFormWatch;
    const form = watch?.form;
    const hidden = watch?.question;
    const url = new URL(location.href);
    if (!watch || !form || !hidden || watch.document !== document ||
        watch.setId !== input.setId || watch.dirty || watch.submitted ||
        !watch.prepared || !watch.finalized || !watch.controlsPrepared ||
        !form.isConnected || !hidden.isConnected ||
        hidden.closest("form") !== form ||
        url.origin !== "https://dashboard.blooket.com" ||
        url.pathname !== "/edit" || url.hash ||
        url.searchParams.size !== 1 ||
        url.searchParams.get("id") !== input.setId ||
        document.title === "Just a moment..." ||
        document.querySelector('input[type="password"]') ||
        !Array.isArray(input.answers) || input.answers.length < 1)
      return false;
    const visible = (element: Element): boolean => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 &&
        style.display !== "none" && style.visibility === "visible" &&
        element.getAttribute("aria-disabled") !== "true";
    };
    if (Array.from(document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
    )).some(visible) || Array.from(document.querySelectorAll(
      '[role="dialog"][aria-modal="true"] h3',
    )).some(node => visible(node) &&
      node.textContent?.trim() === "Select your organization"))
      return false;
    const unique = (selector: string): HTMLElement | null => {
      const elements = Array.from(form.querySelectorAll(selector));
      return elements.length === 1 && visible(elements[0]!)
        ? elements[0] as HTMLElement : null;
    };
    const prompt = unique("textarea#question") as
      HTMLTextAreaElement | null;
    const time = unique("input#time-limit") as HTMLInputElement | null;
    if (!unique('[role="combobox"]') || !prompt || !time ||
        prompt.tagName !== "TEXTAREA" ||
        time.tagName !== "INPUT" || time.type !== "number" ||
        prompt.disabled || prompt.readOnly || time.disabled || time.readOnly ||
        prompt.value !== input.question ||
        time.value !== String(input.timeLimit)) return false;
    if (input.qType === "typing") {
      const controls = Array.from(form.querySelectorAll(
        'input[name="accepted-answers"]',
      )) as HTMLInputElement[];
      if (!Array.isArray(input.answerTypes) ||
          controls.length !== input.answers.length ||
          input.answerTypes.length !== controls.length) return false;
      return controls.every((control, index) => {
        const parent = control.parentElement;
        const buttons = Array.from(parent?.querySelectorAll("button") ?? [])
          .filter(button => ["Is Exactly", "Contains"]
            .includes(button.textContent?.trim() ?? ""));
        const expectedMode = input.answerTypes![index] === "exactly"
          ? "Is Exactly" : "Contains";
        return control.tagName === "INPUT" && visible(control) &&
          !control.disabled && !control.readOnly &&
          control.value === input.answers[index]?.text &&
          buttons.length === 1 && visible(buttons[0]!) &&
          !buttons[0]!.disabled &&
          buttons[0]!.textContent?.trim() === expectedMode;
      });
    }
    if (input.qType !== "mc" || input.answerTypes !== null ||
        input.answers.length < 2 || input.answers.length > 4)
      return false;
    const choices = Array.from(form.querySelectorAll(
      'textarea[id^="answer-"]',
    )) as HTMLTextAreaElement[];
    const shuffle = unique("input#shuffle-toggle") as
      HTMLInputElement | null;
    // Provider correctness toggles must remain uniquely present and enabled.
    // Their checked state is compared through the separately validated native
    // serialization; do not guess a CSS class as a correctness indicator.
    const correctnessControls = Array.from({ length: 4 }, (_, index) =>
      unique('button[aria-label="Mark Answer ' +
        (index + 1) + ' as Correct"]'));
    return choices.length === 4 && shuffle?.tagName === "INPUT" &&
      shuffle.type === "checkbox" && !shuffle.disabled &&
      !shuffle.readOnly && shuffle.checked === input.random &&
      correctnessControls.every(button => button?.tagName === "BUTTON" &&
        !(button as HTMLButtonElement).disabled) &&
      choices.every((choice, index) =>
        choice.tagName === "TEXTAREA" &&
        choice.id === "answer-" + index && visible(choice) &&
        !choice.disabled && !choice.readOnly &&
        choice.value === (input.answers[index]?.text ?? ""));
  } catch {
    return false;
  }
}
