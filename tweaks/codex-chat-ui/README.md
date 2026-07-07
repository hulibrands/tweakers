# ShadGPT Codex Chat UI

Renderer tweak that turns safe, structured `codex_ui` JSON blocks in assistant messages into compact shadcn-style chat UI.

This tweak does not install React shadcn components. It renders vanilla DOM/CSS and consumes the semantic variables provided by **ShadGPT Shadcn UI** when that tweak is enabled.

## Supported Blocks

- `summary_card`: compact result summary with status, key facts, footer, and safe actions.
- `action_list`: list of suggested next actions that can insert a prompt into the composer.
- `progress_panel`: task progress with a progress bar and step list.
- `data_table`: compact table with horizontal scrolling in narrow chats.
- `file_preview`: file tree preview with copy-path actions.

## Payload Shape

```json
{
  "codex_ui": true,
  "version": 1,
  "blocks": [
    {
      "kind": "summary_card",
      "id": "build-plan",
      "props": {
        "title": "Build plan ready",
        "subtitle": "The first Codex chat UI renderer can be implemented as a tweak.",
        "status": "ready",
        "items": [
          { "label": "Repo", "value": "custom Codex app" }
        ],
        "actions": [
          {
            "type": "send_message",
            "label": "Implement this",
            "prompt": "Implement the Codex chat UI summary card."
          }
        ]
      },
      "fallbackText": "Build plan ready: implement the Codex chat UI summary card."
    }
  ]
}
```

## Fallback Rules

- JSON source blocks are hidden only after a valid panel renders.
- Invalid JSON remains visible.
- Disabled or unknown blocks render `fallbackText` when fallback display is enabled.
- If shadcn semantic variables are unavailable, local CSS defaults keep the UI readable.
- Actions never run commands; first-release actions only insert composer text, copy text, or toggle local details.
- The settings page includes a reload action that refreshes installed tweaks from disk, then reloads the window.

## Validation

Run from the repository root:

```bash
/Applications/Codex.app/Contents/Resources/node -c vendor/tweakers/tweaks/codex-chat-ui/index.js
/Applications/Codex.app/Contents/Resources/node -e "JSON.parse(require('fs').readFileSync('vendor/tweakers/tweaks/codex-chat-ui/manifest.json','utf8')); console.log('manifest ok')"
```
