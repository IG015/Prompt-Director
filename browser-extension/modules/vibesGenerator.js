(() => {
  const bridge = globalThis.PromptDirectorBridge ||= {};
  const visible = (el) => el instanceof HTMLElement && el.getClientRects().length > 0;
  const label = (el) => bridge.uploader.normalized([el?.textContent, el?.getAttribute?.('aria-label')].filter(Boolean).join(' '));
  const controls = () => [...document.querySelectorAll('button,[role="button"],[role="combobox"],select')].filter(visible);
  const disabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true';
  const outsideMenu = (el) => !el.closest('[role="listbox"],[role="menu"],[role="dialog"]');
  function settingControl(kind) {
    const pattern = kind === 'duration' ? /duration|duracao|\b\d+\s*(s|sec|seconds|segundos)\b/ : /aspect|ratio|proporcao|formato|\d+:\d+/;
    return controls().find((el) => outsideMenu(el) && pattern.test(label(el)));
  }
  function matches(el, value) {
    if (!el) return false;
    const current = el.tagName === 'SELECT' ? `${el.value} ${el.selectedOptions[0]?.textContent || ''}` : label(el);
    return typeof value === 'number' ? new RegExp(`(?:^|\\s)${value}\\s*(?:s|sec|seconds|seg|segundos)?(?:$|\\s)`, 'i').test(current) : current.split(/\s+/).includes(value);
  }
  async function applySetting(kind, value) {
    const code = kind === 'duration' ? 'DURATION_CONTROL_NOT_FOUND' : 'ASPECT_RATIO_CONTROL_NOT_FOUND';
    const fail = () => bridge.error('SETTINGS', code, `Cannot apply and verify ${kind}: ${value}.`);
    const control = settingControl(kind);
    if (!control) throw fail();
    if (matches(control, value)) return;
    if (disabled(control)) throw fail();
    if (control.tagName === 'SELECT') {
      const option = [...control.options].find((item) => matches(item, value) || item.value === String(value));
      if (!option || option.disabled) throw fail();
      control.value = option.value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      control.click();
      const option = await bridge.uploader.waitFor(() => [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],button')].find((el) => visible(el) && el !== control && matches(el, value) && !disabled(el)), { stage: 'SETTINGS', errorCode: code, message: `No ${kind} option ${value}.` });
      option.click();
    }
    await bridge.uploader.waitFor(() => matches(settingControl(kind), value), { stage: 'SETTINGS', errorCode: code, message: `Vibes did not retain ${kind}: ${value}.` });
  }
  async function configure(generation) {
    await applySetting('duration', generation.durationSeconds);
    await applySetting('ratio', generation.aspectRatio);
  }
  function settingsMatch(generation) {
    return matches(settingControl('duration'), generation.durationSeconds) && matches(settingControl('ratio'), generation.aspectRatio);
  }
  function findGenerateButton() {
    return controls().find((el) => outsideMenu(el) && /^(generate video|generate|create video|gerar video|gerar|criar video)\b/.test(label(el)));
  }
  function generationEvidence() {
    return [...document.querySelectorAll('[role="status"],[role="progressbar"],[data-generation-id],[data-testid*="generation"],button,p,span')]
      .filter((el) => visible(el) && /generating|queued|rendering|a gerar|gerando|na fila|em fila|processando|a processar|cancel generation|cancelar geracao/.test(label(el)))
      .map((el) => `${el.getAttribute('data-generation-id') || ''}:${label(el)}`);
  }
  async function submit(report) {
    const button = findGenerateButton();
    if (!button) throw bridge.error('GENERATION', 'GENERATE_BUTTON_NOT_FOUND', 'Generate button not found.');
    if (disabled(button)) throw bridge.error('GENERATION', 'GENERATE_BUTTON_DISABLED', 'Generate button is disabled.');
    const before = generationEvidence();
    button.click();
    await bridge.uploader.waitFor(() => {
      const after = generationEvidence();
      return after.some((item) => after.filter((x) => x === item).length > before.filter((x) => x === item).length);
    }, { timeoutMs: 30000, stage: 'GENERATION', errorCode: 'GENERATION_SUBMISSION_FAILED', message: 'No new generation progress appeared. Check Vibes before retrying.' });
    await report('GENERATION_SUBMITTED', 'generating', { verified: true });
  }
  bridge.generator = { configure, submit, findGenerateButton, settingControl, settingsMatch };
})();
