# ShadGPT Titlebar Controls

Renderer-only ShadGPT tweak that aligns the app's sidebar/back/forward controls
with the native macOS titlebar traffic-light buttons.

## Install for Development

```sh
shadgpt dev /Users/thomashulihan/Projects/shadgpt/vendor/tweakers/tweaks/titlebar-controls --replace
```

The active ShadGPT tweak entry should be a symlink:

```sh
readlink "$HOME/Library/Application Support/ShadGPT/TweakerLibrary/tweaks/co.thomashulihan.titlebar-controls"
```
