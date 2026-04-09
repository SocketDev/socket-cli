---
name: quality-scan
description: >
  Iteratively scans socket-cli for code quality issues across critical bugs, logic errors,
  caching problems, workflow issues, security vulnerabilities, and documentation gaps.
  Automatically fixes all discovered issues and commits changes until zero issues remain or
  5 iterations complete. Use when performing comprehensive quality improvement or preparing
  for releases.
---

# quality-scan

## Task Checklist

Copy this checklist to track your progress through each iteration:

```markdown
### Iteration [N] Progress Tracker

- [ ] Phase 1: Validate git environment
- [ ] Phase 2: Update dependencies
- [ ] Phase 3: Clean repository
- [ ] Phase 4: Validate structure
- [ ] Phase 5: Determine scan scope
- [ ] Phase 5b: Install external tools (zizmor)
- [ ] Phase 6: Execute scans (critical, logic, cache, workflow, security+zizmor, documentation)
- [ ] Phase 7: Aggregate findings
- [ ] Phase 8: Generate report
- [ ] Phase 9: Fix all issues
- [ ] Phase 10: Run tests
- [ ] Phase 11: Commit fixes
- [ ] Decision: Continue to next iteration or exit

**Issues found**: [count]
**Issues fixed**: [count]
**Tests status**: [pass/fail]
```

## Execution Guidelines

<principles>
**Fix comprehensively**: Address all issues regardless of complexity. Architectural problems require fixing, not deferral, because incomplete fixes leave the codebase in an inconsistent state.

**Test continuously**: Run `pnpm test` after each iteration because untested fixes risk introducing regressions that compound across iterations.

**Bound iterations**: Cap at 5 iterations because unbounded loops escalate costs without guaranteed convergence; manual intervention becomes necessary beyond this threshold.

**Work sequentially**: Execute one phase completely before starting the next because each phase's output informs subsequent phases; parallel execution causes missing dependencies.
</principles>

<commit_strategy>
Examine repository history to choose the appropriate commit approach:

```bash
git rev-list --count HEAD
```

- **If count = 1**: Amend the single commit to maintain clean history
- **If count > 1**: Create new commits to preserve development timeline

Rationale: Single-commit repos indicate initial setup; amending keeps history clean. Multi-commit repos represent evolution; new commits preserve that narrative.
</commit_strategy>

## Phase-by-Phase Execution

### Phase 1: Validate Environment

<action>
Run `git status` to check repository state.
</action>

<decision_tree>
- Clean repository → Proceed to Phase 2
- Dirty repository → Warn user; ask to continue or abort
- Not a git repository → Exit with error (quality scans require version control)
</decision_tree>

Update checklist: Mark Phase 1 complete.

---

### Phase 2: Update Dependencies

<action>
Run `pnpm install` to ensure current dependencies.
</action>

Rationale: Outdated packages trigger false positives when scans expect current API signatures.

Track updated packages for commit message context.

Update checklist: Mark Phase 2 complete.

---

### Phase 3: Repository Cleanup

<action>
Find cleanup candidates using Glob tool, then ask user confirmation before deletion.
</action>

<cleanup_targets>
1. SCREAMING_TEXT.md files outside `.claude/` and `docs/` directories
2. Temporary files: `*.tmp`, `*.temp`, `.DS_Store`, `*~`, `*.swp`
3. Test files outside `test/` or `__tests__/` directories
</cleanup_targets>

Request confirmation for each file because automated deletion risks removing intentional files with unconventional names.

Update checklist: Mark Phase 3 complete.

---

### Phase 4: Structural Validation

<action>
Use Glob and Grep tools to validate repository structure against socket-cli conventions.
</action>

<validation_checks>
- package.json scripts follow naming conventions from CLAUDE.md
- Test files have corresponding vitest configurations
- Required files exist: tsconfig.json, .oxlintrc.json, vitest.config.mts
- Imports use `@socketsecurity/lib/*` pattern (not Node.js built-ins where applicable)
</validation_checks>

<severity_mapping>
- Missing required files → Critical (blocks builds)
- Inconsistent naming → High (causes confusion)
- Missing configs → Medium (reduces effectiveness)
</severity_mapping>

Update checklist: Mark Phase 4 complete.

---

### Phase 5: Determine Scan Scope

<action>
Ask user which scans to execute.
</action>

<user_prompt>
Which scans do you want to run?

1. All scans (recommended for comprehensive quality improvement)
2. Critical only (crashes, security, data corruption, auth)
3. Custom selection (choose specific scans)

Default: [1]
</user_prompt>

<available_scans>
See `reference.md` @reference for detailed agent prompts. Each scan targets specific issue categories:

- **critical**: Crashes, security vulnerabilities, data corruption, auth handling
- **logic**: Algorithm errors, edge cases, validation bugs
- **cache**: Config/token caching correctness
- **workflow**: Build scripts, CI/CD, cross-platform compatibility
- **security**: GitHub Actions security via zizmor + credential exposure patterns
- **documentation**: Command examples, API accuracy, missing docs
</available_scans>

Update checklist: Mark Phase 5 complete.

---

### Phase 5b: Install External Tools (zizmor)

<action>
Install zizmor for GitHub Actions security scanning using version that meets repository's minimumReleaseAge policy.
</action>

<version_selection>
Determine the appropriate zizmor version dynamically:

1. **Read minimumReleaseAge from `.pnpmrc`**:
   ```bash
   grep 'minimumReleaseAge' .pnpmrc | cut -d'=' -f2
   ```
   This returns minutes (e.g., `10080` = 7 days). Default to 10080 if not found.

2. **Query zizmor releases** (using curl or gh):
   ```bash
   # Option A: curl (universally available)
   curl -s "https://api.github.com/repos/zizmorcore/zizmor/releases" | \
     jq '[.[] | select(.prerelease == false) | {tag: .tag_name, date: .published_at}] | .[0:10]'

   # Option B: gh (if available)
   gh api repos/zizmorcore/zizmor/releases --jq \
     '[.[] | select(.prerelease == false) | {tag: .tag_name, date: .published_at}] | .[0:10]'
   ```

3. **Calculate age and select version**:
   - Convert minimumReleaseAge from minutes to days: `minutes / 1440`
   - Find latest stable release older than that threshold
   - Example: If minimumReleaseAge=10080 (7 days) and today is March 24, select releases from March 17 or earlier

4. **Install selected version** (choose based on available tools):
   ```bash
   # macOS with Homebrew (latest only, version pinning limited)
   brew install zizmor

   # Python environments (version pinning supported)
   pipx install zizmor==VERSION
   uv tool install zizmor==VERSION
   uvx zizmor@VERSION --help
   ```

   **Recommended priority**: pipx/uvx > brew
</version_selection>

<rationale>
Using minimumReleaseAge prevents supply chain attacks from compromised new releases. The 7-day window allows community detection of malicious packages before adoption.
</rationale>

<fallback>
If no release meets the age requirement, warn the user and skip zizmor scan. Never install a release younger than minimumReleaseAge.
</fallback>

Update checklist: Note zizmor version installed.

---

### Phase 6: Execute Scans

<action>
For each selected scan, spawn an agent using Task tool with the prompt from reference.md @reference.
</action>

<agent_spawning>
1. Use Task tool with `subagent_type='general-purpose'`
2. Pass the full agent prompt from reference.md for the scan type
3. Include current repository context (recent git log, modified files)
4. Collect findings from agent response
5. Track completion status in your checklist
</agent_spawning>

<execution_strategy>
Run scans **sequentially** (not parallel) because earlier scans may uncover issues that inform later scans. For example, critical crashes found early prevent wasting tokens on logic scans of unreachable code.

Order: critical → logic → cache → workflow → security → documentation
</execution_strategy>

<zizmor_execution>
For the **security** scan, run zizmor first to get machine-verified findings:

```bash
# Run zizmor on all workflow files
zizmor .github/workflows/*.yml --format json > /tmp/zizmor-output.json

# Or for human-readable output
zizmor .github/workflows/*.yml --format plain
```

Include zizmor findings in the security scan report. zizmor detects:
- Template injection vulnerabilities
- Unpinned action versions
- Dangerous permissions
- Artifact poisoning risks
- Excessive permissions

Merge zizmor output with agent-based security scan findings, deduplicating overlapping issues.
</zizmor_execution>

Choose an approach and commit to it. Execute all selected scans without revisiting scan selection unless you encounter blocking errors.

Update checklist: Mark Phase 6 complete.

---

### Phase 7: Aggregate Findings

<action>
Collect findings from all agent scans, deduplicate, and prioritize.
</action>

<deduplication_rules>
- **Same file and line**: Keep the finding with highest severity
- **Same issue pattern**: Merge descriptions, preserve most actionable fix
- **Different scans, same root cause**: Combine into single finding with multiple scan references
</deduplication_rules>

<sorting_hierarchy>
1. Severity: Critical → High → Medium → Low (severity gates determine release readiness)
2. Scan type: critical → logic → cache → workflow → security → documentation
3. File path: Alphabetical (enables systematic fixing)
</sorting_hierarchy>

<finding_structure>
Ensure each finding includes:

```
File: packages/cli/src/path/file.mts:123
Issue: One-line description
Severity: Critical|High|Medium|Low
Pattern: Code snippet (2-3 lines)
Trigger: Input/condition causing the issue
Fix: Specific code change
Impact: Consequence if triggered
```

This structure enables you to apply fixes systematically without re-reading findings.
</finding_structure>

Update checklist: Mark Phase 7 complete.

---

### Phase 8: Generate Report

<action>
Create a comprehensive report using the template below.
</action>

<report_template>
```markdown
# Quality Scan Report - socket-cli

**Date**: YYYY-MM-DD | **Iteration**: N/5 | **Total Issues**: X

## Summary

| Severity | Count |
|----------|-------|
| Critical | X     |
| High     | X     |
| Medium   | X     |
| Low      | X     |

## Findings by Severity

### Critical Issues (X)

**1. [Issue title]**
- File: `packages/cli/src/path/file.mts:123`
- Pattern: `code snippet`
- Trigger: When this happens
- Fix: Specific change
- Impact: What breaks

[Repeat for each]

[Additional severity sections follow same structure]

## Scan Coverage

| Scan Type     | Issues |
|---------------|--------|
| critical      | X      |
| logic         | X      |
| cache         | X      |
| workflow      | X      |
| security      | X      |
| documentation | X      |
```
</report_template>

Display report to user. Offer to save to `reports/quality-scan-YYYY-MM-DD.md`.

Update checklist: Mark Phase 8 complete.

---

### Phase 9: Fix All Issues

<action>
Apply fixes for every finding from the report, working from Critical to Low severity.
</action>

Read each file only once, then apply all fixes for that file using Edit tool. This batching approach minimizes tool calls.

Never speculate about code you have not read. Open each file before editing.

Update checklist: Mark Phase 9 complete.

---

### Phase 10: Run Tests

<action>
Execute `pnpm test` to verify fixes didn't introduce regressions.
</action>

<test_outcomes>
- **All pass**: Proceed to Phase 11
- **Some fail**: Revert last changes, report failed tests to user, exit iteration
</test_outcomes>

Tests validate that fixes solve problems without creating new ones; failures indicate logic errors in fixes requiring manual review.

Update checklist: Mark Phase 10 complete.

---

### Phase 11: Commit Fixes

<action>
Stage changes and create commit using strategy from earlier.
</action>

<commit_message_template>
```
fix: resolve quality scan issues (iteration N)

- Fixed X critical issues
- Fixed X high priority issues
- Fixed X medium priority issues
- Fixed X low priority issues

Scans: [list of scan types run]
```
</commit_message_template>

Use `git add .` followed by commit (amend if single-commit repo, new commit otherwise).

Update checklist: Mark Phase 11 complete.

---

### Phase 12: Iteration Decision

<action>
Determine whether to continue or exit.
</action>

<decision_logic>
**Exit conditions**:
- Zero issues found → Success! Output `<promise>QUALITY_SCAN_COMPLETE</promise>`
- Iteration count = 5 → Stop (manual intervention needed)

**Continue condition**:
- Issues remain AND iteration < 5 → Start new iteration, copy fresh checklist
</decision_logic>

When continuing, increment iteration counter and return to Phase 6 (re-run scans on updated code).

---

## Error Recovery

<error_scenarios>
**Scan agent failures**: Log warning, continue with remaining scans, note failure in report. Don't abort the entire process because other scans may still find valuable issues.

**Test failures after fixes**: Revert changes from current iteration using `git restore .`, report specific test failures to user, exit. Test failures indicate logic errors requiring human review.

**Git commit failures**: Display error, ask user to resolve manually. Cannot proceed without clean commits because subsequent iterations depend on committed changes.

**Dirty repository**: Warn user, offer to stash changes or continue with dirty state. Continuing risks conflating quality fixes with unrelated changes.
</error_scenarios>

---

## socket-cli Context

<scan_scope>
Primary targets: `packages/cli/src/`, `packages/cli/test/`, `.github/workflows/`, `scripts/`, `.config/`

Excluded: `node_modules/`, `dist/`, `build/`, `.pnpm-store/`, `packages/*/dist/`
</scan_scope>

<codebase_patterns>
Apply these socket-cli conventions when scanning and fixing:

- Import pattern: `@socketsecurity/lib/*` (not Node.js built-ins where Socket provides equivalents)
- Error types: `InputError`, `AuthError` from `src/utils/errors.mts`
- Logging: `getDefaultLogger()` from `@socketsecurity/lib/logger`
- File extension: `.mts` for TypeScript modules
- Type imports: `import type` separately (NEVER mix with runtime imports)
- CLI framework: meow-based command structure
</codebase_patterns>

---

## Reference

See `reference.md` @reference for complete agent prompts and pattern definitions.

**Version**: 1.1.0 (2026-03-24)
