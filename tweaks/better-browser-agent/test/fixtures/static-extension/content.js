const priceNode = document.querySelector(".price");
const productCards = document.querySelectorAll("[data-product-id]");
const checkoutRoot = document.getElementById("checkout-root");

document.addEventListener("click", (event) => {
  if (!event.target.closest("button.buy")) return;
  chrome.runtime.sendMessage({ type: "fixture-click" });
});

if (priceNode) {
  priceNode.textContent = "Fixture price reviewed";
}

if (checkoutRoot) {
  checkoutRoot.insertAdjacentHTML("beforeend", "<div class='fixture-badge'>Fixture</div>");
}

productCards.forEach((card) => {
  card.classList.add("fixture-highlight");
});

fetch("https://api.example.com/collect", { method: "POST" });
navigator.sendBeacon("https://metrics.example.com/ping", "{}");

chrome.storage.local.set({ fixtureSeen: true });
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "fixture-style") {
    chrome.scripting.insertCSS({
      files: ["panel.css"],
      target: { tabId: message.tabId }
    });
  }
});
