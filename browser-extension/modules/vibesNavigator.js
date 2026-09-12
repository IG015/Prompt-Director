const VIBES_PROJECT_PATTERN = /^https:\/\/vibes\.ai\/projects\/[a-z0-9-]+(?:[/?#]|$)/i;

function navigationError(errorCode, message, details = {}) {
  return Object.assign(new Error(message), { stage: "VIBES_OPENED", code: errorCode, details });
}

export async function findOrOpenVibes(projectUrl) {
  if (!VIBES_PROJECT_PATTERN.test(projectUrl)) throw navigationError("INVALID_VIBES_PROJECT_URL", "The configured Meta Vibes project URL is invalid.", { projectUrl });
  const tabs = await chrome.tabs.query({ url: "https://vibes.ai/*" });
  let tab = tabs.find((candidate) => candidate.url?.startsWith(projectUrl)) || tabs[0];
  if (!tab?.id) tab = await chrome.tabs.create({ url: projectUrl, active: true });
  else {
    await chrome.tabs.update(tab.id, { active: true, ...(tab.url?.startsWith(projectUrl) ? {} : { url: projectUrl }) });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  }
  return tab.id;
}

async function waitForLoad(tabId, timeoutMs = 45000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(navigationError("VIBES_LOAD_TIMEOUT", "Meta Vibes did not finish loading.", { tabId, timeoutMs })); }, timeoutMs);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

export async function waitForVibesReady(tabId, probeVibes, options = {}) {
  const attempts = options.attempts || 8;
  await waitForLoad(tabId, options.timeoutMs || 45000);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await probeVibes(tabId);
    if (state.ready || state.authenticated === false) return state;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** attempt, 2000)));
  }
  throw navigationError("VIBES_UI_NOT_READY", "Meta Vibes opened, but its interface was not ready.", { tabId, attempts });
}
