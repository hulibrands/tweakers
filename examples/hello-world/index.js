// Plain CommonJS — no build step needed. Drop this folder into
// <user-data-dir>/tweaks/ and reload Codex.

/** @type {import("@shadgpt/sdk").Tweak} */
module.exports = {
  start(api) {
    api.log.info("hello from", api.manifest.name);

    const handle = api.settings?.register({
      id: "demo",
      title: "Hello World",
      description: "Click the button.",
      render(root) {
        const btn = document.createElement("button");
        btn.textContent = `Clicked ${api.storage.get("clicks", 0)} times`;
        btn.style.cssText =
          "padding:6px 12px;border:1px solid #444;border-radius:6px;background:transparent;color:inherit;cursor:pointer;";
        btn.addEventListener("click", () => {
          const next = api.storage.get("clicks", 0) + 1;
          api.storage.set("clicks", next);
          btn.textContent = `Clicked ${next} times`;
        });
        root.appendChild(btn);
      },
    });

    this._handle = handle;
  },

  stop() {
    this._handle?.unregister();
  },
};
