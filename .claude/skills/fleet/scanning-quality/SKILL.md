---
name: scanning-quality
description: Scans the codebase for bugs, logic errors, cache races, workflow problems, insecure defaults, security regressions in the diff, and variant analysis on prior findings. Runs a Workflow that fans out one finder per scan type in parallel, runs variant-analysis as a dependent stage, adversarially verifies High/Critical findings, deduplicates, and produces an A-F prioritized report. Use when preparing a release, investigating quality issues, running pre-merge checks, or whenever a recent diff touches security-sensitive code.
user-invocable: true
allowed-tools: Workflow, Task, Read, Grep, Glob, Write, AskUserQuestion, Bash(pnpm run check:*), Bash(pnpm run test:*), Bash(pnpm test:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*)
model: claude-opus-4-8
context: fork
---

# scanning-quality

Quality analysis across the codebase via a `Workflow`. Cleans up junk files, runs structural validation, then fans out one finder agent per scan type in parallel (variant-analysis as a dependent stage, adversarial verify on High/Critical), deduplicates, and produces an A-F prioritized report.

## Modes

- **Default (interactive)**: `AskUserQuestion` is used to confirm cleanup deletions and to pick scan scope.
- **Non-interactive**: `/scanning-quality non-interactive` (or any of the aliases below) skips every `AskUserQuestion` and applies safe defaults: scan scope = all types, cleanup = leave junk files in place (don't delete without confirmation), report-save = yes (`reports/scanning-quality-YYYY-MM-DD.md`). Use this when running headlessly (CI cron, programmatic Claude, any non-TTY driver). The four-flag programmatic-Claude lockdown rule already strips `AskUserQuestion`, so headless runs default to non-interactive automatically. Call it out explicitly so future readers understand the contract.

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

9. **variant-analysis**: for each High/Critical finding from above, search the rest of the repo for the same shape. See [`scans/variant-analysis.md`](scans/variant-analysis.md).
10. **insecure-defaults**: fail-open defaults, hardcoded credentials, lazy fallbacks. See [`scans/insecure-defaults.md`](scans/insecure-defaults.md).
11. **differential**: security-focused diff against a base ref. See [`scans/differential.md`](scans/differential.md).
12. **bundle-trim**: for repos that ship a built bundle (today: rolldown), identify unused module paths the bundler statically pulled in but the runtime never reaches. Reports candidates; the trim loop itself lives in the [`trimming-bundle`](../trimming-bundle/SKILL.md) skill. See [`scans/bundle-trim.md`](scans/bundle-trim.md).
13. **deadcode-removal**: surface dead source files, test-only helpers, stale `// eslint-disable` / `// oxlint-disable` directives, and dead string-literal constants. Captures the fleet rule that `socket/export-top-level-functions` REQUIRES `export` on helpers (exports exist for tests), so the scan never recommends dropping `export` to colocate. See [`scans/deadcode-removal.md`](scans/deadcode-removal.md).

Adding a new scan type: drop a file under `scans/<name>.md` describing mission, method, output shape, when-to-skip; same shape as the three above. The orchestrator picks them up by directory listing; no edits to this SKILL.md needed beyond appending to the list.

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

Install zizmor for GitHub Actions security scanning, respecting the soak time (pnpm-workspace.yaml `minimumReleaseAge` in minutes, default 10080 = 7 days). Query GitHub releases, find the latest stable release older than the threshold, and install via pipx/uvx. Skip the security scan if no release meets the soak requirement.

### Phase 4: Repository Cleanup

Find junk files (interactive mode confirms each batch via `AskUserQuestion`; non-interactive mode lists what was found in the report and leaves them in place; don't delete files without explicit confirmation, even on a clean dirty-tree):

- SCREAMING_TEXT.md files outside `.claude/` and `docs/`
- Test files in wrong locations
- Temp files (`.tmp`, `.DS_Store`, `*~`, `*.swp`, `*.bak`)
- Log files in root/package directories

### Phase 5: Structural Validation

```bash
node scripts/fleet/check-paths.mts
```

Report errors as Critical findings. Warnings are Low findings. (The fleet's structural validator is `check-paths.mts`, the path-hygiene gate. If a repo has a richer structural validator under a different name, run that instead. Every fleet repo ships `check-paths.mts`.)

### Phase 6: Determine Scan Scope

In **interactive** mode, ask the user which scans to run via `AskUserQuestion` (multiSelect). Default: all scans.

In **non-interactive** mode, run all scan types; no prompt.

### Phase 7: Execute Scans

Run the enabled scans as a **`Workflow`** (not ad-hoc `Task` spawns). The scan set is independent fan-out + a dependent variant-analysis stage + a dedup/synthesize barrier — exactly what `Workflow` models, and the structured-output schema makes each finder return validated data instead of free text the orchestrator re-parses. The skill invoking `Workflow` is a sanctioned opt-in; pass the enabled-scan list as `args`.

Author the script inline (don't pre-Write it). Shape:

1. **`phase('Scan')` — parallel independent finders.** One `agent()` per enabled scan type whose prompt is the scan's `reference.md` section (legacy 1–8) or `scans/<type>.md` (modular). Each uses `agentType: 'Explore'` (read-only sweep), a `FINDINGS_SCHEMA` (`{ scanType, findings: [{ file, line, issue, severity: critical|high|medium|low, pattern, trigger, fix, impact }] }`), and runs under `parallel(...)` — `variant-analysis` is NOT in this batch (it depends on the others).
2. **Barrier → dedup.** Collect all finder results, `.filter(Boolean)`, flatten findings, dedup by `file:line:issue` in plain code (genuinely needs all findings at once — the barrier is justified).
3. **`phase('Variant')` — dependent stage.** For each High/Critical deduped finding, one `agent()` (the `scans/variant-analysis.md` prompt) searching the repo for the same shape; merge new variants in.
4. **`phase('Verify')` — adversarial pass** (thorough/release runs only): per High/Critical finding, spawn a skeptic that tries to REFUTE it (`{ isReal, why }` schema); drop findings ≥majority refute. Skip for a quick scan — `log()` that it was skipped so the report doesn't read as fully verified.
5. **Synthesize** — a final `agent()` takes the deduped+verified JSON and writes the A-F prioritized markdown report (sections by severity, file:line refs, fixes, coverage metrics).

Return `{ report, findingCount, bySeverity }` from the script. Each finder's `FINDINGS_SCHEMA` replaces the old free-text "File / Issue / Severity / Pattern / Trigger / Fix / Impact" shape — same fields, now validated.

### Phase 8: Save the report

The Workflow returns the synthesized A-F markdown. Save it:

- **Interactive**: offer to save to `reports/scanning-quality-YYYY-MM-DD.md` via `AskUserQuestion`.
- **Non-interactive**: save unconditionally to `reports/scanning-quality-YYYY-MM-DD.md` (create the dir if missing). If `Write` isn't in the allow list, emit the full markdown to stdout with a leading `=== REPORT MARKDOWN ===` marker so the runner can capture it.

### Phase 9: Summary

Report final metrics: dependency updates, structural validation results, cleanup stats, scan counts, and total findings by severity.

## Commit cadence

This skill is read-only. It scans and reports, it doesn't fix. Cadence rules apply to _handing the report off_, not to fixes:

- **Save the report before acting on it.** If the user opts to save (`reports/scanning-quality-YYYY-MM-DD.md`), commit the report file in its own commit (`docs(reports): scanning-quality YYYY-MM-DD`). That snapshot is referenceable later when fixes land.
- **Don't fix in-skill.** If findings need fixes, hand off to the appropriate skill (`/fleet:guarding-paths` for path drift, `refactor-cleaner` agent via `/fleet:looping-quality` for code-quality findings) and commit those fixes per that skill's own cadence rules. Don't bundle scan + fixes in one commit.
- **One report per scan run.** Re-running the skill produces a new report; don't overwrite the previous one's git history. Commit each fresh report so the trend line is visible.
