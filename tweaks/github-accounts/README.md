# GitHub Accounts

GitHub Accounts adds a dedicated ShadGPT settings tab for assigning projects to
GitHub identities.

## What it does

- Stores named GitHub accounts with username and commit email.
- Lists known Codex projects from the sidebar, Codex project config, and common
  local project roots.
- Saves project-to-account assignments.
- Writes a managed `AGENTS.md` block so future Codex sessions know which
  GitHub account belongs to that project.
- Optionally applies repo-local Git identity with:
  - `git config --local user.name`
  - `git config --local user.email`
  - `git config --local github.user`

It does not store GitHub tokens or switch authenticated GitHub CLI sessions.
