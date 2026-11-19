---
name: bump-bundled-tools
description: Update a versioned tool bundled in the native CLI. Use when bumping socket-patch, uv, cdxgen, or synp.
user-invocable: true
---

# Bump a bundled native tool

Take a tool name and its exact upstream version as `$ARGUMENTS`; ask if either
is missing. Read [the bundled tool inventory](references/bundled-tools.md),
then follow that tool's matching `bump-*` skill. Update one tool per change.

Check the target-specific payload and manifest after building. Keep any tool
unavailable while its provenance, license, or notice checks remain unresolved.
Do not add a new tool here unless the builder stages it into the VFS.
