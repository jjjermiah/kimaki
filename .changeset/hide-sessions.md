---
'kimaki': minor
---

New `--hide-sessions` flag. Kimaki sessions become children of one hidden parent session per project folder, so OpenCode's session lists (TUI picker, app home, switcher) skip them. `/resume` still finds them. Sessions made before the flag stay in the lists, and deleting a `kimaki:` parent session deletes every session under it.

Fixes #239
