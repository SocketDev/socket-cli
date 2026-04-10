---
name: updating
description: >
  Coordinates all dependency updates (npm packages and external tool checksums).
  Triggers when user asks to "update everything", "update dependencies", or
  prepare for a release.
user-invocable: true
allowed-tools: Task, Skill, Bash, Read, Grep, Glob, Edit
---

# updating

<task>
Your task is to update all dependencies in socket-cli: npm packages via `pnpm run update`, then sync external tool checksums, ensuring all builds and tests pass.
</task>

<constraints>
- Start with clean working directory (no uncommitted changes).
- Target stable releases only (exclude -rc, -alpha, -beta tags).
- **CI mode** (`CI=true` or `GITHUB_ACTIONS`): Create atomic commits, skip build validation.
- **Interactive mode** (default): Validate each update with build/tests before proceeding.
</constraints>

## Phases

1. **Validate Environment** - Verify clean working directory; detect CI vs interactive mode.
2. **Update npm Packages** - Run `pnpm run update`; commit if changes detected.
3. **Update External Tool Checksums** - Invoke the `updating-checksums` skill.
3b. **Update Security Tools** - Run `node .claude/hooks/setup-security-tools/update.mts` to check for new zizmor/sfw releases. Respects pnpm `minimumReleaseAge` cooldown for third-party tools (zizmor) but updates Socket tools (sfw) immediately. Updates embedded checksums in the setup hook.
4. **Final Validation** - In interactive mode: `pnpm run fix --all`, `pnpm run check --all`, `pnpm test`. Skipped in CI.
5. **Report Summary** - List updates applied, commits created, validation results, and next steps.

## Coordinates

- `updating-checksums` skill for external tool checksums
- `node .claude/hooks/setup-security-tools/update.mts` for security tool version updates
- `pnpm run update` for npm packages
