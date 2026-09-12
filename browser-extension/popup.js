const projectUrl = "https://vibes.ai/projects/40c14372-cf55-4a4c-ba23-bdb454c9fb85";
document.querySelector("#extension-id").value = chrome.runtime.id;
document.querySelector("#open").addEventListener("click", () => chrome.tabs.create({ url: projectUrl }));
(async () => {
  const tabs = await chrome.tabs.query({ url: "https://vibes.ai/*" });
  const status = document.querySelector("#status");
  if (!tabs[0]?.id) { status.textContent = "Vibes not open"; return; }
  try { const result = await chrome.tabs.sendMessage(tabs[0].id, { version: 1, type: "PD_VIBES_PING" }); status.textContent = result.authenticated === false ? "Authentication required" : result.ready ? "Ready" : "Waiting for Vibes"; }
  catch { status.textContent = "Reload the Vibes tab"; }
})();
