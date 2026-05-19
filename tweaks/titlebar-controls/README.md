# Titlebar Controls

Renderer-only Codex++ tweak that aligns the app's sidebar/back/forward controls
with the native macOS titlebar traffic-light buttons.

## Install for Development

```sh
codexplusplus dev ./tweaks/titlebar-controls --replace
```

The active Codex++ tweak entry should be a symlink:

```sh
readlink "$HOME/Library/Application Support/codex-plusplus/tweaks/co.thomashulihan.titlebar-controls"
```
