---
name: scanning-quality
description: Scans the codebase for bugs, logic errors, cache races, workflow problems, insecure defaults, security regressions in the diff, and variant analysis on prior findings. Spawns specialized Task agents per scan type, deduplicates findings, and produces an A-F prioritized report. Use when preparing a release, investigating quality issues, running pre-merge checks, or whenever a recent diff touches security-sensitive code.
user-invocable: true
allowed-tools: Task, Read, Grep, Glob, AskUserQuestion, Bash(pnpm run check:*), Bash(pnpm run test:*), Bash(pnpm test:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*)
---

# scanning-quality

Quality analysis across the codebase using specialized Task agents. Cleans up junk files, runs structural validation, dispatches one agent per scan type, deduplicates findings, and produces an A-F prioritized report.

## Modes

- **Default (interactive)** — `AskUserQuestion` is used to confirm cleanup deletions and to pick scan scope.
- **Non-interactive** — `/scanning-quality non-interactive` (or any of the aliases below) skips every `AskUserQuestion` and applies safe defaults: scan scope = all types, cleanup = leave junk files in place (don't delete without confirmation), report-save = yes (`reports/scanning-quality-YYYY-MM-DD.md`). Use this when running headlessly (CI cron, programmatic Claude, any non-TTY driver). The four-flag programmatic-Claude lockdown rule already strips `AskUserQuestion`, so headless runs default to non-interactive automatically — but call it out explicitly so future readers understand the contract.

Detect non-interactive mode via any of: `--non-interactive` argument, `non-interactive` argument, `SCANNING_QUALITY_NONINTERACTIVE=1` env var, or absence of `AskUserQuestion` in the available tool surface.

## Scan Types

Legacy scan types (agent prompts in `reference.md`):

1. **critical** - Crashes, security vulnerabilities, resource leaks, data corruption
2. **logic** - Algorithm errors, edge cases, type guards, off-by-one errors
3. **cache** - Cache staleness, race conditions, invalidation bugs
4. **workflow** - Build scripts, CI issues, cross-platform compatibility
5. **workflow-optimization** - CI optimization (build-required conditions on cached builds)
6. **security** - GitHub Actions workflow security (zizmor scanner)
7. **documentation** - README accuracy, outdated docs, missing documentation
8. **patch-format** - Patch file format validation

Modular scan types (one file per type under `scans/`, easier to extend than the monolithic `reference.md`):

9. **variant-analysis** — for each High/Critical finding from above, search the rest of the repo for the same shape. See [`scans/variant-analysis.md`](scans/variant-analysis.md).
10. **insecure-defaults** — fail-open defaults, hardcoded credentials, lazy fallbacks. See [`scans/insecure-defaults.md`](scans/insecure-defaults.md).
11. **differential** — security-focused diff against a base ref. See [`scans/differential.md`](scans/differential.md).
12. **bundle-trim** — for repos that ship a built bundle (today: rolldown), identify unused module paths the bundler statically pulled in but the runtime never reaches. Reports candidates; the trim loop itself lives in the [`trimming-bundle`](../trimming-bundle/SKILL.md) skill. See [`scans/bundle-trim.md`](scans/bundle-trim.md).

Adding a new scan type: drop a file under `scans/<name>.md` describing mission, method, output shape, when-to-skip — same shape as the three above. The orchestrator picks them up by directory listing; no edits to this SKILL.md needed beyond appending to the list.

The split exists because adding a 12th, 15th, 20th scan type into `reference.md` produces exactly the "this and also that and also the other thing" file CLAUDE.md's File-size rule warns about. Per-type files keep each scan reviewable in isolation.

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

Find junk files (interactive mode confirms each batch via `AskUserQuestion`; non-interactive mode lists what was found in the report and leaves them in place — don't delete files without explicit confirmation, even on a clean dirty-tree):
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

In **interactive** mode, ask the user which scans to run via `AskUserQuestion` (multiSelect). Default: all scans.

In **non-interactive** mode, run all scan types — no prompt.

### Phase 7: Execute Scans

For each enabled scan type, spawn a Task agent with the corresponding prompt:
- Legacy types (1–8) — prompt from `reference.md`.
- Modular types (9+) — prompt from `scans/<type>.md`.

Run sequentially in priority order: critical, logic, cache, workflow, security, then the modular scans (variant-analysis depends on earlier findings so runs after them; insecure-defaults and differential are independent), then documentation last.

Each agent reports findings as:
- File: path:line
- Issue, Severity, Pattern, Trigger, Fix, Impact

### Phase 8: Aggregate and Report

- Deduplicate findings across scan types
- Sort by severity: Critical > High > Medium > Low
- Generate markdown report with file:line references, suggested fixes, and coverage metrics
- **Interactive**: offer to save to `reports/scanning-quality-YYYY-MM-DD.md` via `AskUserQuestion`.
- **Non-interactive**: save the report unconditionally to `reports/scanning-quality-YYYY-MM-DD.md` (create the directory if missing) so the artifact is visible to the orchestrating runner. If the `Write` tool isn't in the allow list, emit the full markdown to stdout with a leading `=== REPORT MARKDOWN ===` marker so the runner can capture and persist it.

### Phase 9: Summary

Report final metrics: dependency updates, structural validation results, cleanup stats, scan counts, and total findings by severity.

## Commit cadence

This skill is read-only — it scans and reports, it doesn't fix. Cadence rules apply to *handing the report off*, not to fixes:

- **Save the report before acting on it.** If the user opts to save (`reports/scanning-quality-YYYY-MM-DD.md`), commit the report file in its own commit (`docs(reports): scanning-quality YYYY-MM-DD`). That snapshot is referenceable later when fixes land.
- **Don't fix in-skill.** If findings need fixes, hand off to the appropriate skill — `/guarding-paths` for path drift, `refactor-cleaner` agent via `/quality-loop` for code-quality findings — and commit those fixes per that skill's own cadence rules. Don't bundle scan + fixes in one commit.
- **One report per scan run.** Re-running the skill produces a new report; don't overwrite the previous one's git history. Commit each fresh report so the trend line is visible.
