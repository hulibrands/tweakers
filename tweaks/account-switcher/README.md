# ShadGPT Account Switcher

Local ShadGPT tweak for saving, switching, and managing Codex desktop auth sessions.

## Features

- Automatically saves the active Codex auth session when it does not match a saved account.
- Shows saved accounts by email when an email is available in the auth token.
- Adds a compact collapsible Accounts section to Codex's account popup, anchored above Rate limits remaining.
- Switches accounts directly from the account popup. Switching replaces the active auth file and relaunches Codex.
- Shows cached 5-hour and weekly rate-limit remaining values for accounts that have been active, including the reset time when a window is exhausted.
- Adds a dedicated Accounts settings page for setup, refresh, switching, deletion, and new sign-in flows.
- Starts a new sign-in by backing up and clearing the active auth file, then relaunching Codex.

## Storage

- active auth: `~/.codex/auth.json`
- saved accounts: `~/.codex/auth_accounts/<name>.json`
- current account marker: `~/.codex/current_account`
- cached rate-limit usage: `~/.codex/auth_accounts_usage.json`

New sign-in backups are written as `~/.codex/auth.account-switcher-backup-<timestamp>.json`.
Pre-switch backups use `~/.codex/auth.account-switcher-prev-<timestamp>.json`.
Saved auth snapshots and Account Switcher backups are written with private file permissions where the platform supports them. Account Switcher keeps the newest eight `auth.account-switcher-*` backup files and prunes older ones after switch or clear-active actions.

## Install

```sh
~/Library/Application Support/codex-plusplus/tweaks/co.thomashulihan.account-switcher
```

Drop this folder into:

```sh
~/Library/Application Support/codex-plusplus/tweaks/
```

Then reload tweaks from ShadGPT or restart Codex.

## Usage

- Open Codex's account menu.
- Expand Accounts to see saved sessions and their cached rate-limit status.
- Click a saved account to switch to it.
- Click Configure accounts to open the Accounts settings page.
- Use the Accounts settings page to refresh, remove saved snapshots, or start a new sign-in.

## Test

```sh
node --test test/account-service.test.js
node --check index.js
node --check index.bundled.js
```

Run the visual regression check before shipping popup or settings layout changes:

```sh
ACCOUNT_SWITCHER_SCREENSHOT=/absolute/path/to/account-menu.png node --test test/screenshot-regression.test.js
```

The screenshot should show the account menu with the Accounts section visible above Usage remaining.

## Manifest

Tweak id: `co.thomashulihan.account-switcher`
