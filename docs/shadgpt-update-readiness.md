# ShadGPT Update Readiness

This repository ships standalone tweaks, but update survival belongs to the
installed ShadGPT runtime. When Codex updates, ShadGPT should keep these surfaces
healthy before users debug individual tweaks.

## Required Settings Surface

- Auto-Repair Watcher: enabled when users want ShadGPT to repair itself after
  Codex updates.
- Watcher service: shows the launchd service name and watcher log path.
- Sparkle automatic install: defaults to manual mode, with explicit Enable and
  Disable actions for official Codex updater automation.
- Repair actions: Check Now, Preview Proposal, Repair All, Watcher details, and
  Show log remain visible from Settings.
- Chrome Control: reports trust, native host config, profile routing, and lock
  health separately from tweak health.
- MCP Guard: separates Codex-owned tool cleanup from Claude-owned or other
  process families.

## Codex Update Contract

After an official Codex update lands, ShadGPT should:

1. Detect the changed Codex app bundle.
2. Refresh the installed ShadGPT runtime assets.
3. Repatch and resign Codex.
4. Preserve installed tweaks and tweak store metadata.
5. Re-apply saved runtime preferences, including Default-mode popup questions
   through the stable `[tools.request_user_input]` Codex config table.
6. Report watcher, Chrome Control, and MCP Guard health in Settings so users can
   tell whether the update path completed.

## Maintainer Checklist

- Keep tweak manifests portable; do not rely on project-local paths.
- Keep tweak health failures separate from ShadGPT watcher or patcher failures.
- When adding a tweak that touches Settings, document whether it depends on
  ShadGPT runtime repair after Codex updates.
- If a tweak adds MCP or browser helpers, include cleanup guidance that respects
  owner split between Codex, Claude, and other processes.
