const state = { session: null, assets: new Map(), mode: localStorage.getItem("pd-bridge-mode") || "ASSISTED" };
const $ = (selector) => document.querySelector(selector);

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function send(message) {
  return chrome.runtime.sendMessage({ version: 1, ...message });
}

function assetLabel(reference) {
  const value = `${reference.type || ""} ${reference.role || ""} ${reference.name || ""}`.toLowerCase();
  if (value.includes("storyboard")) return `Storyboard ${state.session?.shot?.shotId || ""}`.trim();
  if (value.includes("scaeva")) return "Scaeva Official";
  if (value.includes("vitus") && value.includes("hair")) return "Vitus Hair";
  if (value.includes("vitus")) return "Vitus Official";
  return reference.name;
}

async function loadAsset(reference) {
  if (reference.status !== "ready" || state.assets.has(reference.id)) return;
  const response = await send({ type: "PD_PANEL_GET_ASSET", assetId: reference.id });
  if (response?.ok) state.assets.set(reference.id, response.asset);
}

function referenceCard(reference) {
  const card = document.createElement("article");
  card.className = "reference-card";
  const thumb = document.createElement("button");
  thumb.className = "thumb";
  thumb.disabled = reference.status !== "ready";
  const asset = state.assets.get(reference.id);
  if (asset) { const image = document.createElement("img"); image.src = asset.dataUrl; image.alt = assetLabel(reference); thumb.append(image); }
  else { const fallback = document.createElement("span"); fallback.textContent = reference.status === "failed" ? "!" : "…"; thumb.append(fallback); }
  const copy = document.createElement("div");
  copy.className = "reference-copy";
  const name = document.createElement("strong"); name.textContent = assetLabel(reference);
  const status = document.createElement("small"); status.className = reference.status === "ready" ? "ok" : reference.status; status.textContent = reference.status === "ready" ? `✓ ${reference.name}` : reference.error || "Loading…";
  const actions = document.createElement("div"); actions.className = "reference-actions";
  const view = document.createElement("button"); view.textContent = "VIEW"; view.disabled = !asset;
  const download = document.createElement("button"); download.textContent = "DOWNLOAD"; download.disabled = !asset;
  view.addEventListener("click", () => { $("#viewer-image").src = asset.dataUrl; $("#viewer-name").textContent = reference.name; $("#asset-viewer").showModal(); });
  download.addEventListener("click", () => { const link = document.createElement("a"); link.href = asset.dataUrl; link.download = reference.name; link.click(); });
  actions.append(view, download); copy.append(name, status, actions); card.append(thumb, copy);
  thumb.addEventListener("click", () => view.click());
  return card;
}

async function render() {
  const response = await send({ type: "PD_PANEL_GET_STATE" });
  if (state.session?.requestId !== response?.session?.requestId) { state.assets.clear(); state.workflow = null; state.tabId = null; }
  state.session = response?.session || null;
  $("#empty-state").hidden = Boolean(state.session);
  $("#session").hidden = !state.session;
  if (!state.session) { $("#connection").textContent = "Waiting for package"; return; }
  await Promise.all(state.session.references.map(loadAsset));
  const ready = state.session.references.filter((reference) => reference.status === "ready").length;
  $("#connection").textContent = state.session.status === "ready" ? `References received: ${ready}` : state.session.status === "failed" ? "Reference error" : "Resolving references";
  $("#scene-label").textContent = `SCENE ${state.session.shot.sceneId}`;
  $("#shot-label").textContent = `Shot ${state.session.shot.shotId}`;
  $("#shot-title").textContent = state.session.shot.title;
  $("#package-state").textContent = state.session.status === "ready" ? "✓ Package ready" : state.session.status === "failed" ? "Asset resolution failed" : "Resolving assets";
  $("#package-state").className = `state-pill ${state.session.status}`;
  $("#reference-count").textContent = `${ready}/${state.session.references.length}`;
  const references = $("#references"); references.replaceChildren(...state.session.references.map(referenceCard));
  $("#prompt").textContent = state.session.generation.prompt;
  $("#duration").textContent = `${state.session.generation.durationSeconds} sec`;
  $("#aspect-ratio").textContent = state.session.generation.aspectRatio;
  $("#prompt-state").textContent = state.session.steps.prompt === "ready" ? "Ready" : state.session.steps.prompt;
  $("#diag-package").textContent = state.session.diagnostics.packageValid ? "✓" : "✕";
  $("#diag-assets").textContent = `${state.session.diagnostics.assetsReady}/${state.session.diagnostics.assetsExpected}`;
  $("#diag-state").textContent = state.session.diagnostics.currentState;
  $("#diag-strategy").textContent = state.session.diagnostics.uploadStrategy;
  $("#diag-inputs").textContent = state.session.diagnostics.fileInputsFound ?? "—";
  $("#diag-dropzones").textContent = state.session.diagnostics.dropzonesFound ?? "—";
  renderWorkflow();
}
const stepFlags = { ingredients: 'ingredientsApplied', initialFrame: 'initialFrameApplied', prompt: 'promptInserted', settings: 'settingsApplied', generate: 'generationSubmitted' };
const stepDefaults = { ingredients: 'Not sent', initialFrame: 'Not set', prompt: 'Not inserted', settings: 'Not applied', generate: 'Not submitted' };
function renderWorkflow() {
  const flow = state.workflow || {};
  for (const [step, flag] of Object.entries(stepFlags)) {
    const el = $(`#${step}-state`);
    const failed = flow.errors?.[step];
    el.textContent = state.currentStep === step ? '… Working' : failed ? `✕ ${failed.code}` : flow[flag] ? `✓ ${step === 'generate' ? 'Submitted' : step === 'prompt' ? 'Inserted' : 'Applied'}` : `○ ${stepDefaults[step]}`;
    el.title = failed ? failed.message : '';
  }
  const ready = ['ingredientsApplied','initialFrameApplied','promptInserted','settingsApplied'].every((key) => flow[key]);
  document.querySelectorAll('.operations button').forEach((button) => { button.disabled = Boolean(state.busy); });
  $('#generate').disabled = Boolean(state.busy || !ready || flow.generationSubmitted);
  $('#run-auto').hidden = state.mode !== 'AUTO';
  $('#run-auto').disabled = Boolean(state.busy || flow.generationSubmitted);
  $('#diag-state').textContent = flow.vibesState || 'UNKNOWN';
  $('#diag-strategy').textContent = flow.uploadStrategy || 'NOT_STARTED';
  $('#diag-inputs').textContent = flow.fileInputsFound ?? '—';
  $('#diag-dropzones').textContent = flow.dropzonesFound ?? '—';
  $('#diag-details').textContent = [
    ...(state.session?.references || []).map((asset) => `${asset.name}\n${(asset.size / 1048576).toFixed(2)} MB (${asset.size} bytes)\n${asset.mimeType}`),
    ...Object.entries(flow.controls || {}).map(([name, found]) => `${name}: ${found ? 'FOUND' : 'NOT FOUND'}`),
    `Current step: ${state.currentStep || flow.currentStep || 'IDLE'}`,
    `Last stage: ${state.lastStage || '—'}`,
    `Last error: ${flow.lastError ? JSON.stringify(flow.lastError) : 'None'}`
  ].join('\n\n');
}
async function vibesTab() {
  const tabs = await chrome.tabs.query({ url: 'https://vibes.ai/*' });
  const projectUrl = state.session?.project?.vibesProjectUrl;
  const matching = tabs.filter((tab) => projectUrl && new URL(tab.url).pathname.replace(/\/$/, '') === new URL(projectUrl).pathname.replace(/\/$/, ''));
  const tab = matching.find((item) => item.id === state.tabId) || matching.find((item) => item.active) || matching[0];
  if (!tab?.id) throw Object.assign(new Error('Open the package’s Meta Vibes project first.'), { errorCode: 'VIBES_PROJECT_TAB_NOT_FOUND' });
  state.tabId = tab.id;
  return tab.id;
}
async function refreshDiagnostics() {
  if (!state.session || state.busy) return;
  const response = await chrome.tabs.sendMessage(await vibesTab(), { version: 1, type: 'PD_VIBES_DIAGNOSTICS', requestId: state.session.requestId }, { frameId: 0 });
  if (response?.diagnostics) state.workflow = response.diagnostics;
  renderWorkflow();
}
async function runStep(step) {
  if (!state.session) throw new Error('No generation package');
  state.currentStep = step;
  renderWorkflow();
  if (step === 'prompt' && state.session.generation.prompt.length > 9500) {
    throw Object.assign(new Error(`Prompt too long: ${state.session.generation.prompt.length}/9500`), { errorCode: 'PROMPT_TOO_LONG' });
  }
  const response = await chrome.tabs.sendMessage(await vibesTab(), {
    version: 1, type: step === 'prompt' ? 'PD_INSERT_PROMPT' : 'PD_VIBES_STEP',
    requestId: state.session.requestId, step, ...(step === 'prompt' ? { prompt: state.session.generation.prompt } : {})
  }, { frameId: 0 });
  if (response?.diagnostics) {
    const errors = { ...state.workflow?.errors, ...response.diagnostics.errors };
    if (response.ok) delete errors[step];
    state.workflow = { ...response.diagnostics, errors };
  }
  if (!response?.ok) throw Object.assign(new Error(response?.message || 'Vibes operation failed'), { errorCode: response?.errorCode || 'VIBES_INTERACTION_FAILED' });
  state.currentStep = null;
  renderWorkflow();
}
const sendIngredients = () => runStep('ingredients');
const setInitialFrame = () => runStep('initialFrame');
const insertPromptIntoVibes = () => runStep('prompt');
const applySettings = () => runStep('settings');
const generate = () => runStep('generate');
async function assisted(operation) {
  if (state.busy) return;
  state.busy = true;
  try { await operation(); showToast('Operation verified'); }
  catch (error) {
    state.workflow ||= {};
    state.workflow.currentStep = state.currentStep;
    state.workflow.lastError = { code: error.errorCode || 'VIBES_CONNECTION_FAILED', message: error.message };
    state.workflow.errors ||= {};
    state.workflow.errors[state.currentStep] = state.workflow.lastError;
    if (stepFlags[state.currentStep]) state.workflow[stepFlags[state.currentStep]] = false;
    showToast(`${state.workflow.lastError.code}: ${error.message}`);
  } finally { state.busy = false; state.currentStep = null; renderWorkflow(); }
}


document.querySelectorAll("[data-mode]").forEach((button) => {
  button.classList.toggle("active", button.dataset.mode === state.mode);
  button.addEventListener("click", () => { state.mode = button.dataset.mode; localStorage.setItem("pd-bridge-mode", state.mode); document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item === button)); renderWorkflow(); });
});

$("#diagnostics-toggle").addEventListener("click", () => {
  $("#diagnostics").hidden = !$("#diagnostics").hidden;
  if (!$("#diagnostics").hidden) refreshDiagnostics().catch((error) => showToast(error.message));
});
$("#copy-prompt").addEventListener("click", async () => { if (!state.session) return; await navigator.clipboard.writeText(state.session.generation.prompt); showToast("Prompt copied"); });
$("#open-vibes").addEventListener("click", async () => { const response = await send({ type: "PD_PANEL_OPEN_VIBES" }); showToast(response?.ok ? "Meta Vibes opened" : "Could not open Meta Vibes"); });
$("#insert-prompt").addEventListener("click", () => assisted(insertPromptIntoVibes));
$("#send-ingredients").addEventListener("click", () => assisted(sendIngredients));
$("#set-initial-frame").addEventListener("click", () => assisted(setInitialFrame));
$("#apply-settings").addEventListener("click", () => assisted(applySettings));
$("#generate").addEventListener("click", () => assisted(generate));
$("#run-auto").addEventListener("click", () => assisted(async () => {
  await sendIngredients();
  await setInitialFrame();
  await insertPromptIntoVibes();
  await applySettings();
  await generate();
}));
$("#close-viewer").addEventListener("click", () => $("#asset-viewer").close());
chrome.runtime.onMessage.addListener((message) => { if (message?.type === "PD_PANEL_STATE_CHANGED") render().catch(() => undefined); });
render().then(refreshDiagnostics).catch(() => showToast("Bridge state unavailable"));
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== 'PD_INTERNAL_STATUS' || message.requestId !== state.session?.requestId || sender.tab?.id !== state.tabId) return;
  state.workflow ||= {};
  if (message.details?.uploadStrategy) state.workflow.uploadStrategy = message.details.uploadStrategy;
  state.lastStage = message.stage;
  renderWorkflow();
});
