const PAGE_SOURCE = "promptdirector";
const BRIDGE_SOURCE = "promptdirector-bridge";
const BRIDGE_VERSION = "2.0.0";
function isAllowedPage() {
  return location.origin === "https://property-director-studio.iagomaneiraso.chatgpt.site"
    || (location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname));
}

function sendToPage(message) {
  window.postMessage({ source: BRIDGE_SOURCE, ...message }, location.origin);
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!isAllowedPage() || event.source !== window || event.origin !== location.origin || message?.source !== PAGE_SOURCE) return;
  if (message.type === "PD_BRIDGE_PING") {
    chrome.runtime.sendMessage({ version: 1, type: "PD_BRIDGE_PING" })
      .then((response) => sendToPage({ type: "PD_BRIDGE_PONG", requestId: message.requestId, version: BRIDGE_VERSION, status: response?.status || "ready" }))
      .catch(() => undefined);
    return;
  }
  if (message.type === "PD_GENERATE_VIDEO") {
    chrome.runtime.sendMessage({ version: 1, type: "PD_GENERATE_VIDEO", requestId: message.requestId, generationPackage: message.generationPackage })
      .then((response) => sendToPage({ type: "PD_BRIDGE_COMMAND_RESULT", requestId: message.requestId, ok: Boolean(response?.ok), errorCode: response?.errorCode, error: response?.error }))
      .catch((cause) => sendToPage({ type: "PD_BRIDGE_COMMAND_RESULT", requestId: message.requestId, ok: false, errorCode: "BRIDGE_DISCONNECTED", error: cause instanceof Error ? cause.message : String(cause) }));
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "PD_BRIDGE_EVENT" || !message.requestId) return false;
  sendToPage({ type: "PD_BRIDGE_EVENT", requestId: message.requestId, payload: message.payload });
  return false;
});
