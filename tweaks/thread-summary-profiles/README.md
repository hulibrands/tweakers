# ShadGPT Thread Summary Profiles

Adds a compact read-only `Profiles` section to the Codex thread summary panel.

The tweak displays the existing local connection truth for the active project:

- Chrome
- Supabase
- GitHub
- Google Drive
- Gmail
- Modal

It does not create account settings or write profile assignments. Chrome, Google Workspace, and Modal data are read from the existing `co.thomashulihan.projects` storage file, with legacy Chrome fallback reads from `co.thomashulihan.project-chrome-profile`. Supabase data is read from the project `.codex/config.toml`, and GitHub data is read from local git remotes.

Privacy rules:

- No bearer tokens, cookies, OAuth tokens, environment values, or full connector payloads are rendered.
- Supabase rows show only project ref/name and feature metadata.
- Google rows show only the assigned email.
- Modal rows show only profile/workspace and local CLI conflict status when checked.

Focused tests can be run with:

```sh
node --test tweaks/thread-summary-profiles/test/*.js
```
