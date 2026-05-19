chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.getEnabledRulesets();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-panel") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "fixture-toggle" });
      }
    });
  }
});
