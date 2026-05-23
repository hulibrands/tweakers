# ShadGPT Better Browser Agent

Built for ShadGPT, a tweak system for the Codex desktop app.

<img width="2944" height="2196" alt="image" src="https://github.com/user-attachments/assets/afc31248-af43-435f-86fc-2f5ad7c3752c" />

ShadGPT Better Browser Agent is a custom Better Browser fork for agent inspection and extension analysis. It improves the Codex desktop in-app browser side panel as a main-process ShadGPT tweak that patches Electron `webContents` behavior and selected Codex renderer bundles at runtime.

## Custom Fork Identity

This fork is intentionally isolated from the store-managed original Better Browser package.

- Tweak id: `co.thomashulihan.better-browser-agent`
- Display name: `ShadGPT Better Browser Agent`
- Repository: `hulibrands/codex-tweaks`
- Main-process state key: `__codexpp_better_browser_agent_state__`

Install this checkout as a local or dev tweak under the custom id path:

```sh
codexplusplus dev /Users/thomashulihan/Applications/codex-tweaks/better-browser-agent --replace
```

If a manual install path is needed, keep it separate from the original package:

```sh
~/Library/Application Support/codex-plusplus/tweaks/co.thomashulihan.better-browser-agent
```

ShadGPT store installs are keyed by tweak id. As long as this fork is installed under `co.thomashulihan.better-browser-agent`, original Better Browser store installs or updates land in their own package directory and cannot overwrite this custom checkout.

## Original Better Browser Conflict

Only one browser-patching Better Browser variant should run at a time. At startup, Better Browser Agent checks for the original Better Browser main-process global state key, `__codexpp_better_browser_state__`.

If that key is already present, Better Browser Agent:

- logs a clear warning;
- registers minimal custom status on `__codexpp_better_browser_agent_state__`;
- skips renderer, IPC, protocol, shortcut, reload, and `webContents` patching.

Disable the original Better Browser package before enabling Better Browser Agent. If Better Browser Agent is started twice, it disposes the prior custom instance before registering the replacement instance.

## Upstream Sync Boundary

Treat Bennett's original Better Browser repository as upstream source material only. Pull upstream changes into a review branch, then keep the custom manifest id, repository slug, main-process global namespace, symbols, IPC ownership key, and conflict guard intact. See [UPSTREAM.md](UPSTREAM.md) for the checklist.

## Features

- Opens up to 25 browser tabs from the side-panel plus menu.
- Keeps browser tab metadata, titles, favicons, snapshots, and annotation routing separate per tab.
- Opens browser DevTools inline inside the browser panel instead of in a detached external window.
- Supports DevTools docking on the left, bottom, or right.
- Adds a resize handle for inline DevTools.
- Adds an Inspect Element toolbar button next to screenshot and annotation controls.
- Adds a browser Theme picker with Dark and Light options.
- Adds keyboard shortcuts for browser tab switching, DevTools, and browser navigation.
- Adds trackpad swipe gestures for browser back and forward navigation, with visible gesture feedback.

## Agent DevTools Bridge Foundation

This fork includes the first Better Browser bridge foundation. It is read-only infrastructure for future Codex inspection, not a shipped automation UI.

What is implemented:

- The tweak tracks Better Browser tab health in the main process, including URL, title, loading state, focus/visibility hints, owner `webContents.id`, browser `webContents.id`, DevTools open state, renderer patch names, and CDP status.
- The bridge source of truth is Electron's in-process `webContents.debugger` on the Better Browser tab. It can attach, send CDP commands, record last command/error state, detach, and refresh the tab health snapshot.
- The internal bridge API can list tabs, select an active tab, collect buffered console and network evidence, capture screenshots, produce bounded DOM/accessibility summaries, and compose an evidence bundle for future tool surfaces.
- Bounded in-memory event buffers track console, runtime, network, navigation, screenshot, and bridge-call events for Better Browser tab `webContents`.
- Bridge output passes through redaction and truncation helpers before being returned.
- Theme emulation and related current behavior use that same in-process debugger path; the browser does not depend on an external Chrome debugging endpoint.

What remains disabled or deferred:

- No shipped Codex-facing MCP/tool registration yet. The bridge foundation exists inside the tweak, but there is not yet a separate user-visible tool picker entry.
- No UI controls yet for `Enable Agent Bridge`, `Send Evidence To Codex`, bridge audit logs, or `Agent Inspect`.
- No click/type automation, persistent page script injection, storage/cookie reads, request-body reads, auth-header reads, full-page text dumps, or general Chrome profile automation.

Event history caveat:

- Console and network data can only be trustworthy after a bounded event buffer is enabled and subscribed before the relevant page activity.
- If a buffer starts after page activity, any evidence workflow must state that earlier console/network history may be partial or unavailable.

Sensitive-data boundary:

- The V1 contract excludes cookies, localStorage, sessionStorage, authorization headers, request bodies, raw tokens, secrets, and full-page content dumps.
- Bridge events and returned results use redaction and truncation helpers. Those helpers are intentionally conservative and should continue to be extended as new evidence fields are added.
- Future UI or MCP tool surfaces should report truncation/redaction counts without exposing the original sensitive values.

Diagnostics boundary:

- `http://127.0.0.1:9222/json/list` is diagnostic only and requires ShadGPT to be launched with remote debugging enabled.
- A failed `127.0.0.1:9222` check does not mean Better Browser Agent is unhealthy.
- The implemented bridge foundation should be validated against the in-process `webContents.debugger` state and tab health snapshots, because that path is the source of truth.

## Extension Analysis Lab

Better Browser Agent includes local, dependency-free analysis helpers for studying how a Chrome extension affects a page before building a clean-room ShadGPT version of the behavior.

Static analysis parses an unpacked extension without executing it:

```sh
node extension-analysis.js /path/to/unpacked-extension --json
```

The static profile reports manifest permissions, host access, content scripts, background/service-worker files, popup/action files, DNR rules, selectors, DOM writes, storage/message APIs, network calls, CSS injection, and a clean-room implementation brief.

Dynamic analysis scaffolding prepares an external Chrome/Chromium launch plan and shapes baseline-vs-extension observations into redacted behavior deltas. The dynamic runner tests do not require Chrome, but live observation should use a disposable Chrome profile with `--load-extension` and localhost-only remote debugging.

## Controls

### Browser Tabs

- Use the side-panel plus menu to open additional Browser tabs.
- Up to 25 Browser tabs can be open at once.
- `Ctrl+1` through `Ctrl+9` switches between right-panel tabs while the right panel or browser has focus.
- On macOS, `Cmd+1` through `Cmd+9` is also handled by the renderer shortcut path.

### Navigation

- macOS: `Cmd+Left` and `Cmd+Right` navigate browser history.
- Windows/Linux: `Ctrl+Left` and `Ctrl+Right` navigate browser history.
- Horizontal trackpad swipes trigger back/forward when browser history is available.
- Gesture UI is disabled when the active browser cannot go in that direction.

### DevTools

- Click the Inspect Element toolbar button to toggle inline DevTools.
- Keyboard shortcut:
  - macOS: `Cmd+Option+I`
  - Windows/Linux: `Ctrl+Shift+I`
  - `F12` also toggles DevTools.
- The browser tools menu contains `Dock DevTools` controls for left, bottom, and right docking.
- DevTools open/closed state is tracked per browser tab.

### Theme

- The browser tools menu contains a `Theme` row with `Dark` and `Light` choices.
- Theme changes are applied to browser `webContents` with Chromium `Emulation.setEmulatedMedia` for `prefers-color-scheme`.
- A page-level fallback also updates `color-scheme` and common theme attributes such as `data-color-mode`, `data-theme`, and `data-bs-theme` for sites that respond to DOM theme hints.

## Implementation Notes

The tweak runs in the Electron main process and installs these hooks:

- `protocol.handle("app", ...)` wraps selected renderer assets as they are served.
- `ipcMain.handle(...)` observes renderer messages sent through `codex_desktop:message-from-view`.
- `app.on("web-contents-created", ...)` patches browser `webContents` methods.
- `globalShortcut` registers right-panel tab switching while a Codex window is focused.

Renderer asset patches currently target:

- `use-model-settings-*`: multi-tab browser creation, browser tab metadata, and annotation routing.
- `review-runtime-bridge-*`: plus-menu browser availability and browser tab detection.
- `app-shell-*`: active browser tab shortcut state and right-panel tab switching.

Main-process `webContents` patches currently override:

- `openDevTools`
- `closeDevTools`
- `inspectElement`
- `send`

Inline DevTools is implemented with Electron `BrowserView` instances:

- one `BrowserView` hosts the DevTools frontend;
- one small `BrowserView` hosts the resize handle;
- bounds are recomputed against the visible browser panel area.

## Verification

Run these from `tweaks/base/better-browser-agent`:

```sh
node --check index.js
BETTER_BROWSER_TEST=1 node index.js
node --test test/*.test.js
```

Run the ShadGPT tweak checks from the ShadGPT checkout when the CLI is available:

```sh
codexplusplus validate-tweak tweaks/base/better-browser-agent
codexplusplus status
```

For diagnostic comparison only, launch ShadGPT with remote debugging enabled, then query the external CDP endpoint:

```sh
curl -s http://127.0.0.1:9222/json/list
```

That endpoint is not the bridge dependency. Use it to compare visible targets during development; use the in-process `webContents.debugger` tab health state as the bridge source of truth.

Useful live checks:

- Confirm the app shell injected menu script version:

```js
window.__codexppBetterBrowserDevToolsDockMenu?.version
```

- Confirm a browser page is seeing the intended theme:

```js
matchMedia("(prefers-color-scheme: dark)").matches
matchMedia("(prefers-color-scheme: light)").matches
getComputedStyle(document.body).backgroundColor
```

Bridge validation notes:

- If `curl -s http://127.0.0.1:9222/json/list` fails from the shell, do not treat that as a bridge failure. Confirm the Better Browser tab through the Electron `webContents.debugger` health state instead.
- Keep bridge validation read-only unless and until a future opt-in mutation path is implemented and documented.
- Do not treat console/network history as complete unless event buffers were active before the page activity being investigated.
- Evidence bundles should explain tab state, failure mode, truncation, redaction, and any partial-history caveat without exposing secrets.

## Troubleshooting

- If DevTools opens as a separate window, the target browser `webContents` was not resolved to an inline entry. Check active browser conversation hints and `webContentsId` resolution.
- If the theme menu changes UI state but the page does not change, verify `Emulation.setEmulatedMedia` is reaching the webview target. Some external CDP clients can block Electron's `webContents.debugger`; the page-level theme fallback handles common DOM-driven theme systems but cannot fully replace media emulation for every site.
- If the shell endpoint at `127.0.0.1:9222` is unavailable, use the in-process Electron debugger path and note that the browser can still be healthy even when the external CDP endpoint is not reachable.
- If annotations work on the first tab but not later tabs, check direct-comment conversation alias routing and the base conversation mirror in `patchUseModelSettings`.
- If inline DevTools lags behind panel resizing, check BrowserView bounds polling and `getBrowserPageContentBounds`.
