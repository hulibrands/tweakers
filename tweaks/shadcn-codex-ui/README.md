# Shadcn Codex UI

Renderer plus main-scope ShadGPT tweak that applies a scoped, reversible shadcn-style UI layer to ShadGPT and selected upstream Codex surfaces.

This does not install shadcn React components. It is a vanilla JavaScript/CSS runtime tweak that bridges shadcn-style semantic tokens into ShadGPT behind one root marker:

```html
<html data-codexpp-shadcn-ui="light">
```

## Install

Copy or link this folder into the ShadGPT tweaks directory, then reload Codex:

- macOS: `~/Library/Application Support/codex-plusplus/tweaks/shadcn-codex-ui`
- source checkout: `tweaks/shadcn-codex-ui`

The tweak appears as **Shadcn Codex UI** in Settings -> Tweaks.

## Use

Open the tweak settings page to choose:

- Theme mode: System, Light, or Dark
- Core theme tokens
- Sidebar
- Composer
- Messages
- Settings
- Dialogs
- Project colors from the shadcn color palette at the `700` tint

Light mode is the primary target. It uses white or near-white backgrounds, near-black text, neutral borders, readable muted text, and visible focus rings.

## Fonts

The tweak self-hosts Geist and Geist Mono from Fontsource (`@fontsource-variable/geist` and `@fontsource-variable/geist-mono`) as bundled WOFF2 files under `assets/fonts/`. The renderer loads those files through the ShadGPT runtime asset API, so the stylesheet stays small while the UI avoids macOS system-font fallback and runtime network font requests.

Runtime validation can check:

```js
document.fonts.check('14px "Geist"')
document.fonts.check('14px "Geist Mono"')
```

## Reversibility

When enabled, the tweak injects one stylesheet tag and one root marker attribute. When stopped or when all feature flags are disabled, it removes the stylesheet and root marker. No upstream DOM nodes are replaced.

## Validation Notes

Run these checks from the repository root:

```bash
node -c tweaks/shadcn-codex-ui/index.js
node -e "JSON.parse(require('fs').readFileSync('tweaks/shadcn-codex-ui/manifest.json','utf8')); console.log('manifest ok')"
cd packages && node --import tsx packages/installer/src/cli.ts validate-tweak ../tweaks/shadcn-codex-ui
```

Runtime validation should confirm:

- the settings page renders;
- toggles persist after reload;
- disabling every feature removes the root marker and stylesheet;
- stopping the tweak unregisters settings and removes injected UI state;
- light mode keeps backgrounds white/near-white and text black/near-black.
