---
name: bump-cli-tools
description: Route Socket CLI tool updates to their release workflows. Use when a request spans tools or the tool's packaging path is unclear.
allowed-tools: Read, Edit, Write, Bash, Glob
user-invocable: true
---

# Update CLI tools

Take the requested tool names and exact upstream versions as `$ARGUMENTS`. Ask
only for missing values. Read [the tool inventory](references/cli-tools.md),
then follow each matching `bump-*` skill.

For multiple tools, follow each workflow and keep separate changes in separate
PRs unless the user asks to combine them.
