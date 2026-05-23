# Upstream Sync Policy

Better Browser Agent is a custom fork. Upstream Better Browser changes can be reviewed and merged, but upstream identity and runtime ownership markers must not replace the custom fork boundary.

## Protected Custom Values

Keep these values unchanged during every sync:

- Manifest id: `co.thomashulihan.better-browser-agent`
- Manifest name: `Better Browser Agent`
- Repository: `hulibrands/codex-tweaks`
- Main-process state key: `__codexpp_better_browser_agent_state__`
- Renderer patch function key: `__codexpp_better_browser_agent_patch_renderer_asset__`
- Reload token key: `__codexpp_better_browser_agent_reload_token__`
- Patched IPC symbol namespace: `codexpp.better-browser-agent.ipcHandler`
- Patched `webContents` symbol namespace: `codexpp.better-browser-agent.webContents`
- DevTools control IPC channel: `codexpp:better-browser-agent-devtools-control`

The original Better Browser state key, `__codexpp_better_browser_state__`, is reserved for conflict detection only. Do not use it as this fork's owner state.

## Pulling Upstream

Use a remote named `upstream` for Bennett's original Better Browser repository:

```sh
git remote add upstream <bennett-better-browser-git-url>
git fetch upstream
git log --oneline --decorate HEAD..upstream/main
git diff --stat HEAD..upstream/main
```

Review the upstream diff before merging or cherry-picking:

```sh
git merge --no-ff upstream/main
```

If the merge touches `manifest.json`, `index.js`, or this document, re-check the protected values above before keeping the merge.

## Required Post-Sync Checks

Run these checks after every upstream sync:

```sh
node --check index.js
BETTER_BROWSER_TEST=1 node index.js
rg -n "co[.]bennett[.]better-browser|b[-]nnett/codex-plusplus-better-browser" manifest.json index.js README.md UPSTREAM.md
```

The `rg` command should return no matches. Original store updates remain isolated from this fork because ShadGPT installs packages by tweak id, and this fork's id is `co.thomashulihan.better-browser-agent`.

## Conflict Guard

Keep the startup guard that checks whether original Better Browser state already exists. If it does, Better Browser Agent should register minimal custom status, log a warning, and skip browser patching. This prevents silent double-patching while still making the custom fork's status inspectable.
