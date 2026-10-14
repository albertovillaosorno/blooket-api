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
  input: BlooketQuestionPageInput,
): Promise<boolean> {
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
  const setText = (element: HTMLElement | null, text: string): boolean => {
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
    return owned() && control.value === text;
  };
  const raw = (): Record<string, unknown> | null => {
    if (!owned() || hidden!.value.length > 100_000) return null;
    // Chrome may report the modal ready before React publishes its initial
    // hidden state. A malformed transient value never authorizes preparation.
    try {
      const value: unknown = JSON.parse(hidden!.value);
      return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
    } catch { return null; }
  };
  try {
    if (!owned() || watch!.controlsStarted ||
        (input.qType !== "typing" && input.qType !== "mc") ||
        !Array.isArray(input.answers) || input.answers.length < 1 ||
        input.answers.length > (input.qType === "mc" ? 4 : 100)) return false;
    watch!.controlsStarted = true;
    if (!await wait(() => raw() !== null)) return false;
    // React may publish the hidden state before the visible picker mounts.
    // Waiting only for unique provider controls cannot cause another write.
    if (!await wait(() => unique('[role="combobox"]') !== null))
      return false;
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
    if (!await wait(() => unique("textarea#question") !== null &&
        unique("input#time-limit") !== null) ||
        !setText(unique("textarea#question"), input.question) ||
        !setText(unique("input#time-limit"), String(input.timeLimit)))
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
        if (fields.length !== index + 1 ||
            !setText(fields[index] as HTMLElement, input.answers[index]!.text))
          return false;
        const parent = fields[index]!.parentElement;
        const matches = Array.from(parent?.querySelectorAll("button") ?? [])
          .filter(button => ["Is Exactly", "Contains"]
            .includes(button.textContent?.trim() ?? ""));
        const label = input.answerTypes[index] === "exactly"
          ? "Is Exactly" : "Contains";
        if (matches.length !== 1 ||
            (matches[0]!.textContent?.trim() !== label &&
              !click(matches[0]!))) return false;
      }
    } else {
      const shuffle = unique("input#shuffle-toggle") as
        HTMLInputElement | null;
      if (!shuffle || shuffle.type !== "checkbox" ||
          (shuffle.checked !== input.random && !click(shuffle))) return false;
      for (let index = 0; index < 4; index++) {
        const answer = input.answers[index];
        if (!setText(unique("textarea#answer-" + index), answer?.text ?? ""))
          return false;
        const button = unique('button[aria-label="Mark Answer ' +
          (index + 1) + ' as Correct"]');
        const current = raw()?.["correctAnswers"];
        if (!button || !Array.isArray(current)) return false;
        const isCorrect = Boolean(answer && current.includes(answer.text));
        if (isCorrect !== Boolean(answer?.correct) && !click(button))
          return false;
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
