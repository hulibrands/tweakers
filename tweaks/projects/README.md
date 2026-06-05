# ShadGPT Projects

Adds a Projects settings page for per-project connection review and assignment.

## What It Shows

- Sidebar project color controls shared with ShadGPT UI Improvements.
- Chrome profile assignments managed by ShadGPT Projects.
- Read-only GitHub repository and local Git identity links for each project.
- Project-local Gmail account assignments.
- Project-local Google Drive account assignments for Drive, Docs, Sheets, and Slides plugin work.
- Project-local Modal workspace assignment, seeded with the TRR `admin-56995` workspace/profile.
- Optional Supabase MCP profile configuration for `.codex/config.toml`.
- Redacted `.env` inventory for real project env files.
- Read-only service cards for detected account connections such as GitHub, Gmail, Google Drive, Vercel, Modal Platform, Supabase, and database providers.
- Expandable service cards with unique key counts, total entries, duplicate file entries, and per-key file drilldowns.

## Chrome Profiles

Chrome profile choices are filtered to profiles where the configured Codex Chrome Extension is installed and enabled. The dropdown shows the profile avatar and email, and intentionally hides Chrome profile directory numbers from the visible label.

Each project page also shows an Active Chrome Profile tile above the editable connection rows. The tile is read-only: it shows whether the current project is using its own saved Chrome route, inheriting the default route, or missing a route. Opening a project page refreshes the active Chrome profile signal used by bundled `@Chrome` scripts when they launch outside the project directory.

## GitHub Repositories

GitHub account assignment has been retired. Projects still show detected GitHub remotes and the local Git identity as read-only context so each sidebar project keeps its repo link without saving account settings.

## Google Workspace Accounts

Gmail and Google Drive are separate project-local assignments. They use the same saved Google account list so one project can default Gmail and Drive to `thomas@hulibrands.com` while another project can default them to a TRR account.

The account picker is seeded from Chrome profiles that already have the Codex Chrome Extension installed and enabled, plus connector metadata when the Gmail or Google Drive plugin exposes account email metadata locally. Manual Google accounts can also be added from the Projects settings page.

## Modal Workspace

Projects includes a Modal Workspace account picker so deploy and readiness work can be tied to the intended Modal workspace instead of the globally active CLI profile. The default account is `admin-56995` / `admin-56995` for TRR.

## MCP Resolver

The bundled `mcp-server.js` exposes `projects_google_workspace_resolve`. Agents can call it with the current project path before using [@gmail](plugin://gmail@openai-curated) or [@google-drive](plugin://google-drive@openai-curated) so plugin work can use the project-local Gmail or Drive account assignment instead of assuming one global Google account.

## Environment Inventory

Values stay redacted until explicitly revealed. Example files such as `.env.example` and `.env.local.example` are skipped in the inventory so placeholder keys do not appear as active connections.

Connection summaries classify specific provider keys before broad patterns. For example, `VERCEL_GIT_*` keys count as Vercel deployment metadata instead of GitHub, and `REDDIT_CLIENT_ID` counts as Reddit instead of generic Google/OAuth.
