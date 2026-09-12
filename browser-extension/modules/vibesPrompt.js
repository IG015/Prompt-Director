(() => {
  const bridge = globalThis.PromptDirectorBridge ||= {};
  const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0;
  const error = (stage, errorCode, message, details = {}) => Object.assign(new Error(message), { stage, errorCode, details });

  function findEditor() {
    const fields = [...document.querySelectorAll('textarea,[role="textbox"],[contenteditable="true"],input[type="text"]')].filter(visible);
    return fields.find((element) => /prompt|describe|video|criar|gera|imagina/i.test(`${element.getAttribute("placeholder") || ""} ${element.getAttribute("aria-label") || ""}`)) || fields.find((element) => element.matches('textarea,[role="textbox"],[contenteditable="true"]'));
  }

  function waitForEditor(timeoutMs = 20000) {
    const immediate = findEditor();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => { const editor = findEditor(); if (editor) { clearTimeout(timeout); observer.disconnect(); resolve(editor); } });
      const timeout = setTimeout(() => { observer.disconnect(); reject(error("PROMPT_EDITOR_FOUND", "PROMPT_EDITOR_NOT_FOUND", "Meta Vibes prompt editor was not found.", { timeoutMs })); }, timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "class"] });
    });
  }

  function setValue(editor, prompt) {
    editor.focus();
    editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: prompt }));
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value")?.set;
      if (setter) setter.call(editor, ""); else editor.value = "";
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
      if (setter) setter.call(editor, prompt); else editor.value = prompt;
    } else {
      editor.textContent = "";
      editor.textContent = prompt;
    }
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function insert(prompt, report) {
    const editor = await waitForEditor();
    await report("PROMPT_EDITOR_FOUND", "configuring", { tagName: editor.tagName, contentEditable: editor.isContentEditable });
    setValue(editor, prompt);
    const actual = editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent;
    if (!actual?.includes(prompt.slice(0, Math.min(prompt.length, 80)))) throw error("PROMPT_INSERTED", "PROMPT_INSERTION_FAILED", "Meta Vibes did not retain the prompt text.", { promptLength: prompt.length });
    await report("PROMPT_INSERTED", "configuring", { charactersInserted: prompt.length });
  }

  bridge.prompt = { findEditor, waitForEditor, insert };
})();
