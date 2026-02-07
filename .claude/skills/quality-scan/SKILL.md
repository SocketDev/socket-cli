---
name: quality-scan
description: Performs comprehensive quality scans across codebase to identify critical bugs, logic errors, caching issues, and workflow problems. Spawns specialized agents for targeted analysis and generates prioritized improvement tasks. Use when improving code quality, before releases, or investigating issues.
---

# quality-scan

<task>
Your task is to perform comprehensive quality scans across the socket-btm codebase using specialized agents to identify critical bugs, logic errors, caching issues, and workflow problems. Generate a prioritized report with actionable improvement tasks.
</task>

<context>
**What is Quality Scanning?**
Quality scanning uses specialized AI agents to systematically analyze code for different categories of issues. Each agent type focuses on specific problem domains and reports findings with severity levels and actionable fixes.

**socket-btm Architecture:**
This is Socket Security's binary tooling manager (BTM) that:
- Builds custom Node.js binaries with Socket Security patches
- Manages Node.js versions and patch synchronization
- Produces minimal Node.js builds (node-smol-builder)
- Processes upstream Node.js source code and applies security patches
- Supports production deployments with patched Node.js

**Scan Types Available:**
1. **critical** - Crashes, security vulnerabilities, resource leaks, data corruption
2. **logic** - Algorithm errors, edge cases, type guards, off-by-one errors
3. **cache** - Cache staleness, race conditions, invalidation bugs
4. **workflow** - Build scripts, CI issues, cross-platform compatibility
5. **security** - GitHub Actions workflow security (zizmor scanner)
6. **documentation** - README accuracy, outdated docs, missing documentation

**Why Quality Scanning Matters:**
- Catches bugs before they reach production
- Identifies security vulnerabilities early
- Improves code quality systematically
- Provides actionable fixes with file:line references
- Prioritizes issues by severity for efficient remediation

**Agent Prompts:**
All agent prompts are embedded in `reference.md` with structured <context>, <instructions>, <pattern>, and <output_format> tags following Claude best practices.
</context>

<constraints>
**CRITICAL Requirements:**
- Read-only analysis (no code changes during scan)
- Must complete all enabled scans before reporting
- Findings must be prioritized by severity (Critical → High → Medium → Low)
- Must generate actionable tasks with file:line references
- All findings must include suggested fixes

**Do NOT:**
- Fix issues during scan (analysis only - report findings)
- Skip critical scan types without user permission
- Report findings without file/line references
- Proceed if codebase has uncommitted changes (warn but continue)

**Do ONLY:**
- Run enabled scan types in priority order (critical → logic → cache → workflow)
- Generate structured findings with severity levels
- Provide actionable improvement tasks with specific code changes
- Report statistics and coverage metrics
- Deduplicate findings across scans
</constraints>

<instructions>

## Process

Execute the following phases sequentially to perform comprehensive quality analysis.

### Phase 1: Validate Environment

<prerequisites>
Verify the environment before starting scans:
</prerequisites>

```bash
git status
```

<validation>
**Expected State:**
- Working directory should be clean (warn if dirty but continue)
- On a valid branch
- Node modules installed

**If working directory dirty:**
- Warn user: "Working directory has uncommitted changes - continuing with scan"
- Continue with scans (quality scanning is read-only)

</validation>

---

### Phase 2: Determine Scan Scope

<action>
Ask user which scans to run:
</action>

**Default Scan Types** (run all unless user specifies):
1. **critical** - Critical bugs (crashes, security, resource leaks)
2. **logic** - Logic errors (algorithms, edge cases, type guards)
3. **cache** - Caching issues (staleness, races, invalidation)
4. **workflow** - Workflow problems (scripts, CI, git hooks)
5. **security** - GitHub Actions security (template injection, cache poisoning, etc.)
6. **documentation** - Documentation accuracy (README errors, outdated docs)

**User Interaction:**
Use AskUserQuestion tool:
- Question: "Which quality scans would you like to run?"
- Header: "Scan Types"
- multiSelect: true
- Options:
  - "All scans (recommended)" → Run all 4 scan types
  - "Critical only" → Run critical scan only
  - "Critical + Logic" → Run critical and logic scans
  - "Custom selection" → Ask user to specify which scans

**Default:** If user doesn't specify, run all scans.

<validation>
Validate selected scan types exist in reference.md:
- critical-scan → reference.md line ~5
- logic-scan → reference.md line ~100
- cache-scan → reference.md line ~200
- workflow-scan → reference.md line ~300
- security-scan → reference.md line ~400
- documentation-scan → reference.md line ~810

If user requests non-existent scan type, report error and suggest valid types.
</validation>

---

### Phase 3: Execute Scans

<action>
For each enabled scan type, spawn a specialized agent using Task tool:
</action>

```typescript
// Example: Critical scan
Task({
  subagent_type: "general-purpose",
  description: "Critical bugs scan",
  prompt: `${CRITICAL_SCAN_PROMPT_FROM_REFERENCE_MD}

Focus on packages/node-smol-builder/ directory and root-level scripts/.

Report findings in this format:
- File: path/to/file.mts:lineNumber
- Issue: Brief description
- Severity: Critical/High/Medium/Low
- Pattern: Code snippet
- Trigger: What input triggers this
- Fix: Suggested fix
- Impact: What happens if triggered

Scan systematically and report all findings. If no issues found, state that explicitly.`
})
```

**For each scan:**
1. Load agent prompt template from `reference.md`
2. Customize for socket-btm context (focus on packages/node-smol-builder/, scripts/, patches/)
3. Spawn agent with Task tool using "general-purpose" subagent_type
4. Capture findings from agent response
5. Parse and categorize results

**Execution Order:** Run scans sequentially in priority order:
- critical (highest priority)
- logic
- cache
- workflow (lowest priority)

**Agent Prompt Sources:**
- Critical scan: reference.md starting at line ~12
- Logic scan: reference.md starting at line ~100
- Cache scan: reference.md starting at line ~200
- Workflow scan: reference.md starting at line ~300
- Security scan: reference.md starting at line ~400
- Documentation scan: reference.md starting at line ~810

<validation>
For each scan completion:
- Verify agent completed without errors
- Extract findings from agent output
- Parse into structured format (file, issue, severity, fix)
- Track scan coverage (files analyzed)
</validation>

---

### Phase 4: Aggregate Findings

<action>
Collect all findings from agents and aggregate:
</action>

```typescript
interface Finding {
  file: string           // "packages/node-smol-builder/src/patcher.mts:89"
  issue: string          // "Potential null pointer access"
  severity: "Critical" | "High" | "Medium" | "Low"
  scanType: string       // "critical"
  pattern: string        // Code snippet showing the issue
  trigger: string        // What causes this issue
  fix: string            // Suggested code change
  impact: string         // What happens if triggered
}
```

**Deduplication:**
- Remove duplicate findings across scans (same file:line, same issue)
- Keep the finding from the highest priority scan
- Track which scans found the same issue

**Prioritization:**
- Sort by severity: Critical → High → Medium → Low
- Within same severity, sort by scanType priority
- Within same severity+scanType, sort alphabetically by file path

<validation>
**Checkpoint:** Verify aggregation:
- Total findings count
- Breakdown by severity (N critical, N high, N medium, N low)
- Breakdown by scan type
- Duplicate removal count (if any)
</validation>

---

### Phase 5: Generate Report

<action>
Create structured quality report with all findings:
</action>

```markdown
# Quality Scan Report

**Date:** YYYY-MM-DD
**Repository:** socket-btm
**Scans:** [list of scan types run]
**Files Scanned:** N
**Findings:** N critical, N high, N medium, N low

## Critical Issues (Priority 1) - N found

### packages/node-smol-builder/src/patcher.mts:89
- **Issue**: Potential null pointer access when applying patches
- **Pattern**: `const result = patches[index].apply()`
- **Trigger**: When patch array has fewer elements than expected
- **Fix**: `const patch = patches[index]; if (!patch) throw new Error('Patch not found'); const result = patch.apply()`
- **Impact**: Crashes patch application process, build fails
- **Scan**: critical

## High Issues (Priority 2) - N found

[Similar format for high severity issues]

## Medium Issues (Priority 3) - N found

[Similar format for medium severity issues]

## Low Issues (Priority 4) - N found

[Similar format for low severity issues]

## Scan Coverage

- **Critical scan**: N files analyzed in packages/node-smol-builder/, scripts/
- **Logic scan**: N files analyzed (patch logic, build scripts)
- **Cache scan**: N files analyzed (if applicable)
- **Workflow scan**: N files analyzed (package.json, scripts/, .github/)

## Recommendations

1. Address N critical issues immediately before next release
2. Review N high-severity logic errors in patch application
3. Schedule N medium issues for next sprint
4. Low-priority items can be addressed during refactoring

## No Findings

[If a scan found no issues, list it here:]
- Critical scan: ✓ Clean
- Logic scan: ✓ Clean
```

**Output Report:**
1. Display report to console (user sees it)
2. Offer to save to file (optional): `reports/quality-scan-YYYY-MM-DD.md`

<validation>
**Report Quality Checks:**
- All findings include file:line references
- All findings include suggested fixes
- Findings are grouped by severity
- Scan coverage statistics included
- Recommendations are actionable
</validation>

---

### Phase 6: Complete

<completion_signal>
```xml
<promise>QUALITY_SCAN_COMPLETE</promise>
```
</completion_signal>

<summary>
Report these final metrics to the user:

**Quality Scan Complete**
========================
✓ Scans completed: [list of scan types]
✓ Total findings: N (N critical, N high, N medium, N low)
✓ Files scanned: N
✓ Report generated: Yes
✓ Scan duration: [calculated from start to end]

**Critical Issues Requiring Immediate Attention:**
- N critical issues found
- Review report above for details and fixes

**Next Steps:**
1. Address critical issues immediately
2. Review high-severity findings
3. Schedule medium/low issues appropriately
4. Re-run scans after fixes to verify

All findings include file:line references and suggested fixes.
</summary>

</instructions>

## Success Criteria

- ✅ `<promise>QUALITY_SCAN_COMPLETE</promise>` output
- ✅ All enabled scans completed without errors
- ✅ Findings prioritized by severity (Critical → Low)
- ✅ All findings include file:line references
- ✅ Actionable suggestions provided for all findings
- ✅ Report generated with statistics and coverage metrics
- ✅ Duplicate findings removed

## Scan Types

See `reference.md` for detailed agent prompts with structured tags:

- **critical-scan** - Null access, promise rejections, race conditions, resource leaks
- **logic-scan** - Off-by-one errors, type guards, edge cases, algorithm correctness
- **cache-scan** - Invalidation, key generation, memory management, concurrency
- **workflow-scan** - Scripts, package.json, git hooks, CI configuration
- **security-scan** - GitHub Actions workflow security (runs zizmor scanner)
- **documentation-scan** - README accuracy, outdated examples, incorrect package names, missing documentation

All agent prompts follow Claude best practices with <context>, <instructions>, <pattern>, <output_format>, and <quality_guidelines> tags.

## Commands

This skill is self-contained. No external commands needed.

## Context

This skill provides systematic code quality analysis for socket-btm by:
- Spawning specialized agents for targeted analysis
- Using Task tool to run agents autonomously
- Embedding agent prompts in reference.md following best practices
- Generating prioritized, actionable reports
- Supporting partial scans (user can select specific scan types)

For detailed agent prompts with best practices structure, see `reference.md`.
