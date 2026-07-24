# scanning-quality Reference Documentation

Detailed guidance for the `scanning-quality` skill. SKILL.md covers the phased workflow; this file covers the per-scan agent prompts, severity rules, and report templates.

## Table of contents

1. [Core principles](#core-principles)
2. [Agent prompts](#agent-prompts)
3. [Severity levels](#severity-levels)
4. [Scan priority order](#scan-priority-order)
5. [Report template](#report-template)
6. [Edge cases](#edge-cases)
7. [Completion summary](#completion-summary)

---

<a id="core-principles"></a>

## Core principles

### KISS

Prioritize simplicity. The simpler the code, the fewer bugs.

Common violations to flag:

- **Over-abstraction**: helpers / utilities / wrappers introduced for one-time operations.
- **Premature optimization**: complex caching, memoization, or perf tricks before profiling.
- **Unnecessary indirection**: multiple layers of function calls when direct code would be clearer.
- **Reconstruction**: rebuilding paths or values manually instead of using a function's return value.
- **Feature creep**: "nice to have" features that complicate the core logic.

If a function returns what you need, use it. Don't reconstruct or assume.

---

<a id="agent-prompts"></a>

## Agent prompts

Each scan spawns a general-purpose subagent. Customize the templates below per repo: read CLAUDE.md, `package.json`, and the source layout to ground the prompt in this codebase's conventions.

### Critical scan agent

**Mission**: identify bugs that could cause crashes, data corruption, or security vulnerabilities.

**Scan targets**: source files in the project's main source directory (read `package.json` and CLAUDE.md to learn the layout).

**Prompt template:**

```
Your task is to perform a critical-bug scan on the codebase. Identify bugs that could cause crashes, data corruption, or security vulnerabilities.

<context>
Adapt this context to the repository being scanned. Read CLAUDE.md and package.json first to learn the project's source layout, language, and conventions.

Common characteristics to look for:
- TypeScript / JavaScript files (.ts, .mts, .mjs, .js)
- Async operations and promise handling
- External API integrations
- File system operations
- Cross-platform compatibility requirements
- Error handling patterns
- Resource management (connections, file handles, timers)
</context>

<instructions>
Scan source files for these critical-bug patterns:

<pattern name="null_undefined_access">
- Property access without optional chaining when value might be null/undefined
- Array access without length validation
- JSON.parse without try-catch
- Object destructuring without null checks
</pattern>

<pattern name="unhandled_promises">
- Async function calls without await or .catch()
- Promise.then() chains without .catch() handlers
- Fire-and-forget promises that could reject
- Missing error handling in async/await blocks
</pattern>

<pattern name="race_conditions">
- Concurrent file system operations without coordination
- Parallel cache reads/writes without synchronization
- Check-then-act patterns without atomic operations
- Shared state modifications in Promise.all()
</pattern>

<pattern name="type_coercion">
- Equality comparisons using == instead of ===
- Implicit type conversions that could fail silently
- Truthy/falsy checks where explicit null/undefined checks needed
- typeof checks that miss edge cases (typeof null === 'object')
</pattern>

<pattern name="resource_leaks">
- File handles opened but not closed
- Timers created but not cleared (setTimeout/setInterval)
- Event listeners added but not removed
- Memory accumulation in long-running processes
</pattern>

<pattern name="prototype_pollution">
- Object literals used for config / return / internal-state without { __proto__: null, ... }
- Untrusted keys merged into a plain object
- JSON.parse output used as a config dictionary without sanitization
</pattern>

For each bug, think through:
1. Can this actually crash in production?
2. What input would trigger it?
3. Are there existing safeguards I'm missing?
</instructions>

<output_format>
For each finding, report:

File: path/to/file:lineNumber
Issue: [One-line description]
Severity: Critical
Pattern: [Problematic code snippet]
Trigger: [What input/condition causes the bug]
Fix: [Specific code change]
Impact: [What happens if triggered]
</output_format>

<quality_guidelines>
- Only report actual bugs, not style issues.
- Verify bugs are not already handled by surrounding code.
- Skip false positives where type guards already narrow the type.
- Apply the project's CLAUDE.md style rules when judging severity.
</quality_guidelines>

Scan systematically and report all critical bugs found. If no critical bugs are found, state that explicitly.
```

---

### Logic scan agent

**Mission**: detect logic errors that produce incorrect output.

**Scan targets**: source code files.

**Prompt template:**

```
Your task is to detect logic errors in the codebase that could produce incorrect output. Focus on algorithm correctness, edge case handling, and data validation.

<context>
Adapt to the project being scanned. Read CLAUDE.md and package.json to learn the layout.

Common areas:
- Algorithm correctness
- Data parsing and transformation
- Input validation and sanitization
- Edge case handling
- Cross-platform compatibility
- Business logic
</context>

<instructions>
Analyze code for these logic-error patterns:

<pattern name="off_by_one">
- Loop bounds: `i <= arr.length` should be `i < arr.length`
- Slice operations: `arr.slice(0, len-1)` when full array needed
- String indexing missing first/last character
- lastIndexOf checks that miss position 0
</pattern>

<pattern name="type_guards">
- `if (obj)` allows 0, '', false — use `obj != null` or explicit checks
- `if (arr.length)` crashes if arr is undefined — check existence first
- `typeof x === 'object'` true for null and arrays — use Array.isArray() or null check
- Missing validation before destructuring or property access
</pattern>

<pattern name="edge_cases">
- `str.split('.')[0]` when delimiter might not exist
- `parseInt(str)` without NaN validation
- Empty strings, empty arrays, single-element arrays
- Malformed input handling (missing try-catch, no fallback)
</pattern>

<pattern name="algorithm_correctness">
- Parsing: header/format validation, delimiter handling errors
- Version comparison: failing on semver edge cases (prerelease, build metadata)
- Path resolution: symlink handling, relative vs absolute path logic
- Deduplication: missing dedup of duplicate items
</pattern>

Before reporting, think through:
1. Does this logic error produce incorrect output?
2. What specific input would trigger it?
3. Is the error already handled elsewhere?
</instructions>

<output_format>
For each finding, report:

File: path/to/file:lineNumber
Issue: [One-line description]
Severity: High | Medium
Edge Case: [Specific input that triggers]
Pattern: [Problematic code snippet]
Fix: [Corrected code]
Impact: [What incorrect output is produced]
</output_format>

<quality_guidelines>
- Prioritize code handling external data (user input, file parsing, API responses).
- Focus on correctness and data integrity.
- Verify logic errors aren't false alarms due to type narrowing.
</quality_guidelines>

Analyze systematically and report all logic errors found. If no errors are found, state that explicitly.
```

---

### Cache scan agent

**Mission**: identify caching bugs that cause stale data, cache corruption, or incorrect behavior.

**Scan targets**: caching logic, if any. Skip the scan if the repo has no caching.

**Prompt template:**

```
Your task is to analyze caching implementation for correctness, staleness bugs, and performance issues. Focus on cache corruption, invalidation failures, and race conditions.

<context>
Adapt to the project being scanned. Identify which modules implement caching (e.g. file caches, response caches, memoization). If the repo has no caching, the scan emits "no findings — no caching present."
</context>

<instructions>
Analyze caching for these issue categories:

<pattern name="cache_invalidation">
- Source-version drift: is the source version included in the cache key?
- Config drift: are build flags or feature flags in the cache key?
- Cross-platform: are platform/arch isolated in the key when relevant?
- Validation: is the cached payload validated before restoration?
- Race: cached entry modified/deleted between validation and use?
</pattern>

<pattern name="cache_keys">
- Hash collisions: is the hash function sufficient?
- Ordering: does the key depend on application order when it shouldn't?
- Platform isolation: are platform-specific entries kept separate?
- Environment: are env vars affecting output included in the key?
</pattern>

<pattern name="cache_corruption">
- Partial writes: archive creation interrupted, incomplete file
- Disk full: file truncated due to disk space
- Extraction failures: corrupted archive partially extracted
- Overwrite races: concurrent processes overwriting same entry
- Cleanup races: entry deleted while being read
</pattern>

<pattern name="concurrency">
- Creation races: multiple workers creating same entry
- Restoration races: entry deleted/modified during restoration
- Validation races: entry validated then corrupted before use
- Lock files: missing locks allowing concurrent access
</pattern>

<pattern name="edge_cases">
- Empty files (zero bytes) — cached correctly?
- File deletion while cached — stale entry persists?
- Rapid successive reads/writes (stress)
- Very large files exceeding maxEntrySize
- Permission changes during caching
</pattern>

Think through each issue:
1. Can this actually happen in production?
2. What observable behavior results?
3. How likely/severe is the impact?
</instructions>

<output_format>
For each finding, report:

File: path/to/cache-module:lineNumber
Issue: [One-line description]
Severity: High | Medium
Scenario: [Step-by-step sequence showing how the bug manifests]
Pattern: [Problematic code snippet]
Fix: [Specific code change]
Impact: [Observable effect]
</output_format>

<quality_guidelines>
- Focus on correctness issues that produce wrong output or corrupted entries.
- Consider cross-platform differences.
- Verify issues aren't prevented by existing cache key generation.
</quality_guidelines>

Analyze the caching implementation thoroughly and report all issues found. If the implementation is sound, state that explicitly.
```

---

### Workflow scan agent

**Mission**: detect problems in build scripts, CI configuration, git hooks, and developer workflows.

**Scan targets**: `scripts/`, `package.json`, `.git-hooks/`, `.github/workflows/`.

**Prompt template:**

```
Your task is to identify issues in the project's development workflows, build scripts, and CI configuration that could cause build failures, test flakiness, or poor developer experience.

<context>
Adapt to the project being scanned. Read CLAUDE.md and package.json to learn the project's scripts, hook setup, and CI matrix. Apply CLAUDE.md conventions (no `npx`/`pnpm dlx`, scripts named `pnpm run foo --flag` not `foo:bar`, etc.) when grading findings.
</context>

<instructions>
Analyze workflow files for these categories:

<pattern name="scripts_cross_platform">
- Path separators: hardcoded / or \ instead of path.join()
- Shell commands: platform-specific (rm vs del, cp vs copy)
- Line endings: \n vs \r\n in text processing
- Case sensitivity differences (Windows vs Linux)
- Environment variable syntax (%VAR% vs $VAR)
</pattern>

<pattern name="scripts_errors">
- Missing try-catch on async operations
- Exit codes: non-zero on failure for CI detection
- Error messages: helpful for debugging?
- Dependency checks: do scripts check for required tools?

Note on file existence: `existsSync` is preferred over async `fs.access` in most projects. Check the project's CLAUDE.md before flagging existsSync as an issue.
</pattern>

<pattern name="import_conventions">
Apply the project's import rules from CLAUDE.md. Common categories worth checking:
- Cherry-picking vs default-importing built-ins
- Whether bare `child_process` is allowed or a library wrapper is preferred
- `node:` prefix for built-ins

Read the project's CLAUDE.md to learn its specific rules; flag deviations.
</pattern>

<pattern name="package_json_scripts">
- Script chaining: `&&` (fail fast) not `;` (continue on error) when errors matter
- Platform-specific commands that don't work cross-platform
- Convention compliance: match the project's CLAUDE.md
- Standard scripts (build, test, lint) documented?
</pattern>

<pattern name="git_hooks">
- Pre-commit: runs linting/formatting? Fast (<10s)?
- Pre-push: runs tests to prevent broken pushes?
- Hook failures: clearly explained?
- Hook installation: documented?
</pattern>

<pattern name="ci_configuration">
- Build order correct (install → build → test)?
- Cross-platform matrix (Windows/macOS/Linux)?
- Build artifacts uploaded?
- Failure notifications visible?
- Dependency caching working?
- Action versions pinned to SHAs (not tags)?
</pattern>

<pattern name="dlx_anti_pattern">
Flag any `npx`, `pnpm dlx`, or `yarn dlx` usage in scripts, hooks, package.json, or CI YAML. Use `pnpm exec <pkg>` or `pnpm run <script>` instead.
</pattern>

For each issue, consider:
1. Does this actually affect developers or CI?
2. How often would this be encountered?
3. Is there a simple fix?
</instructions>

<output_format>
For each finding, report:

File: [scripts/foo.mjs:line OR package.json:scripts.build OR .github/workflows/ci.yml:line]
Issue: [One-line description]
Severity: Medium | Low
Impact: [How this affects developers or CI]
Pattern: [Problematic code or configuration]
Fix: [Specific change to resolve]
</output_format>

<quality_guidelines>
- Focus on issues that cause actual build/test failures.
- Consider cross-platform scenarios.
- Verify conventions match CLAUDE.md.
- Prioritize developer experience issues.
</quality_guidelines>

Analyze workflow files systematically and report all issues found. If workflows are well-configured, state that explicitly.
```

---

### Security scan agent (workflows)

**Mission**: scan GitHub Actions workflows for security vulnerabilities using zizmor.

**Scan targets**: `.github/workflows/*.yml`.

**Prompt template:**

```
Your task is to run zizmor on GitHub Actions workflows to identify template injection, cache poisoning, and other workflow security issues.

<context>
Zizmor is a GitHub Actions security scanner. See `_shared/security-tools.md` for installation. If not installed locally, skip with a warning.
</context>

<instructions>
1. Run `zizmor .github/workflows/`
2. Parse the output and identify all findings:
   - Severity (info, low, medium, high, error)
   - Vulnerability type (template-injection, cache-poisoning, unpinned-action, etc.)
   - File and line numbers
   - Audit confidence
   - Whether auto-fix is available
3. Report each finding with file:line, severity, description, security impact, suggested fix.
4. If zizmor reports no findings: state explicitly "No security issues found in GitHub Actions workflows."
5. Note any suppressed findings.
</instructions>

<pattern name="template_injection">
- Code injection via template expansion in `run:` blocks
- Unsanitized `${{ }}` syntax in dangerous contexts
- User-controlled input used in shell commands
</pattern>

<pattern name="cache_poisoning">
- Caching enabled when publishing artifacts
- Vulnerable to cache-poisoning in release workflows
</pattern>

<pattern name="credential_exposure">
- Secrets logged to console
- Credentials passed insecurely
</pattern>

<output_format>
For each finding:

File: .github/workflows/<name>.yml:line
Issue: [Description]
Severity: [zizmor severity]
Pattern: [Problematic snippet]
Trigger: [Untrusted input source]
Fix: [Specific fix recipe]
Impact: [Security impact]
Auto-fix: [Available / Not available]
</output_format>

<quality_guidelines>
- Only report actual zizmor findings.
- Note audit confidence level for each finding.
- Indicate auto-fix availability.
- Report suppressed findings separately.
</quality_guidelines>
```

For a deeper workflow security pass (AgentShield + zizmor + grading), invoke the dedicated `scanning-security` skill instead of running this scan in isolation.

---

### Documentation scan agent

**Mission**: verify documentation accuracy by checking READMEs, code comments, and examples against the actual code.

**Scan targets**: `README.md`, files under `docs/`, CLAUDE.md.

**Prompt template:**

```
Your task is to verify documentation accuracy by comparing documented behavior, examples, commands, and API descriptions against the actual codebase.

<context>
Documentation accuracy matters for:
- Developer onboarding
- Preventing confusion from outdated examples
- Reducing support burden

Common issues:
- Package names mismatching package.json
- Command examples with wrong flags
- API documentation showing methods that don't exist
- File paths that are incorrect or outdated
- Build outputs documented in wrong locations
- Config examples using deprecated formats
- Missing documentation for new features
- Examples that would fail if run as-is
</context>

<instructions>
1. Find documentation: README.md, docs/**/*.md, CLAUDE.md
2. For each file, verify:
   - Package names match package.json
   - Command examples use correct flags
   - File paths match actual structure
   - Build output paths match actual outputs
   - API examples match actual exports
   - Configuration examples match the actual schema
3. Pattern categories to check:

<pattern name="package_names">
- README showing wrong scope
- Installation instructions with wrong package name
- Import examples using wrong name
</pattern>

<pattern name="command_examples">
- Commands with flags that don't exist
- Missing required flags in examples
- Deprecated flags still documented
- Examples that would error if run as-is
</pattern>

<pattern name="file_paths">
- Documented paths that don't exist
- Output paths that don't match build script outputs
- Config file locations that are incorrect
</pattern>

<pattern name="api_documentation">
- Functions documented that don't exist in exports
- Parameter types that don't match implementation
- Return types incorrectly documented
- Examples using deprecated APIs
</pattern>

<pattern name="configuration">
- Config examples using wrong keys or structure
- Documented options that aren't validated in code
- Wrong default values documented
</pattern>

<pattern name="version_information">
- Outdated version numbers in examples
- Tool version requirements that are incorrect

Caveat for third-party library versions: don't blindly "correct" without verification. If unsure, skip and ask the user.
</pattern>

<pattern name="missing_documentation">
- Public APIs / exports not documented
- Important environment variables not documented
- New features added but not documented
</pattern>

For each issue:
1. Read the documented information
2. Read the actual code/config to verify
3. Determine the discrepancy
4. Provide the correct information
</instructions>

<output_format>
For each finding:

File: path/to/README.md:line
Issue: [One-line description]
Severity: High/Medium/Low
Pattern: [Incorrect documentation text]
Actual: [What the correct information is]
Fix: [Exact correction needed]
Impact: [Why this matters]
</output_format>

<quality_guidelines>
- Verify every claim against actual code.
- Read package.json to check names, scripts, versions.
- Check exports in source files.
- Focus on high-impact errors first.
- Provide exact fixes, not vague suggestions.
</quality_guidelines>
```

---

<a id="severity-levels"></a>

## Severity levels

| Level        | Description                                        | Action required     |
| ------------ | -------------------------------------------------- | ------------------- |
| **Critical** | Crashes, security vulnerabilities, data corruption | Fix immediately     |
| **High**     | Logic errors, incorrect output, resource leaks     | Fix before release  |
| **Medium**   | Performance issues, edge case bugs                 | Fix in next sprint  |
| **Low**      | Code smells, minor inconsistencies                 | Fix when convenient |

---

<a id="scan-priority-order"></a>

## Scan priority order

1. **critical** — most important, run first
2. **logic** — correctness
3. **cache** — staleness / correctness (skip if no caching)
4. **workflow** — developer experience
5. **security** — workflow-level security
6. **documentation** — accuracy

---

<a id="report-template"></a>

## Report template

Use this format for the Phase 8 report:

```markdown
# Quality Scan Report

**Date:** YYYY-MM-DD
**Repository:** [name]
**Scans:** [list of scan types run]
**Files Scanned:** N
**Findings:** N critical, N high, N medium, N low

## Dependency Updates

**Status:** N packages updated
**Result:** Success/Failed

## Structural Validation

**Check script results:**

- Errors: N (reported as Critical below)
- Warnings: N (reported as Low below)

## Critical Issues (Priority 1) - N found

### path/to/file:lineNumber

- **Issue**: [Description]
- **Pattern**: [Problematic code]
- **Trigger**: [What triggers this]
- **Fix**: [Suggested fix]
- **Impact**: [Impact description]
- **Scan**: critical

## High Issues (Priority 2) - N found

[Same format]

## Medium Issues (Priority 3) - N found

[Same format]

## Low Issues (Priority 4) - N found

[Same format]

## Scan Coverage

- **Dependency updates**: N packages
- **Structural validation**: N patterns checked
- **Critical scan**: N files analyzed
- **Logic scan**: N files analyzed
- **Cache scan**: N files analyzed (if applicable)
- **Workflow scan**: N files analyzed
- **Security scan**: N workflow files analyzed
- **Documentation scan**: N doc files analyzed

## Recommendations

1. Address N critical issues immediately before next release
2. Review N high-severity issues
3. Schedule N medium issues for next sprint
4. Low-priority items can be addressed during refactoring
```

---

<a id="edge-cases"></a>

## Edge cases

### No findings

```markdown
# Quality Scan Report

**Result**: No issues found

All scans completed successfully with no findings.

- Critical scan: Clean
- Logic scan: Clean
- Cache scan: Clean (or skipped — no caching)
- Workflow scan: Clean
- Security scan: Clean
- Documentation scan: Clean
```

### Scan failures

```markdown
## Scan errors

- **critical scan**: Failed (agent timeout)
  - Retry recommended
  - Check agent prompt size

- **logic scan**: Completed
- **cache scan**: Completed
```

### Partial scans

The user can request specific scan types. Report only includes requested scan types and notes which were skipped.

---

<a id="completion-summary"></a>

## Completion summary

Report these final metrics when Phase 9 completes:

```
Quality Scan Complete
========================
- Dependency updates: N packages updated
- Structural validation: N errors, N warnings
- Repository cleanup: N junk files removed
- Scans completed: [list]
- Total findings: N (N critical, N high, N medium, N low)
- Files scanned: N
- Scan duration: [calculated]

Critical Issues Requiring Immediate Attention:
- N critical issues found
- Review report above for details and fixes

Next Steps:
1. Address critical issues immediately
2. Review high-severity findings
3. Schedule medium/low issues appropriately
4. Re-run scans after fixes to verify
```
