import { validateGenerationPackage, type GenerationPackageV1 } from "./generation-package.ts";

export type BridgeStatus = "disconnected" | "vibes_not_open" | "ready" | "preparing" | "opening_vibes" | "waiting_for_vibes" | "auth_required" | "uploading_references" | "configuring" | "submitting" | "generating" | "processing" | "completed" | "failed";
export type BridgeStage = "PACKAGE_RECEIVED" | "PACKAGE_VALID" | "SESSION_ASSETS_RESOLVING" | "SESSION_ASSETS_READY" | "SESSION_ASSETS_FAILED" | "BRIDGE_PANEL_READY" | "VIBES_OPENED" | "VIBES_STATE" | "REFERENCES_UPLOADING" | "REFERENCE_UPLOAD" | "UPLOAD_DIALOG_FOUND" | "UPLOAD_MODAL_FOUND" | "VIBES_UPLOAD_DOM_DIAGNOSTIC" | "DROPZONE_FOUND" | "FILE_INPUT_SEARCH_STARTED" | "FILE_INPUT_FOUND" | "ASSETS_FETCH_STARTED" | "ASSETS_FETCHING" | "FILES_PREPARED" | "FILELIST_ASSIGNED" | "FILES_ATTACHED" | "VIBES_DID_NOT_REACT_TO_FILE_INPUT" | "MAIN_WORLD_UPLOAD_FAILED" | "VIBES_UI_REACTED" | "UPLOAD_READY" | "UPLOAD_READY_CONFIRMED" | "UPLOAD_BUTTON_CLICKED" | "UPLOAD_CONFIRMED" | "ASSET_PICKER_OPENED" | "ASSETS_DISCOVERED" | "ASSETS_SELECTED" | "ASSET_SELECTION" | "ASSETS_ADDED_TO_PROJECT" | "INITIAL_FRAME_PICKER_OPENED" | "INITIAL_FRAME_UPLOAD_STARTED" | "INITIAL_FRAME_UPLOADED" | "INITIAL_FRAME_SELECTED" | "INITIAL_FRAME_ADDED_TO_VIDEO" | "INITIAL_FRAME_UPLOAD" | "INITIAL_FRAME_SELECTION" | "INITIAL_FRAME_CONFIRMATION" | "EDITOR_RETURNED" | "PROMPT_EDITOR_FOUND" | "PROMPT_INSERTED" | "GENERATE_BUTTON_FOUND" | "GENERATION_SUBMITTED" | "PACKAGE_VALIDATION" | "VIBES_INTERACTION";
export type BridgeMessage = { version: number; type: "PD_ACK" | "PD_ERROR"; stage: BridgeStage; status: BridgeStatus; outputUrl?: string; errorCode?: string; message?: string; details?: unknown };
export type BridgeConnectionMode = "automatic" | "extension_id";
export type BridgeDiagnostic = { autoDiscovery: "Success" | "Failed"; extensionId: "Configured" | "Not configured"; directPing: "Success" | "Failed" | "Not attempted"; bridgeVersion: string; status: "CONNECTED" | "DISCONNECTED" };
export type BridgeTestResult = { ok: boolean; status: BridgeStatus; version?: string; connection?: BridgeConnectionMode; error?: string; diagnostic?: BridgeDiagnostic };
export type GenerationPackageValidation = ReturnType<typeof validateGenerationPackage>;
type ChromeRuntime = { sendMessage(extensionId: string, message: unknown, callback: (response?: Record<string, unknown>) => void): void; lastError?: { message?: string } };

const PAGE_SOURCE = "promptdirector";
const BRIDGE_SOURCE = "promptdirector-bridge";
const BRIDGE_VERSION = "2.0.0";
const HANDSHAKE_TIMEOUT_MS = 1800;
const EXTENSION_ID_KEY = "pd-vibes-extension-id";

function runtime(): ChromeRuntime | undefined { return (globalThis as typeof globalThis & { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime; }
export function configuredExtensionId() { return typeof localStorage === "undefined" ? "" : (localStorage.getItem(EXTENSION_ID_KEY) || "").trim(); }
export function saveExtensionId(value: string) { if (typeof localStorage !== "undefined") localStorage.setItem(EXTENSION_ID_KEY, value.trim()); }

function bridgeRequestId() {
  return globalThis.crypto?.randomUUID?.() || `pd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function pingBridge(timeoutMs = HANDSHAKE_TIMEOUT_MS): Promise<BridgeTestResult> {
  if (typeof window === "undefined") return { ok: false, status: "disconnected", error: "PromptDirector Bridge not detected." };
  const requestId = bridgeRequestId();
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result: BridgeTestResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      resolve(result);
    };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.source !== window || message?.source !== BRIDGE_SOURCE || message?.type !== "PD_BRIDGE_PONG" || message?.requestId !== requestId) return;
      finish({ ok: true, status: message.status || "ready", version: message.version || BRIDGE_VERSION });
    };
    const timer = window.setTimeout(() => finish({ ok: false, status: "disconnected", error: "PromptDirector Bridge not detected." }), timeoutMs);
    window.addEventListener("message", receive);
    window.postMessage({ source: PAGE_SOURCE, type: "PD_BRIDGE_PING", requestId }, window.location.origin);
  });
}

async function directExtensionPing(extensionId: string): Promise<BridgeTestResult> {
  const chromeRuntime = runtime();
  if (!chromeRuntime || !extensionId) return { ok: false, status: "disconnected", error: "Direct extension messaging is unavailable." };
  return await new Promise((resolve) => {
    try {
      chromeRuntime.sendMessage(extensionId, { version: 1, type: "PD_BRIDGE_PING" }, (response) => {
        const runtimeError = chromeRuntime.lastError?.message;
        if (runtimeError || !response?.ok || response.type !== "PD_BRIDGE_PONG") resolve({ ok: false, status: "disconnected", error: runtimeError || "Direct ping failed." });
        else resolve({ ok: true, status: "ready", version: String(response.version || BRIDGE_VERSION), connection: "extension_id" });
      });
    } catch (cause) { resolve({ ok: false, status: "disconnected", error: cause instanceof Error ? cause.message : "Direct ping failed." }); }
  });
}

export async function testBrowserBridge(extensionId = configuredExtensionId()): Promise<BridgeTestResult> {
  const automatic = await pingBridge();
  if (automatic.ok) return { ...automatic, connection: "automatic", diagnostic: { autoDiscovery: "Success", extensionId: extensionId ? "Configured" : "Not configured", directPing: "Not attempted", bridgeVersion: automatic.version || BRIDGE_VERSION, status: "CONNECTED" } };
  if (extensionId) {
    const direct = await directExtensionPing(extensionId);
    if (direct.ok) return { ...direct, diagnostic: { autoDiscovery: "Failed", extensionId: "Configured", directPing: "Success", bridgeVersion: direct.version || BRIDGE_VERSION, status: "CONNECTED" } };
    return { ...direct, error: direct.error || "PromptDirector Bridge not detected.", diagnostic: { autoDiscovery: "Failed", extensionId: "Configured", directPing: "Failed", bridgeVersion: "—", status: "DISCONNECTED" } };
  }
  return { ...automatic, error: "PromptDirector Bridge not detected.", diagnostic: { autoDiscovery: "Failed", extensionId: "Not configured", directPing: "Not attempted", bridgeVersion: "—", status: "DISCONNECTED" } };
}

async function dataUrl(blob: Blob) { return await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("ASSET_READ_FAILED")); reader.readAsDataURL(blob); }); }
function unresolvedAssetError(name:string){const message=`${name} could not be resolved.`;return Object.assign(new Error(message),{details:{missing:[],invalid:[],unresolvedAssets:[message]}});}

export async function resolveGenerationAssets(input: GenerationPackageV1, fetchAsset: typeof fetch = fetch): Promise<GenerationPackageV1> {
  const references = await Promise.all(input.references.map(async (reference) => {
    if (reference.assetUrl.startsWith("data:")) return reference;
    if (reference.assetUrl.startsWith("blob:")) throw unresolvedAssetError(reference.name);
    try {
      const response = await fetchAsset(reference.assetUrl, { credentials: "same-origin" });
      if (!response.ok) throw new Error("ASSET_HTTP_ERROR");
      const blob = await response.blob();
      const mimeType = blob.type || response.headers.get("content-type") || reference.mimeType;
      if (!mimeType.startsWith("image/")) throw new Error("ASSET_MIME_ERROR");
      return { ...reference, mimeType, assetUrl: await dataUrl(blob) };
    } catch { throw unresolvedAssetError(reference.name); }
  }));
  const resolved = { ...input, references };
  const validation = validateGenerationPackage(resolved);
  if (!validation.success) throw generationPackageError(validation);
  return resolved;
}

export function generationPackageError(validation: GenerationPackageValidation) {
  const error = new Error("Generation package invalid") as Error & { details?: unknown };
  error.details = { missing: validation.errors.missing, invalid: validation.errors.invalid, unresolvedAssets: validation.errors.unresolvedAssets };
  return error;
}

export function sanitizedGenerationDiagnostic(input: GenerationPackageV1 | unknown, validation?: GenerationPackageValidation) {
  const copy = typeof structuredClone === "function" ? structuredClone(input) : JSON.parse(JSON.stringify(input));
  if (copy && typeof copy === "object" && Array.isArray((copy as GenerationPackageV1).references)) for (const reference of (copy as GenerationPackageV1).references) if (reference.assetUrl?.startsWith("data:")) reference.assetUrl = `[embedded ${reference.mimeType}]`;
  return { package: copy, validation: validation || validateGenerationPackage(input) };
}

export function startBrowserGeneration(generationPackage: GenerationPackageV1, onStatus: (message: BridgeMessage) => void, options: { connection?: BridgeConnectionMode; extensionId?: string } = {}) {
  if (typeof window === "undefined") throw new Error("PromptDirector Bridge not detected.");
  const validation = validateGenerationPackage(generationPackage);
  if (!validation.success) throw generationPackageError(validation);
  const requestId = generationPackage.requestId;
  if (options.connection === "extension_id") {
    const chromeRuntime = runtime();
    const extensionId = options.extensionId?.trim();
    if (!chromeRuntime || !extensionId) throw new Error("PromptDirector Bridge not detected.");
    chromeRuntime.sendMessage(extensionId, { version: 1, type: "PD_GENERATE_VIDEO", requestId, payload: generationPackage }, (response) => {
      const runtimeError = chromeRuntime.lastError?.message;
      if (runtimeError || !response?.ok) onStatus({ version: 1, type: "PD_ERROR", stage: "VIBES_INTERACTION", status: "disconnected", errorCode: String(response?.errorCode || "BRIDGE_DISCONNECTED"), message: runtimeError || String(response?.error || "PromptDirector Bridge not detected.") });
      else onStatus({ version: 1, type: "PD_ACK", stage: "PACKAGE_RECEIVED", status: "preparing", details: { connection: "extension_id", requestId } });
    });
    return () => undefined;
  }
  const receive = (event: MessageEvent) => {
    const message = event.data;
    if (event.source !== window || message?.source !== BRIDGE_SOURCE || message?.requestId !== requestId) return;
    if (message.type === "PD_BRIDGE_EVENT" && message.payload) onStatus(message.payload as BridgeMessage);
    if (message.type === "PD_BRIDGE_COMMAND_RESULT" && message.ok === false) onStatus({ version: 1, type: "PD_ERROR", stage: "VIBES_INTERACTION", status: "disconnected", errorCode: message.errorCode || "BRIDGE_DISCONNECTED", message: message.error || "PromptDirector Bridge not detected." });
  };
  window.addEventListener("message", receive);
  window.postMessage({ source: PAGE_SOURCE, type: "PD_GENERATE_VIDEO", version: 1, requestId, generationPackage }, window.location.origin);
  return () => window.removeEventListener("message", receive);
}
