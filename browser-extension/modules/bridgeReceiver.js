import { isAllowedAssetUrl, validateBridgeCommand } from "../shared/generation-package-v1.js";
import { findOrOpenVibes } from "./vibesNavigator.js";
import { prepareGenerationSession } from "./sessionAssetStore.js";
import { preparePanelForTab } from "./sidePanelController.js";

const VERSION = 1;
const BRIDGE_VERSION = "2.0.0";
const requestTabs = new Map();

function validSender(sender) {
  try {
    const url = new URL(sender.url || sender.origin || "");
    return url.origin === "https://property-director-studio.iagomaneiraso.chatgpt.site"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch { return false; }
}

function errorPayload(stage, errorCode, message, details = {}) {
  return { version: VERSION, type: "PD_ERROR", stage, status: errorCode === "AUTH_REQUIRED" ? "auth_required" : "failed", errorCode, message, details };
}

async function executeGeneration(packageData, report) {
  report("SESSION_ASSETS_RESOLVING", "preparing", { expectedReferences: packageData.references.length });
  const session = await prepareGenerationSession(packageData);
  const tabId = await findOrOpenVibes(packageData.project.vibesProjectUrl);
  report("VIBES_OPENED", "waiting_for_vibes", { url: packageData.project.vibesProjectUrl });
  const panel = await preparePanelForTab(tabId);
  report("BRIDGE_PANEL_READY", "ready", { requestId: packageData.requestId, referencesReady: session.diagnostics.assetsReady, referencesExpected: session.diagnostics.assetsExpected, panelOpened: panel.opened });
  if (session.status !== "ready") {
    const failed = session.references.filter((reference) => reference.status === "failed").map((reference) => ({ id: reference.id, name: reference.name, error: reference.error }));
    throw Object.assign(new Error("One or more references could not be loaded by PromptDirector Bridge."), { stage: "SESSION_ASSETS_FAILED", code: "SESSION_ASSET_RESOLUTION_FAILED", details: { failed } });
  }
  report("SESSION_ASSETS_READY", "ready", { count: session.references.length, references: session.references.map((reference) => ({ id: reference.id, name: reference.name, type: reference.type, role: reference.role, size: reference.size })) });
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function fetchAsset(message) {
  if (!isAllowedAssetUrl(message.assetUrl) || message.assetUrl.startsWith("data:")) throw Object.assign(new Error("Asset URL is not allowed for background fetch."), { code: "ASSET_URL_NOT_ALLOWED" });
  const response = await fetch(message.assetUrl, { credentials: "include" });
  const contentType = response.headers.get("content-type") || message.mimeType || "application/octet-stream";
  if (!response.ok) throw Object.assign(new Error(`Asset request failed with HTTP ${response.status}.`), { code: "ASSET_HTTP_ERROR", status: response.status, contentType });
  if (!contentType.startsWith("image/")) throw Object.assign(new Error("Asset is not an image."), { code: "ASSET_MIME_INVALID", status: response.status, contentType });
  return { ok: true, status: response.status, mimeType: contentType, base64: bytesToBase64(await response.arrayBuffer()) };
}

function mainWorldUpload(filePayloads) {
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const roots = [];
  const collectRoots = (root) => {
    roots.push(root);
    for (const element of root.querySelectorAll("*")) if (element.shadowRoot) collectRoots(element.shadowRoot);
  };
  collectRoots(document);
  const inputs = roots.flatMap((root) => [...root.querySelectorAll('input[type="file"],input[accept*="image" i]')]).filter((input) => !input.disabled);
  const uploadInput = inputs.find((input) => input.getAttribute("data-pd-upload-target") === "true");
  if (!uploadInput) return { ok: false, errorCode: "MAIN_WORLD_FILE_INPUT_NOT_FOUND", inputsFound: inputs.length };
  try {
    const transfer = new DataTransfer();
    for (const item of filePayloads) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      transfer.items.add(new File([bytes], item.name || "reference.png", { type: item.type || "image/png" }));
    }
    uploadInput.files = transfer.files;
    uploadInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    uploadInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return { ok: uploadInput.files?.length === filePayloads.length, assigned: uploadInput.files?.length || 0, inputsFound: inputs.length };
  } catch (cause) {
    return { ok: false, errorCode: "MAIN_WORLD_FILELIST_ASSIGNMENT_FAILED", message: cause instanceof Error ? cause.message : String(cause), inputsFound: inputs.length };
  }
}

async function executeMainWorldUpload(message, sender) {
  if (!sender.tab?.id || !Array.isArray(message.files) || !message.files.length) return { ok: false, errorCode: "MAIN_WORLD_UPLOAD_INVALID_REQUEST" };
  const results = await chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, world: "MAIN", func: mainWorldUpload, args: [message.files] });
  const success = results.find((item) => item.result?.ok);
  if (success) return { ok: true, frameId: success.frameId, assigned: success.result.assigned };
  return { ok: false, errorCode: "MAIN_WORLD_UPLOAD_FAILED", details: { results: results.map((item) => ({ frameId: item.frameId, ok: Boolean(item.result?.ok), errorCode: item.result?.errorCode || null, inputsFound: item.result?.inputsFound || 0 })) } };
}

export function installBridgeReceiver() {
  const emitToPage = (tabId, requestId, payload) => chrome.tabs.sendMessage(tabId, { version: VERSION, type: "PD_BRIDGE_EVENT", requestId, payload }).catch(() => undefined);

  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!validSender(sender)) { sendResponse({ ok: false, errorCode: "UNTRUSTED_SENDER", error: "Sender is not allowed." }); return false; }
    if (message?.type === "PD_BRIDGE_PING") {
      sendResponse({ ok: true, type: "PD_BRIDGE_PONG", version: BRIDGE_VERSION });
      return false;
    }
    if (message?.type !== "PD_GENERATE_VIDEO") return false;
    const inputPackage = message.payload || message.generationPackage;
    const command = validateBridgeCommand({ version: VERSION, type: "PD_START_GENERATION", generationPackage: inputPackage });
    if (!command.accepted) { sendResponse({ ok: false, errorCode: command.errorCode, error: command.message, details: command.details }); return false; }
    const packageData = command.package;
    const report = (stage, status, details) => {
      if (sender.tab?.id) emitToPage(sender.tab.id, packageData.requestId, { version: VERSION, type: "PD_ACK", stage, status, details });
    };
    report("PACKAGE_RECEIVED", "preparing", { requestId: packageData.requestId, connection: "extension_id" });
    report("PACKAGE_VALID", "preparing", { schemaVersion: packageData.schemaVersion });
    executeGeneration(packageData, report).catch((error) => {
      if (sender.tab?.id) emitToPage(sender.tab.id, packageData.requestId, errorPayload(error.stage || "VIBES_INTERACTION", error.code || "VIBES_INTERACTION_FAILED", error.message || "Meta Vibes interaction failed.", error.details || {}));
    });
    sendResponse({ ok: true, accepted: true, requestId: packageData.requestId });
    return true;
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !validSender(sender) || message?.version !== VERSION) return false;
    if (message.type === "PD_BRIDGE_PING") {
      chrome.tabs.query({ url: "https://vibes.ai/*" })
        .then((tabs) => sendResponse({ ok: true, status: tabs.some((tab) => tab.id) ? "ready" : "vibes_not_open", version: BRIDGE_VERSION }))
        .catch(() => sendResponse({ ok: true, status: "ready", version: BRIDGE_VERSION }));
      return true;
    }
    if (message.type !== "PD_GENERATE_VIDEO" || !sender.tab?.id) return false;
    const command = validateBridgeCommand({ version: VERSION, type: "PD_START_GENERATION", generationPackage: message.generationPackage });
    const requestId = message.requestId || message.generationPackage?.requestId || "";
    if (!command.accepted) {
      emitToPage(sender.tab.id, requestId, errorPayload(command.stage, command.errorCode, command.message, command.details));
      sendResponse({ ok: false, errorCode: command.errorCode, error: command.message });
      return false;
    }
    const packageData = command.package;
    requestTabs.set(packageData.requestId, sender.tab.id);
    const report = (stage, status, details) => emitToPage(sender.tab.id, packageData.requestId, { version: VERSION, type: "PD_ACK", stage, status, details });
    report("PACKAGE_RECEIVED", "preparing", { requestId: packageData.requestId });
    report("PACKAGE_VALID", "preparing", { schemaVersion: packageData.schemaVersion });
    executeGeneration(packageData, report).catch((error) => {
      emitToPage(sender.tab.id, packageData.requestId, errorPayload(error.stage || "VIBES_INTERACTION", error.code || "VIBES_INTERACTION_FAILED", error.message || "Meta Vibes interaction failed.", error.details || {}));
    });
    sendResponse({ ok: true, accepted: true, requestId: packageData.requestId });
    return false;
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.version !== VERSION || message?.type !== "PD_INTERNAL_STATUS" || !message.requestId) return;
    const tabId = requestTabs.get(message.requestId);
    if (tabId) emitToPage(tabId, message.requestId, { version: VERSION, type: "PD_ACK", stage: message.stage, status: message.status, details: message.details });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.version !== VERSION || message?.type !== "PD_FETCH_ASSET") return false;
    fetchAsset(message).then(sendResponse).catch((cause) => sendResponse({ ok: false, errorCode: cause.code || "ASSET_FETCH_FAILED", message: cause.message, details: { status: cause.status ?? null, contentType: cause.contentType ?? null, assetName: message.assetName || null } }));
    return true;
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.version !== VERSION || message?.type !== "PD_MAIN_WORLD_UPLOAD") return false;
    executeMainWorldUpload(message, sender).then(sendResponse).catch((cause) => sendResponse({ ok: false, errorCode: "MAIN_WORLD_UPLOAD_FAILED", message: cause instanceof Error ? cause.message : String(cause) }));
    return true;
  });
}
