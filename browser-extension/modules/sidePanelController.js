import { sessionAssetData, sessionSummary } from "./sessionAssetStore.js";

const VIBES_URL = "https://vibes.ai/";

export async function preparePanelForTab(tabId) {
  await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
  let opened = false;
  try { await chrome.sidePanel.open({ tabId }); opened = true; } catch {}
  chrome.runtime.sendMessage({ version: 1, type: "PD_PANEL_STATE_CHANGED" }).catch(() => undefined);
  return { opened };
}

async function updatePanelAvailability(tabId, url) {
  await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: Boolean(url?.startsWith(VIBES_URL)) });
}

export function installSidePanelController() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === "complete") updatePanelAvailability(tabId, changeInfo.url || tab.url).catch(() => undefined);
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.version !== 1) return false;
    if (message.type === "PD_PANEL_GET_STATE") { sendResponse({ ok: true, session: sessionSummary() }); return false; }
    if (message.type === "PD_PANEL_GET_ASSET") { const asset = sessionAssetData(message.assetId); sendResponse(asset ? { ok: true, asset } : { ok: false, errorCode: "SESSION_ASSET_NOT_FOUND" }); return false; }
    if (message.type === "PD_PANEL_OPEN_VIBES") {
      (async () => {
        const session = sessionSummary();
        const projectUrl = session?.project?.vibesProjectUrl || VIBES_URL;
        const tabs = await chrome.tabs.query({ url: "https://vibes.ai/*" });
        if (tabs[0]?.id) await chrome.tabs.update(tabs[0].id, { active: true, url: projectUrl });
        else await chrome.tabs.create({ active: true, url: projectUrl });
        return { ok: true };
      })().then(sendResponse).catch((cause) => sendResponse({ ok: false, errorCode: "VIBES_OPEN_FAILED", message: cause instanceof Error ? cause.message : String(cause) }));
      return true;
    }
    return false;
  });
}
