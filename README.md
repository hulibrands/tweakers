# Tweakers

Standalone Codex++ tweaks maintained by Hulibrands.

This repository exists for users who want individual tweaks without installing or following the full Codex++ source tree. Each tweak lives in `tweaks/<name>` and includes its own `manifest.json`.

## Tweaks

- `account-switcher` - Easy Account Switcher
- `codex-chat-ui` - ShadGPT Codex Chat UI
- `followup` - Codex Follow-up
- `github-accounts` - GitHub Accounts
- `mode-switcher` - Mode Switcher
- `projects` - ShadGPT Projects
- `shadcn-codex-ui` - Shadcn Codex UI
- `thread-summary-profiles` - ShadGPT Thread Summary Profiles
- `titlebar-controls` - Titlebar Controls
- `tweaks-directory` - Tweaks Directory
- `ui-improvements` - UI Improvements

## Retired Tweaks

- `retired/project-chrome-profile` - Legacy Plugin Profiles code retained for migration reference. Its Chrome profile assignment behavior now lives in `projects`, and the active store no longer exposes it as a separate tweak.

## Install A Tweak

Copy or symlink one tweak folder into your Codex++ tweaks directory:

```bash
mkdir -p "$HOME/Library/Application Support/codex-plusplus/tweaks"
ln -s "$PWD/tweaks/followup" "$HOME/Library/Application Support/codex-plusplus/tweaks/co.thomashulihan.followup"
```

Then reload Codex++ or use Force Reload from the Tweaks page.

## ShadGPT Update Readiness

Standalone tweaks depend on the host ShadGPT runtime to survive official Codex
app updates. The expected Doctor/Watcher/Patcher surface is documented in
[`docs/shadgpt-update-readiness.md`](docs/shadgpt-update-readiness.md).

## Compatibility

These folders are copied from the Codex++ project and kept usable as ordinary Codex++ tweaks. The public repository metadata points back to `hulibrands/tweakers`, while individual manifests retain their tweak ids so existing Codex++ installs can continue to recognize them.
