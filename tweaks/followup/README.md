# Codex Follow-up

ShadGPT tweak by Arconte112 that renders OpenWebUI-style follow-up items under
assistant messages.

The tweak adds a settings page under Tweaks -> Follow-up. The editable prompt
controls which concrete fixes or improvements should appear after an assistant
message. The JSON contract is locked and synced after the prompt into every
AGENTS.md target shown by the settings page:

`$CODEX_HOME/AGENTS.md` or the default `~/.codex/AGENTS.md` file under your
home directory. When the current local project can be detected, the page also
shows that project's `AGENTS.md` target.

## Installation

1. Download or clone this repository.
2. Copy the tweak folder into your ShadGPT tweaks directory:

```text
macOS: ~/Library/Application Support/codex-plusplus/tweaks/co.thomashulihan.followup
Linux: ~/.local/share/codex-plusplus/tweaks/co.thomashulihan.followup
Windows: %APPDATA%\codex-plusplus\tweaks\co.thomashulihan.followup
```

3. Restart Codex or use Force Reload from the ShadGPT Tweaks page.
4. Open Settings -> Tweaks -> Follow-up to configure the prompt and sync
   behavior.

The folder must contain `manifest.json`, `index.js`, and `README.md` at its
top level.

## Screenshots

### Follow-up panel

![Follow-up panel under an assistant message](assets/followup-panel.png)

### Configuration page

![Follow-up settings page](assets/configuration.png)

## Configuration

Open Settings -> Tweaks -> Follow-up to configure the tweak.

### Behavior

- **Enable Follow-up**: turns follow-up rendering on or off.
- **Show divider**: adds a thin separator above the Follow-up panel.
- **Clickable items**: makes each follow-up row clickable. Clicking a row
  inserts that prompt into the Codex composer. The bullet explanations shown
  under the prompt are only for understanding what the suggestion will achieve.

### Follow-up Instructions

- **Sync AGENTS.md instruction**: keeps the managed Follow-up block current in
  every AGENTS.md file shown by the settings page so Codex knows when and how
  to emit follow-up payloads.
- **Editable prompt**: lets you write your own follow-up strategy. Use this to
  control when follow-ups appear, how many items Codex should generate, which
  fixes or improvements are useful, and what style they should follow.
- **Prompt migration**: reports whether the tweak is using the built-in prompt,
  preserved custom prompt text, or upgraded an old built-in default.
- **Synced prompt preview**: shows the exact managed instruction that will be
  written to shown AGENTS.md targets as highlighted editable and locked
  sections.
- **AGENTS.md targets**: shows the exact file paths that Apply, Reset, and
  automatic sync can update, whether each file exists, whether an existing
  Follow-up managed block was found, and the before/after text for Apply.
  Targets are ordered as Global, Project, then Custom and labeled by target
  type.
- **Target sync toggles**: let you keep a shown target visible while skipping
  writes for that file.
- **Custom target labels**: let you rename each target card while keeping the
  target path unchanged.
- **Target ordering**: drag target cards to change their display and sync status
  order. The saved order is reused on the next refresh.
- **Target summary**: shows compact counts for total, enabled, disabled,
  missing, and duplicate managed-block states above the target previews.
- **Duplicate block warning**: appears when multiple current or legacy
  Follow-up blocks are found. Apply collapses them into one current ShadGPT
  block.
- **Custom prompt guide**: explains how to tune the editable prompt without
  changing the renderer's payload contract.
- **Reload Follow-up**: reloads installed tweaks from disk and refreshes the
  window so the installed Follow-up copy can pick up local changes.
- **Apply to shown AGENTS.md files**: revises the current editable prompt plus
  the locked JSON contract in every enabled displayed target. Existing current,
  upstream, and legacy Follow-up blocks are replaced with one current ShadGPT
  managed block instead of appending duplicate instructions.
- **Reset**: restores the default follow-up prompt and syncs it again.

Only the editable prompt is meant to be customized. The JSON contract below it
is locked because the renderer depends on that exact payload shape.

Follow-up items should normally appear at the end of assistant final responses
and suggest future fixes or improvements to the current chat topic. The default
prompt suppresses that payload for turns using any Matt Pocock skill or
capability from the `mattpocock/skills` plugin, or any Ponytail skill or
capability from the Ponytail plugin; those sessions should ask bounded choices
through `request_user_input` when available and mark option labels with
`(Recommended)`.

Crucial tests, reviews, audits, and verification are completion work for the
assistant to handle before the final response. They should be reported in the
visible answer when relevant, not offered as Follow-up options.

When customizing the prompt, keep the strategy focused on what the next fix or
improvement should accomplish. The locked format is appended separately so the
renderer can continue parsing the Follow-up payload.

The tweak only edits text between Follow-up managed markers. Current ShadGPT
markers are:

```md
<!-- shadgpt:co.thomashulihan.followup:start -->
...
<!-- shadgpt:co.thomashulihan.followup:end -->
```

When older Follow-up markers are present, Apply converts them in place to the
current ShadGPT markers and removes duplicate legacy Follow-up blocks while
preserving unrelated AGENTS.md content.

Locked payload format:

```json
{
  "codex_follow_up": true,
  "title": "Follow-up",
  "items": [
    {
      "prompt": "Improve the Follow-up prompt so every item proposes a concrete change",
      "achieves": [
        "Keeps suggestions action-focused",
        "Removes passive follow-up options"
      ]
    }
  ]
}
```

The tweak hides that JSON block and renders the items below the assistant
message. When clickable items are enabled, clicking a row inserts its `prompt`
into the composer. The optional `achieves` bullets are displayed in the panel
but are not inserted into the composer.
