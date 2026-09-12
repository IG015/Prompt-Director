const VERSION = 1;
const bridge = globalThis.PromptDirectorBridge;
let workflow = null;
let busy = false;
const blankSteps = () => ({ ingredientsApplied: false, initialFrameApplied: false, promptInserted: false, settingsApplied: false, generationSubmitted: false });
function authRequired() {
  return !bridge.prompt.findEditor() && [...document.querySelectorAll('button,a')].some((element) => element.getClientRects().length && /log in|sign in|iniciar sess|entrar/i.test(element.textContent || element.getAttribute('aria-label') || ''));
}
function currentWorkflow(context) {
  const key = JSON.stringify([context.requestId, context.project?.id, context.shot, context.generation, context.references, location.href]);
  if (workflow?.key !== key) workflow = { key, ...blankSteps(), errors: {}, currentStep: 'IDLE', lastError: null, uploadStrategy: 'NOT_STARTED' };
  return workflow;
}
function diagnostics() {
  return {
    ...workflow, key: undefined,
    vibesState: bridge.uploader.detectVibesReferenceState().state,
    controls: { ingredients: Boolean(bridge.uploader.ingredientButton()), initialFrame: Boolean(bridge.initialFrame.findControl()), prompt: Boolean(bridge.prompt.findEditor()), duration: Boolean(bridge.generator.settingControl('duration')), aspectRatio: Boolean(bridge.generator.settingControl('ratio')), generate: Boolean(bridge.generator.findGenerateButton()) },
    fileInputsFound: bridge.uploader.deepFindFileInputs().entries.length,
    dropzonesFound: bridge.uploader.findDropzone(bridge.uploader.findUploadModal()) ? 1 : 0
  };
}
async function perform(step, context) {
  const state = currentWorkflow(context);
  const flag = { ingredients: 'ingredientsApplied', initialFrame: 'initialFrameApplied', prompt: 'promptInserted', settings: 'settingsApplied', generate: 'generationSubmitted' }[step];
  if (!flag) throw bridge.error('WORKFLOW', 'UNKNOWN_STEP', 'Unknown operation.');
  if (state.generationSubmitted) throw bridge.error('WORKFLOW', 'GENERATION_ALREADY_SUBMITTED', 'Generation already submitted for this package.');
  state.currentStep = step;
  state.lastError = null;
  delete state.errors[step];
  state[flag] = false;
  if (authRequired()) throw bridge.error('VIBES_OPENED', 'AUTH_REQUIRED', 'Meta Vibes requires login.');
  const report = async (stage, status, details) => {
    if (details?.uploadStrategy) state.uploadStrategy = details.uploadStrategy;
    await chrome.runtime.sendMessage({ version: VERSION, type: 'PD_INTERNAL_STATUS', requestId: context.requestId, stage, status, details }).catch(() => undefined);
  };
  if (step === 'ingredients') state.ingredientsEvidence = await bridge.uploader.sendIngredients(context, report);
  if (step === 'initialFrame') state.frameEvidence = await bridge.initialFrame.setInitialFrame(context, report);
  if (step === 'prompt') {
    const prompt = context.generation.prompt;
    if (!prompt?.trim()) throw bridge.error('PROMPT', 'PROMPT_EMPTY', 'No prompt provided.');
    if (prompt.length > 9500) throw bridge.error('PROMPT', 'PROMPT_TOO_LONG', `Prompt too long: ${prompt.length}/9500`);
    await bridge.prompt.insert(prompt, report);
  }
  if (step === 'settings') await bridge.generator.configure(context.generation);
  if (step === 'generate') {
    const editor = bridge.prompt.findEditor();
    state.promptInserted = state.promptInserted && (editor?.value ?? editor?.textContent) === context.generation.prompt;
    state.settingsApplied = state.settingsApplied && bridge.generator.settingsMatch(context.generation);
    state.ingredientsApplied = state.ingredientsApplied && bridge.uploader.appliedImages(state.ingredientsEvidence || []);
    state.initialFrameApplied = state.initialFrameApplied && bridge.uploader.appliedImages(state.frameEvidence || []);
    if (![state.ingredientsApplied, state.initialFrameApplied, state.promptInserted, state.settingsApplied].every(Boolean)) throw bridge.error('GENERATION', 'GENERATION_PREREQUISITES_NOT_MET', 'Apply ingredients, initial frame, prompt and settings before generating.');
    await bridge.generator.submit(report);
  }
  state[flag] = true;
  state.currentStep = step === 'generate' ? 'GENERATION_SUBMITTED' : 'IDLE';
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.version !== VERSION) return false;
  if (message.type === 'PD_VIBES_PING') { sendResponse({ ready: Boolean(document.body), authenticated: !authRequired(), url: location.href }); return false; }
  if (!['PD_VIBES_STEP', 'PD_INSERT_PROMPT', 'PD_VIBES_DIAGNOSTICS', 'PD_VIBES_GENERATE'].includes(message.type)) return false;
  (async () => {
    if (busy) throw bridge.error('WORKFLOW', 'WORKFLOW_BUSY', 'Another operation is running.');
    busy = true;
    try {
      const response = await chrome.runtime.sendMessage({ version: 1, type: 'PD_PANEL_GET_STATE' });
      const context = response?.session;
      if (!context || (message.requestId && context.requestId !== message.requestId)) throw bridge.error('WORKFLOW', 'SESSION_CHANGED', 'Reload the panel package.');
      currentWorkflow(context);
      if (message.type === 'PD_VIBES_DIAGNOSTICS') return { ok: true, diagnostics: diagnostics() };
      const step = message.type === 'PD_INSERT_PROMPT' ? 'prompt' : message.step;
      if (message.type === 'PD_VIBES_GENERATE') {
        for (const name of ['ingredients', 'initialFrame', 'prompt', 'settings', 'generate']) await perform(name, context);
      } else await perform(step, context);
      return { ok: true, diagnostics: diagnostics() };
    } finally { busy = false; }
  })().then(sendResponse).catch((error) => {
    if (workflow && error.errorCode !== 'WORKFLOW_BUSY') {
      workflow.lastError = { code: error.errorCode || 'VIBES_INTERACTION_FAILED', message: error.message, details: error.details };
      workflow.errors[workflow.currentStep] = workflow.lastError;
    }
    sendResponse({ ok: false, errorCode: error.errorCode || 'VIBES_INTERACTION_FAILED', message: error.message, diagnostics: diagnostics() });
  });
  return true;
});
