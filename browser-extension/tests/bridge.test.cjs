const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { File } = require('node:buffer');
const source = (file) => fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
const error = (stage, errorCode, message) => Object.assign(new Error(message), { stage, errorCode });
function assetsContext(sendMessage) {
  const context = vm.createContext({ File, Blob, Uint8Array, atob, URL, location: { href: 'https://vibes.ai/projects/test' }, chrome: { runtime: { sendMessage } } });
  vm.runInContext(source('modules/vibesUploader.js'), context);
  vm.runInContext(source('modules/vibesInitialFrame.js'), context);
  return context.PromptDirectorBridge;
}
const refs = [
  { id: 's', name: 'Storyboard.png', type: 'storyboard' },
  { id: 'a', name: 'Scaeva Official.png', type: 'character' },
  { id: 'b', name: 'Vitus Official.png', type: 'character' },
  { id: 'c', name: 'Vitus Hair.png', type: 'character' }
];
test('current shot maps three ingredients and excludes storyboard', () => {
  const bridge = assetsContext();
  assert.equal(bridge.initialFrame.chooseReference({ references: refs }).reference.id, 's');
  assert.deepEqual(Array.from(bridge.uploader.ingredientReferences({ references: refs }), (ref) => ref.id), ['a','b','c']);
});
test('previousFrame takes precedence over explicit initialFrame and storyboard', () => {
  const bridge = assetsContext();
  const references = [...refs, { id: 'i', role: 'initialFrame' }, { id: 'p', role: 'previousFrame' }];
  assert.equal(bridge.initialFrame.chooseReference({ references }).reference.id, 'p');
  assert.equal(bridge.initialFrame.chooseReference({ references: references.slice(0,-1) }).reference.id, 'i');
  assert.deepEqual(Array.from(bridge.uploader.ingredientReferences({ references }), (ref) => ref.id), ['a','b','c']);
});
test('upload File comes only from session bytes, preserving name, size and MIME', async () => {
  const calls = [];
  const bridge = assetsContext(async (message) => {
    calls.push(message);
    return { ok: true, asset: { name: 'Scaeva.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID' } };
  });
  const file = await bridge.uploader.referenceFile({ id: 'a', assetUrl: 'https://must-not-fetch.invalid' });
  assert.equal(file.size, 3);
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, 'Scaeva.png');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'PD_PANEL_GET_ASSET');
});
test('empty session image is rejected', async () => {
  const bridge = assetsContext(async () => ({ ok: true, asset: { name: 'x', mimeType: 'image/png', dataUrl: 'data:image/png;base64,' } }));
  await assert.rejects(bridge.uploader.referenceFile({ id: 'x' }), { errorCode: 'INVALID_ASSET_FILE' });
});
test('missing MIME or session asset is rejected without network fallback', async () => {
  for (const response of [{ ok: false }, { ok: true, asset: { dataUrl: 'data:image/png;base64,AQ==' } }]) {
    await assert.rejects(assetsContext(async () => response).uploader.referenceFile({ id: 'x' }), { errorCode: 'SESSION_ASSET_NOT_FOUND' });
  }
});
test('old unrelated cards and ambiguous duplicate names are not accepted', () => {
  const bridge = assetsContext();
  const cards = [{ key: '1', label: 'Scaeva Official.png' }, { key: '2', label: 'Scaeva Official.png' }, { key: '3', label: 'old' }];
  assert.equal(bridge.uploader.identifyUploadedAssets(cards, cards, refs.slice(1), true).cards.length, 0);
  assert.equal(bridge.uploader.identifyUploadedAssets(cards, [], [refs[1]], false).cards.length, 0);
});
test('asset URLs with different query IDs do not match', () => {
  const bridge = assetsContext();
  assert.equal(bridge.uploader.identifyUploadedAssets([{ key: '1', thumbnailSrc: 'https://vibes.ai/media?id=old' }], [], [{ assetUrl: 'https://vibes.ai/media?id=new' }], false).cards.length, 0);
});
test('exact new card delta is accepted after upload into empty library', () => {
  const bridge = assetsContext();
  assert.equal(bridge.uploader.identifyUploadedAssets([{ key: 'new' }], [], [{ id: 'a' }], true).cards.length, 1);
});
class Element {
  constructor(text, click = () => {}) { this.textContent = text; this.click = click; this.tagName = 'BUTTON'; }
  getClientRects() { return [1]; }
  getAttribute() { return null; }
  closest() { return null; }
}
function generatorContext(elements, statuses = []) {
  const bridge = { error, uploader: {
    normalized: (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    waitFor: async (find, options) => { const result = find(); if (!result) throw error(options.stage, options.errorCode, options.message); return result; }
  } };
  const context = vm.createContext({ HTMLElement: Element, Event, PromptDirectorBridge: bridge, document: { querySelectorAll: (selector) => selector.includes('[role="status"]') ? statuses : elements } });
  vm.runInContext(source('modules/vibesGenerator.js'), context);
  return bridge.generator;
}
test('5s / 16:9 already set produces no clicks', async () => {
  let clicks = 0;
  const generator = generatorContext([new Element('5s', () => clicks++), new Element('16:9', () => clicks++)]);
  await generator.configure({ durationSeconds: 5, aspectRatio: '16:9' });
  assert.equal(clicks, 0);
});
test('missing duration and ratio controls return specific failures', async () => {
  await assert.rejects(generatorContext([]).configure({ durationSeconds: 5, aspectRatio: '16:9' }), { errorCode: 'DURATION_CONTROL_NOT_FOUND' });
  await assert.rejects(generatorContext([new Element('5s')]).configure({ durationSeconds: 5, aspectRatio: '16:9' }), { errorCode: 'ASPECT_RATIO_CONTROL_NOT_FOUND' });
});
test('settings option must update the control before success', async () => {
  const duration = new Element('10s');
  const option = new Element('5s', () => { duration.textContent = '5s'; });
  const generator = generatorContext([duration, new Element('16:9'), option]);
  await generator.configure({ durationSeconds: 5, aspectRatio: '16:9' });
  duration.textContent = '10s'; option.click = () => {};
  await assert.rejects(generator.configure({ durationSeconds: 5, aspectRatio: '16:9' }), { errorCode: 'DURATION_CONTROL_NOT_FOUND' });
});
test('missing / disabled Generate cannot submit', async () => {
  await assert.rejects(generatorContext([]).submit(() => {}), { errorCode: 'GENERATE_BUTTON_NOT_FOUND' });
  const button = new Element('Generate'); button.disabled = true;
  await assert.rejects(generatorContext([button]).submit(() => {}), { errorCode: 'GENERATE_BUTTON_DISABLED' });
});
test('click alone and old generation status do not mean Submitted', async () => {
  let reports = 0;
  await assert.rejects(generatorContext([new Element('Generate')], [new Element('Generating')]).submit(() => reports++), { errorCode: 'GENERATION_SUBMISSION_FAILED' });
  assert.equal(reports, 0);
});
test('new generation UI produces verified submission', async () => {
  const statuses = [];
  const button = new Element('Generate', () => statuses.push(new Element('Generating')));
  let stage;
  await generatorContext([button], statuses).submit((value) => { stage = value; });
  assert.equal(stage, 'GENERATION_SUBMITTED');
});
function workflowContext() {
  const calls = [];
  let listener;
  const session = { requestId: 'test-04.07', project: { id: 'project' }, shot: { sceneId: '04', shotId: '04.07' }, references: refs, generation: { prompt: 'A scene', durationSeconds: 5, aspectRatio: '16:9' } };
  const editor = { value: '' };
  const bridge = { error,
    uploader: { sendIngredients: async () => { calls.push('ingredients'); return [{}]; }, appliedImages: () => true, detectVibesReferenceState: () => ({ state: 'EDITOR' }), ingredientButton: () => ({}), deepFindFileInputs: () => ({ entries: [] }), findDropzone: () => null, findUploadModal: () => null },
    initialFrame: { setInitialFrame: async () => { calls.push('initialFrame'); return [{}]; }, findControl: () => ({}) },
    prompt: { insert: async (text) => { calls.push('prompt'); editor.value = text; }, findEditor: () => editor },
    generator: { configure: async () => calls.push('settings'), submit: async () => calls.push('generate'), settingsMatch: () => true, settingControl: () => ({}), findGenerateButton: () => ({}) }
  };
  const context = vm.createContext({ PromptDirectorBridge: bridge, location: { href: 'https://vibes.ai/projects/test' }, chrome: { runtime: { id: 'extension', sendMessage: async () => ({ session }), onMessage: { addListener: (fn) => { listener = fn; } } } } });
  vm.runInContext(source('content.js'), context);
  const send = (step, type = 'PD_VIBES_STEP') => new Promise((resolve) => listener({ version: 1, type, step, requestId: session.requestId }, { id: 'extension' }, resolve));
  return { send, calls, bridge, session, editor };
}
test('Generate is blocked before all four prerequisites', async () => {
  const { send, calls } = workflowContext();
  assert.equal((await send('generate')).errorCode, 'GENERATION_PREREQUISITES_NOT_MET');
  assert.equal(calls.length, 0);
});
test('assisted test order completes and duplicate submission is blocked', async () => {
  const { send, calls } = workflowContext();
  for (const step of ['prompt','settings','initialFrame','ingredients','generate']) assert.equal((await send(step)).ok, true);
  assert.equal((await send('generate')).errorCode, 'GENERATION_ALREADY_SUBMITTED');
  assert.deepEqual(calls, ['prompt','settings','initialFrame','ingredients','generate']);
});
test('AUTO uses shared steps in required order and stops at failure', async () => {
  const success = workflowContext();
  assert.equal((await success.send(null, 'PD_VIBES_GENERATE')).ok, true);
  assert.deepEqual(success.calls, ['ingredients','initialFrame','prompt','settings','generate']);
  const failure = workflowContext();
  failure.bridge.initialFrame.setInitialFrame = async () => { throw error('INITIAL_FRAME', 'INITIAL_FRAME_UPLOAD_FAILED', 'Failed'); };
  const result = await failure.send(null, 'PD_VIBES_GENERATE');
  assert.equal(result.ok, false);
  assert.deepEqual(failure.calls, ['ingredients']);
  assert.equal(result.diagnostics.ingredientsApplied, true);
});
test('9500 guard blocks insertion without truncation or losing other successful steps', async () => {
  const { send, calls, session } = workflowContext();
  session.generation.prompt = 'x'.repeat(9501);
  assert.equal((await send('settings')).ok, true);
  const result = await send('prompt');
  assert.equal(result.errorCode, 'PROMPT_TOO_LONG');
  assert.equal(result.diagnostics.settingsApplied, true);
  assert.deepEqual(calls, ['settings']);
});
test('changed prompt is revalidated before Generate', async () => {
  const { send, editor, calls } = workflowContext();
  for (const step of ['prompt','settings','initialFrame','ingredients']) await send(step);
  editor.value = 'manually replaced';
  assert.equal((await send('generate')).errorCode, 'GENERATION_PREREQUISITES_NOT_MET');
  assert.equal(calls.includes('generate'), false);
});
test('new package invalidates previous completion flags', async () => {
  const { send, session } = workflowContext();
  await send('prompt');
  session.requestId = 'new-request';
  const result = await send(null, 'PD_VIBES_DIAGNOSTICS');
  assert.equal(result.diagnostics.promptInserted, false);
});

function uploadContext(successStrategy, { inputPresent = true, dropPresent = true } = {}) {
  const attempts = [];
  const reports = [];
  let reacted = false;
  class Node extends Element {
    constructor(text) { super(text); this.isConnected = true; this.children = []; }
    querySelectorAll(selector) {
      if (selector === '*') return [];
      if (selector.includes('img')) return reacted ? [new Node('preview')] : [];
      if (selector === 'button,[role="button"]') return [uploadButton];
      if (selector.includes('dropzone')) return dropPresent ? [dropzone] : [];
      return [];
    }
    contains(node) { return node === input; }
    getRootNode() { return document; }
  }
  const react = (strategy) => { attempts.push(strategy); if (strategy === successStrategy) reacted = true; };
  const modal = new Node('Upload images');
  const uploadButton = new Node('Upload'); uploadButton.click = () => { modal.isConnected = false; };
  const dropzone = new Node('Click to add or drag and drop media');
  dropzone.dispatchEvent = (event) => { if (event.type === 'drop') react('DRAG_DROP'); };
  const input = new Node('');
  Object.assign(input, { tagName: 'INPUT', multiple: true, outerHTML: '<input type="file" multiple>', accept: 'image/*', setAttribute() {}, removeAttribute() {}, dispatchEvent(event) { if (event.type === 'change') react('FILE_INPUT'); } });
  const document = { documentElement: {}, querySelectorAll: (selector) => selector.startsWith('input[') && inputPresent ? [input] : [], defaultView: { getComputedStyle: () => ({}) } };
  input.ownerDocument = document;
  const context = vm.createContext({ HTMLElement: Node, HTMLInputElement: Node, File, Blob, Uint8Array, atob, btoa, URL, Event,
    DragEvent: class { constructor(type) { this.type = type; } },
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; } },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (callback) => { queueMicrotask(callback); return 1; }, clearTimeout() {},
    document, console: { info() {} }, location: { href: 'https://vibes.ai/projects/test' },
    chrome: { runtime: { sendMessage: async (message) => {
      if (message.type === 'PD_MAIN_WORLD_UPLOAD') { react('MAIN_WORLD'); return { ok: true }; }
      return { ok: true, asset: { name: 'asset.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID' } };
    } } }
  });
  vm.runInContext(source('modules/vibesUploader.js'), context);
  return { attempts, reports, upload: () => context.PromptDirectorBridge.uploader.uploadFilesInModal(modal, [{ id: 'asset' }], async (stage, status, details) => { reports.push({ stage, details }); }) };
}
test('file input upload works without a dropzone', async () => {
  const fixture = uploadContext('FILE_INPUT', { dropPresent: false });
  await fixture.upload();
  assert.deepEqual(fixture.attempts, ['FILE_INPUT']);
  assert.equal(fixture.reports.find((event) => event.stage === 'UPLOAD_STRATEGY').details.uploadStrategy, 'FILE_INPUT');
});
test('drag/drop works without any file input', async () => {
  const fixture = uploadContext('DRAG_DROP', { inputPresent: false });
  await fixture.upload();
  assert.deepEqual(fixture.attempts, ['DRAG_DROP']);
});
test('fallback order is file input, drag/drop, MAIN world', async () => {
  const fixture = uploadContext('MAIN_WORLD');
  await fixture.upload();
  assert.deepEqual(fixture.attempts, ['FILE_INPUT', 'DRAG_DROP', 'MAIN_WORLD']);
});
test('assigned FileList and successful MAIN response without UI evidence fail', async () => {
  const fixture = uploadContext('NONE');
  await assert.rejects(fixture.upload(), { errorCode: 'UPLOAD_PREVIEW_TIMEOUT' });
  assert.equal(fixture.reports.some((event) => event.stage === 'UPLOAD_CONFIRMED'), false);
});
