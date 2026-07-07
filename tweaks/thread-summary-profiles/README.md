# ShadGPT Thread Summary Profiles

Adds a compact read-only `Profiles` section to the Codex thread summary panel.

The tweak displays the existing local connection truth for the active project:

- Chrome
- Supabase
- GitHub
- Google Drive
- Gmail
- Modal
- Decodo
- Railway

It does not create account settings or write profile assignments. Chrome data is read from the existing `co.thomashulihan.project-chrome-profile` storage file, Google Workspace, Modal, and Decodo data are read from the existing `co.thomashulihan.projects` storage file, Supabase data is read from the project `.codex/config.toml`, GitHub data is read from local git remotes, and Railway data is read only from project-local Railway config files.

Summary lookups are cached briefly per project path so renderer reinjection does not repeatedly scan local files or run CLI checks. Modal CLI conflict status is cached separately and shows when the CLI status was last checked.

Privacy rules:

- No bearer tokens, cookies, OAuth tokens, environment values, or full connector payloads are rendered.
- Supabase rows show only project ref/name and feature metadata.
- Google rows show only the assigned email.
- Modal rows show only profile/workspace and local CLI conflict status when checked.
- Decodo rows show only the assigned account label or username.
- Railway rows show only project/environment identifiers from project-local config.

Focused tests can be run with:

```sh
node --test vendor/tweakers/tweaks/thread-summary-profiles/test/*.test.js
```
