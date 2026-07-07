# ShadGPT Tweaks Directory

First-party ShadGPT tweak that moves the installed tweaks manager and live
Tweak Store into a `Tweaks` tab next to Codex's native `Plugins` and `Skills`
directory tabs.

The Settings-based Tweaks and Tweak Store pages remain available when this
tweak is disabled or fails to load.

## Verify

```sh
node -c vendor/tweakers/tweaks/tweaks-directory/index.cjs
cd packages
node --import tsx packages/installer/src/cli.ts validate-tweak ../vendor/tweakers/tweaks/tweaks-directory
```
