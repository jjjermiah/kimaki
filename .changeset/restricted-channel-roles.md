---
'kimaki': minor
---

Restricted channel roles. A member with a role named `kimaki-<channel name>` (for example `kimaki-jellyfin`) can chat only in that channel and its threads. Slash commands, buttons, voice, `!` shell and `/` commands are refused for them. Sessions in a restricted channel get OpenCode deny rules for shell, edit, external directories and subagents, for everyone including the owner.
