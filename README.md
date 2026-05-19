# Tweakers

Standalone Codex++ tweaks maintained by Hulibrands.

This repository exists for users who want individual tweaks without installing or following the full Codex++ source tree. Each tweak lives in `tweaks/<name>` and includes its own `manifest.json`.

## Tweaks

- `account-switcher` - Easy Account Switcher
- `better-browser-agent` - Better Browser Agent
- `followup` - Codex Follow-up
- `github-accounts` - GitHub Accounts
- `mode-switcher` - Mode Switcher
- `project-chrome-profile` - Plugin Profiles
- `shadcn-codex-ui` - Shadcn Codex UI
- `titlebar-controls` - Titlebar Controls
- `tweaks-directory` - Tweaks Directory
- `ui-improvements` - Bennett's UI Improvements

## Install A Tweak

Copy or symlink one tweak folder into your Codex++ tweaks directory:

```bash
mkdir -p "$HOME/Library/Application Support/codex-plusplus/tweaks"
ln -s "$PWD/tweaks/followup" "$HOME/Library/Application Support/codex-plusplus/tweaks/co.thomashulihan.followup"
```

Then reload Codex++ or use Force Reload from the Tweaks page.

## Compatibility

These folders are copied from the Codex++ project and kept usable as ordinary Codex++ tweaks. The public repository metadata points back to `hulibrands/tweakers`, while individual manifests retain their tweak ids so existing Codex++ installs can continue to recognize them.

