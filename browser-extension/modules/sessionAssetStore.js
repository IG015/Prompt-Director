import { isAllowedAssetUrl } from "../shared/generation-package-v1.js";

let currentSession = null;

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function safeAsset(asset) {
  return {
    id: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    type: asset.type,
    role: asset.role,
    size: asset.bytes?.byteLength || 0,
    status: asset.status,
    error: asset.error || null
  };
}

function notifyPanel() {
  chrome.runtime.sendMessage({ version: 1, type: "PD_PANEL_STATE_CHANGED" }).catch(() => undefined);
}

async function fetchReference(reference) {
  if (!isAllowedAssetUrl(reference.assetUrl)) throw new Error("ASSET_URL_NOT_ALLOWED");
  const response = await fetch(reference.assetUrl, { credentials: "include" });
  const contentType = response.headers.get("content-type") || reference.mimeType || "application/octet-stream";
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  if (!contentType.startsWith("image/")) throw new Error(`INVALID_CONTENT_TYPE_${contentType}`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error("EMPTY_ASSET");
  return { ...reference, mimeType: contentType, bytes, status: "ready", error: null };
}

export async function prepareGenerationSession(packageData) {
  currentSession = {
    requestId: packageData.requestId,
    packageData,
    status: "resolving",
    createdAt: Date.now(),
    assets: packageData.references.map((reference) => ({ ...reference, bytes: null, status: "loading", error: null })),
    steps: { upload: "not_started", prompt: "ready", settings: "ready", generation: "not_submitted" }
  };
  notifyPanel();
  currentSession.assets = await Promise.all(packageData.references.map(async (reference) => {
    try { return await fetchReference(reference); }
    catch (cause) { return { ...reference, bytes: null, status: "failed", error: cause instanceof Error ? cause.message : String(cause) }; }
  }));
  currentSession.status = currentSession.assets.every((asset) => asset.status === "ready") ? "ready" : "failed";
  notifyPanel();
  return sessionSummary();
}

export function sessionSummary() {
  if (!currentSession) return null;
  return {
    requestId: currentSession.requestId,
    status: currentSession.status,
    project: currentSession.packageData.project,
    shot: currentSession.packageData.shot,
    generation: currentSession.packageData.generation,
    references: currentSession.assets.map(safeAsset),
    steps: currentSession.steps,
    diagnostics: {
      packageValid: true,
      assetsReady: currentSession.assets.filter((asset) => asset.status === "ready").length,
      assetsExpected: currentSession.assets.length,
      currentState: "PANEL_READY",
      uploadStrategy: "NOT_STARTED",
      fileInputsFound: null,
      dropzonesFound: null
    }
  };
}

export function sessionAssetData(assetId) {
  const asset = currentSession?.assets.find((item) => item.id === assetId);
  if (!asset?.bytes || asset.status !== "ready") return null;
  return { id: asset.id, name: asset.name, mimeType: asset.mimeType, dataUrl: `data:${asset.mimeType};base64,${bytesToBase64(asset.bytes)}` };
}

export function hasReadySession() {
  return currentSession?.status === "ready";
}
