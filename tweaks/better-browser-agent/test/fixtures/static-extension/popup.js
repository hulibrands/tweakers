const panelRoot = document.querySelector("#panel-root");
const refreshButton = document.querySelector(".fixture-button");

refreshButton.addEventListener("click", () => {
  localStorage.setItem("fixture-popup-opened", "1");
  const request = new XMLHttpRequest();
  request.open("GET", "https://api.example.com/popup.json");
  request.send();
});

window.postMessage({ type: "fixture-popup-ready" }, "*");
panelRoot.dataset.ready = "true";
