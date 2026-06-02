# Plugin Profiles Retirement

`co.thomashulihan.project-chrome-profile` is no longer an active store tweak.
Its Chrome profile assignment behavior now lives in `co.thomashulihan.projects`.

Projects reads legacy `co.thomashulihan.project-chrome-profile.json` storage as
a compatibility fallback and migrates assignments into its own
`chromeAssignments` storage shape. Keep this retired folder for one release
cycle as migration reference code, then remove it after installed users have had
time to move through Projects.
