---
name: scanning-quality
description: Scans the codebase for bugs, logic errors, caching issues, and workflow problems using specialized agents. Use when preparing for release, investigating quality issues, or running pre-merge checks.
user-invocable: true
allowed-tools: Task, Read, Grep, Glob, AskUserQuestion, Bash(pnpm run check:*), Bash(pnpm run test:*), Bash(pnpm test:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*)
---

# scanning-quality

Perform comprehensive quality analysis across the codebase using specialized agents. Clean up junk files first, then scan and generate a prioritized report with actionable fixes.

## Scan Types

1. **critical** - Crashes, security vulnerabilities, resource leaks, data corruption
2. **logic** - Algorithm errors, edge cases, type guards, off-by-one errors
3. **cache** - Cache staleness, race conditions, invalidation bugs
4. **workflow** - Build scripts, CI issues, cross-platform compatibility
5. **workflow-optimization** - CI optimization (build-required conditions on cached builds)
6. **security** - GitHub Actions workflow security (zizmor scanner)
7. **documentation** - README accuracy, outdated docs, missing documentation
8. **patch-format** - Patch file format validation

Agent prompts for each scan type are in `reference.md`.

## Process

### Phase 1: Validate Environment

```bash
git status
```

Warn about uncommitted changes but continue (scanning is read-only).

### Phase 2: Update Dependencies

```bash
pnpm run update
```

Only update the current repository. Continue even if update fails.

### Phase 3: Install zizmor

Install zizmor for GitHub Actions security scanning, respecting the soak window — pnpm-workspace.yaml `minimumReleaseAge` in minutes, default 10080 (= 7 days). Query GitHub releases, find the latest stable release older than the threshold, and install via pipx/uvx. Skip the security scan if no release meets the soak requirement.

### Phase 4: Repository Cleanup

Find and remove junk files (with user confirmation via AskUserQuestion):
- SCREAMING_TEXT.md files outside `.claude/` and `docs/`
- Test files in wrong locations
- Temp files (`.tmp`, `.DS_Store`, `*~`, `*.swp`, `*.bak`)
- Log files in root/package directories

### Phase 5: Structural Validation

```bash
node scripts/check-paths.mts
```

Report errors as Critical findings. Warnings are Low findings. (The fleet's structural validator is `check-paths.mts`, the path-hygiene gate. If a repo has a richer structural validator under a different name, run that instead — but every fleet repo ships `check-paths.mts`.)

### Phase 6: Determine Scan Scope

Ask user which scans to run using AskUserQuestion (multiSelect). Default: all scans.

### Phase 7: Execute Scans

For each enabled scan type, spawn a Task agent with the corresponding prompt from `reference.md`. Run sequentially in priority order: critical, logic, cache, workflow, then others.

Each agent reports findings as:
- File: path:line
- Issue, Severity, Pattern, Trigger, Fix, Impact

### Phase 8: Aggregate and Report

- Deduplicate findings across scan types
- Sort by severity: Critical > High > Medium > Low
- Generate markdown report with file:line references, suggested fixes, and coverage metrics
- Offer to save to `reports/scanning-quality-YYYY-MM-DD.md`

### Phase 9: Summary

Report final metrics: dependency updates, structural validation results, cleanup stats, scan counts, and total findings by severity.

## Commit cadence

This skill is read-only — it scans and reports, it doesn't fix. Cadence rules apply to *handing the report off*, not to fixes:

- **Save the report before acting on it.** If the user opts to save (`reports/scanning-quality-YYYY-MM-DD.md`), commit the report file in its own commit (`docs(reports): scanning-quality YYYY-MM-DD`). That snapshot is referenceable later when fixes land.
- **Don't fix in-skill.** If findings need fixes, hand off to the appropriate skill — `/guarding-paths` for path drift, `refactor-cleaner` agent via `/quality-loop` for code-quality findings — and commit those fixes per that skill's own cadence rules. Don't bundle scan + fixes in one commit.
- **One report per scan run.** Re-running the skill produces a new report; don't overwrite the previous one's git history. Commit each fresh report so the trend line is visible.
