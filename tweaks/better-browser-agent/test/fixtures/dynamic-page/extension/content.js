(() => {
  const badge = document.createElement("div");
  badge.dataset.extensionBadge = "true";
  badge.setAttribute("role", "status");
  badge.textContent = "Extension badge";
  document.querySelector("main#app")?.appendChild(badge);
  console.info("Extension badge inserted");
})();
