---
name: quality-scan
description: >
  Runs iterative code quality scans on socket-cli, fixing all discovered issues
  and committing changes until zero issues remain or 5 iterations complete.
  Use when improving code quality, investigating regressions, or before
  releases.
---

# quality-scan

<task>
Your task is to scan socket-cli for code quality issues and fix them iteratively.
</task>

<constraints>
- Fix all issues regardless of complexity; do not defer architectural problems.
- Run `pnpm test` after each iteration.
- Cap at 5 iterations; stop and report if issues persist.
- Execute phases sequentially; each phase's output informs the next.
- If repo has 1 commit, amend; otherwise create new commits.
</constraints>

## Phases

1. **Validate Environment** - `git status`; abort if not a git repo, warn if dirty.
2. **Update Dependencies** - `pnpm install` to avoid stale-API false positives.
3. **Repository Cleanup** - Glob for temp files, stray docs; confirm before deletion.
4. **Structural Validation** - Verify required configs, naming conventions, import patterns.
5. **Determine Scan Scope** - Ask user: all scans, critical only, or custom selection.
5b. **Install zizmor** - Install version meeting `.pnpmrc` minimumReleaseAge policy.
6. **Execute Scans** - Run selected scans sequentially via Task tool using prompts from `reference.md`.
7. **Aggregate Findings** - Deduplicate, prioritize (Critical > High > Medium > Low).
8. **Generate Report** - Summary table by severity + scan type, display to user.
9. **Fix All Issues** - Apply fixes from Critical to Low; read each file before editing.
10. **Run Tests** - `pnpm test`; revert and exit iteration on failure.
11. **Commit Fixes** - Stage and commit with summary of fixed issue counts.
12. **Iteration Decision** - Zero issues = done; otherwise loop back to Phase 6.

## Available Scans

See `reference.md` for detailed agent prompts. Scan types:

- **critical** - Crashes, security vulnerabilities, data corruption, auth handling
- **logic** - Algorithm errors, edge cases, validation bugs
- **cache** - Config/token caching correctness
- **workflow** - Build scripts, CI/CD, cross-platform compatibility
- **security** - GitHub Actions security via zizmor + credential exposure patterns
- **documentation** - Command examples, API accuracy, missing docs

## Scan Scope

Primary: `packages/cli/src/`, `packages/cli/test/`, `.github/workflows/`, `scripts/`, `.config/`
Excluded: `node_modules/`, `dist/`, `build/`, `.pnpm-store/`, `packages/*/dist/`

## Error Recovery

- **Scan agent failure**: Log warning, continue remaining scans.
- **Test failure after fixes**: `git restore .`, report failures, exit iteration.
- **Git commit failure**: Display error, ask user to resolve.
