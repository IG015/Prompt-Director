import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("PromptDirector Bridge loads the requested automation modules", () => {
  const manifest = JSON.parse(read("browser-extension/manifest.json"));
  assert.equal(manifest.version, "2.0.0");
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.action.default_popup, undefined);
  const pageBridge = manifest.content_scripts.find((entry: {js:string[]}) => entry.js.includes("pageBridge.js"));
  const vibesBridge = manifest.content_scripts.find((entry: {js:string[]}) => entry.js.includes("content.js"));
  assert.ok(pageBridge.matches.includes("https://property-director-studio.iagomaneiraso.chatgpt.site/*"));
  assert.equal(pageBridge.run_at, "document_start");
  assert.equal(vibesBridge.all_frames, true);
  assert.deepEqual(vibesBridge.js, ["modules/vibesUploader.js", "modules/vibesUploadAdapter.js", "modules/vibesInitialFrame.js", "modules/vibesPrompt.js", "modules/vibesGenerator.js", "modules/vibesAssisted.js", "content.js"]);
  assert.deepEqual(manifest.externally_connectable.matches, ["https://property-director-studio.iagomaneiraso.chatgpt.site/*", "http://localhost/*", "http://127.0.0.1/*"]);
  assert.match(read("browser-extension/background.js"), /bridgeReceiver/);
  assert.match(read("browser-extension/modules/bridgeReceiver.js"), /vibesNavigator/);
});

test("Bridge v2 keeps auto discovery and falls back to a saved Extension ID", () => {
  const client = read("lib/browser-bridge-client.ts");
  const page = read("app/page.tsx");
  const relay = read("browser-extension/pageBridge.js");
  const receiver = read("browser-extension/modules/bridgeReceiver.js");
  assert.match(client, /function pingBridge\(/);
  assert.match(client, /window\.postMessage\(\{ source: PAGE_SOURCE, type: "PD_BRIDGE_PING"/);
  assert.match(client, /type: "PD_GENERATE_VIDEO"/);
  assert.match(relay, /PD_BRIDGE_PONG/);
  assert.match(relay, /chrome\.runtime\.sendMessage\(\{ version: 1, type: "PD_GENERATE_VIDEO"/);
  assert.match(receiver, /message\.type === "PD_BRIDGE_PING"/);
  assert.match(receiver, /message\.type !== "PD_GENERATE_VIDEO"/);
  assert.match(receiver, /onMessageExternal/);
  assert.doesNotMatch(receiver, /onConnectExternal|await ping\(/);
  assert.match(client, /const automatic = await pingBridge\(\)/);
  assert.match(client, /if \(extensionId\)[\s\S]*directExtensionPing\(extensionId\)/);
  assert.match(client, /chromeRuntime\.sendMessage\(extensionId, \{ version: 1, type: "PD_BRIDGE_PING"/);
  assert.match(client, /type: "PD_GENERATE_VIDEO", requestId, payload: generationPackage/);
  assert.match(client, /pd-vibes-extension-id/);
  assert.match(page, />Extension ID<input/);
  assert.match(page, /placeholder="Cole o ID da extensão Chrome"/);
  assert.match(page, />SAVE</);
  assert.match(page, /Connected via Extension ID/);
  assert.match(page, /Connected automatically/);
  for (const label of ["Auto Discovery", "Direct Ping", "Bridge Version", "Status"]) assert.match(page, new RegExp(label));
  assert.match(page, /PromptDirector Bridge not detected\./);
  assert.match(page, /Version: \{bridgeVersion\}/);
  assert.match(page, /Connected/);
});

test("Bridge resolves the package for the visible panel before assisted actions", () => {
  const sources = ["modules/bridgeReceiver.js", "modules/vibesUploader.js", "modules/vibesInitialFrame.js", "modules/vibesPrompt.js", "modules/vibesGenerator.js"].map((path) => read(`browser-extension/${path}`)).join("\n");
  for (const stage of ["PACKAGE_RECEIVED","PACKAGE_VALID","SESSION_ASSETS_RESOLVING","SESSION_ASSETS_READY","BRIDGE_PANEL_READY","VIBES_OPENED"]) assert.match(sources, new RegExp(stage));
  assert.doesNotMatch(read("browser-extension/modules/bridgeReceiver.js"), /PD_VIBES_GENERATE/);
});

test("Side Panel displays the shot, four reference thumbnails and independent assisted controls", () => {
  const html = read("browser-extension/sidepanel.html");
  const script = read("browser-extension/sidepanel.js");
  for (const text of ["PROMPTDIRECTOR BRIDGE","REFERENCES","PROMPT","DURATION","ASPECT RATIO","AUTO","ASSISTED","MANUAL","OPEN VIBES","SEND INGREDIENTS","SET INITIAL FRAME","INSERT PROMPT","APPLY SETTINGS","GENERATE","DIAGNOSTICS"]) assert.match(html, new RegExp(text));
  assert.match(script, /PD_PANEL_GET_STATE/);
  assert.match(script, /PD_PANEL_GET_ASSET/);
  assert.match(script, /dataUrl/);
  assert.match(script, /VIEW/);
  assert.match(script, /DOWNLOAD/);
  assert.match(script, /navigator\.clipboard\.writeText/);
});

test("assisted flow maps storyboard to initial frame and keeps character references as ingredients", () => {
  const assisted = read("browser-extension/modules/vibesAssisted.js");
  const panelController = read("browser-extension/modules/sidePanelController.js");
  const content = read("browser-extension/content.js");
  assert.match(assisted, /function splitReferences\(/);
  assert.match(assisted, /previous\.\*frame/);
  assert.match(assisted, /initial\.\*frame/);
  assert.match(assisted, /storyboard/);
  for (const action of ["SEND_INGREDIENTS", "SET_INITIAL_FRAME", "INSERT_PROMPT", "APPLY_SETTINGS", "GENERATE"]) {
    assert.match(assisted + panelController + content, new RegExp(action));
  }
  assert.match(panelController, /PD_PANEL_ACTION/);
  assert.match(content, /PD_VIBES_ACTION/);
  assert.match(content, /GENERATION_SUBMITTED/);
});

test("VibesUploadAdapter consumes resolved session bytes through data URLs", () => {
  const adapter = read("browser-extension/modules/vibesUploadAdapter.js");
  const store = read("browser-extension/modules/sessionAssetStore.js");
  assert.match(adapter, /asset\.dataUrl/);
  assert.match(adapter, /validateAssets/);
  assert.match(adapter, /uploadFilesInModal/);
  assert.doesNotMatch(adapter, /fetch\(/);
  assert.match(store, /generationSessionPayload/);
  assert.match(store, /dataUrl:/);
});

test("Session asset store keeps resolved image bytes only in memory", () => {
  const source = read("browser-extension/modules/sessionAssetStore.js");
  assert.match(source, /let currentSession = null/);
  assert.match(source, /await response\.arrayBuffer\(\)/);
  assert.match(source, /status: "ready"/);
  assert.doesNotMatch(source, /chrome\.storage|indexedDB|localStorage/);
});

test("Vibes readiness uses observers and bounded retry", () => {
  assert.match(read("browser-extension/modules/vibesUploader.js"), /MutationObserver/);
  assert.match(read("browser-extension/modules/vibesInitialFrame.js"), /waitFor/);
  assert.match(read("browser-extension/modules/vibesPrompt.js"), /MutationObserver/);
  assert.match(read("browser-extension/modules/vibesGenerator.js"), /MutationObserver/);
  assert.match(read("browser-extension/modules/vibesNavigator.js"), /attempts/);
});

test("initial-frame picker uploads exactly one prioritized frame and stops at editor return", () => {
  const source = read("browser-extension/modules/vibesInitialFrame.js");
  assert.match(source, /INITIAL_FRAME_PICKER/);
  assert.match(source, /previous_frame/);
  assert.match(source, /initial_frame/);
  assert.match(source, /storyboard/);
  assert.match(source, /Previous frame unavailable; storyboard used as initial frame\./);
  assert.match(source, /uploadFilesInModal\(uploadModal, \[reference\], report, \{ limit: 1 \}\)/);
  assert.doesNotMatch(source, /new DataTransfer/);
  for (const code of ["INITIAL_FRAME_PICKER_NOT_FOUND","INITIAL_FRAME_UPLOAD_BUTTON_NOT_FOUND","INITIAL_FRAME_ASSET_FETCH_FAILED","INITIAL_FRAME_UPLOAD_NOT_CONFIRMED","INITIAL_FRAME_SELECTION_FAILED","INITIAL_FRAME_PREVIEW_NOT_UPDATED","ADD_TO_VIDEO_BUTTON_NOT_FOUND","ADD_TO_VIDEO_BUTTON_DISABLED","EDITOR_DID_NOT_RETURN"]) assert.match(source, new RegExp(code));
});

test("asset picker traversal identifies new assets and reports specific failures", () => {
  const source = read("browser-extension/modules/vibesUploader.js");
  for (const helper of ["detectVibesReferenceState", "findUploadModal", "findUploadFileInput", "waitForUploadReady", "uploadFilesInModal", "findAssetPicker", "discoverAssetCards", "selectUploadedAssets", "findAddAssetsButton"]) assert.match(source, new RegExp(`function ${helper}\\(`));
  for (const code of ["ASSET_PICKER_NOT_FOUND", "ASSETS_NOT_FOUND", "UPLOADED_ASSETS_NOT_DETECTED", "ASSET_SELECTION_FAILED", "ASSET_SELECTION_COUNT_MISMATCH", "ADD_TO_PROJECT_BUTTON_NOT_FOUND", "ADD_TO_PROJECT_BUTTON_DISABLED", "ASSET_PICKER_DID_NOT_CLOSE", "EDITOR_DID_NOT_RETURN"]) assert.match(source, new RegExp(code));
  assert.match(source, /newest-dom-nodes/);
});

test("upload modal diagnoses the DOM and sends only the storyboard for the first live test", () => {
  const source = read("browser-extension/modules/vibesUploader.js");
  assert.match(source, /function deepFindFileInputs\(/);
  assert.match(source, /fileInputsInsideShadowRoots/);
  assert.match(source, /querySelectorAll\("iframe"\)/);
  assert.match(source, /selectUploadReferences\(references, 1\)/);
  assert.match(source, /dropzone\.click\(\)/);
  assert.match(source, /new DataTransfer\(\)/);
  assert.match(source, /Object\.defineProperty\(input, "files"/);
  assert.match(source, /new Event\("input", \{ bubbles: true, composed: true \}\)/);
  assert.match(source, /new Event\("change", \{ bubbles: true, composed: true \}\)/);
  assert.match(source, /new DragEvent\(type, \{ bubbles: true, cancelable: true, composed: true/);
  for (const code of ["DROPZONE_NOT_FOUND","FILE_INPUT_NOT_FOUND_AFTER_DROPZONE_CLICK","FILE_INPUT_IN_IFRAME","ASSET_FETCH_FAILED","ZERO_FILES_PREPARED","FILELIST_ASSIGNMENT_FAILED","VIBES_DID_NOT_REACT_TO_FILE_INPUT","MAIN_WORLD_UPLOAD_FAILED","DRAG_DROP_UPLOAD_FAILED","UPLOAD_PREVIEW_TIMEOUT"]) assert.match(source, new RegExp(code));
});

test("background can retry file assignment in the page MAIN world", () => {
  const source = read("browser-extension/modules/bridgeReceiver.js");
  assert.match(source, /PD_MAIN_WORLD_UPLOAD/);
  assert.match(source, /world: "MAIN"/);
  assert.match(source, /allFrames: true/);
  assert.match(source, /Object\.defineProperty\(uploadInput, "files"/);
});

test("reference state machine never searches for a file input while the asset picker is active", () => {
  const source = read("browser-extension/modules/vibesUploader.js");
  assert.match(source, /state: "ASSET_PICKER"/);
  assert.match(source, /state: "UPLOAD_MODAL"/);
  assert.match(source, /state: "EDITOR"/);
  assert.match(source, /state: "UNKNOWN"/);
  assert.match(source, /if \(detected\.state === "ASSET_PICKER"\)[\s\S]*finishAssetPicker/);
  assert.match(source, /UPLOADED_ASSETS_NOT_DETECTED/);
  assert.match(source, /expectedReferences:[\s\S]*newAssetsDetected:[\s\S]*existingAssets:/);
});

test("prompt and generation steps verify their real effects", () => {
  assert.match(read("browser-extension/modules/vibesPrompt.js"), /beforeinput/);
  assert.match(read("browser-extension/modules/vibesPrompt.js"), /charactersInserted/);
  assert.match(read("browser-extension/modules/vibesGenerator.js"), /GENERATE_BUTTON_DISABLED/);
});
