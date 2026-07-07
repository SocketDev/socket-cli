# defer-to-script-nudge

**Trigger:** PreToolUse on Edit/Write/MultiEdit to a skill (`SKILL.md`) or
command (`.claude/commands/**/*.md`) whose post-edit content has a fenced LOGIC
code block over 12 lines and no backing `scripts/**.mts` reference.

**Action:** NUDGES (notify only, never blocks). A skill/command is a thin
wrapper — inline logic is untested, unlinted, and not reusable. Move it to a
`scripts/**/*.mts` and invoke that script from the markdown.

Fails open on non-skill/command files / absent content.
