# Project Chrome Profiles

Assign Chrome profiles to project paths so Chrome-backed Google workflows can
use the right local account context.

The Chrome plugin honors `CODEX_CHROME_PREFERENCES_PATH`. This tweak stores
project assignments and exposes a managed MCP helper that resolves that env var
for the current project path.

Gmail and other Google Workspace connectors still use their connector account
authorization. This tweak helps when those workflows open or verify account
state through Chrome.
