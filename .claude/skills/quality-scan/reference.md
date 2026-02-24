# quality-scan Reference Documentation

## Agent Prompts

### Critical Scan Agent

**Mission**: Identify critical bugs that could cause crashes, data corruption, or security vulnerabilities.

**Scan Targets**: All `.mts` files in `packages/cli/src/`

**Prompt Template:**
```
Your task is to perform a critical bug scan on socket-cli, Socket Security's CLI tool written in TypeScript (.mts extension). Identify bugs that could cause crashes, data corruption, or security vulnerabilities.

<context>
This is Socket Security's CLI tool:
- **@socketsecurity/cli**: Main CLI package in `packages/cli/`
- TypeScript codebase with .mts extensions
- Commands for security scanning, package analysis, npm wrapping
- Integrates with Socket API for vulnerability data
- Wraps npm/npx/pnpm/yarn with security checks
- VFS extraction for external tools (cdxgen, coana, synp, socket-patch)
- Handles GitHub integration, pull requests, CI workflows
- React/Ink for terminal UI components
- Recently updated VFS extraction to use process.smol.mount()

Key characteristics:
- Uses meow for CLI parsing
- Extensive test coverage with Vitest
- Socket API integration for security data
- GitHub API integration for PR/issue management
- File system operations for npm package analysis
- Telemetry with Sentry (optional build variant)
</context>

<instructions>
Scan code files in packages/cli/src/ for these critical bug patterns:

<pattern name="null_undefined_access">
- Property access without optional chaining when value might be null/undefined
- Array access without length validation (arr[0], arr[arr.length-1])
- JSON.parse() without try-catch
- Object destructuring without null checks
- Socket API responses assumed to have data without null checks
</pattern>

<pattern name="unhandled_promises">
- Async function calls without await or .catch()
- Promise.then() chains without .catch() handlers
- Fire-and-forget promises that could reject
- Missing error handling in async/await blocks
- GitHub API calls without error handling
- Socket API calls without error handling
</pattern>

<pattern name="race_conditions">
- Concurrent file system operations without coordination
- Check-then-act patterns without atomic operations
- Shared state modifications in Promise.all()
- VFS extraction race conditions
- Cache access without synchronization
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
- React/Ink component unmount issues
- Process spawning without cleanup
</pattern>

<pattern name="buffer_overflow">
- String slicing without bounds validation
- Array indexing beyond length
- Buffer operations without size checks
</pattern>

<quality_guidelines>
For each potential issue found, use explicit chain-of-thought reasoning with `<thinking>` tags:

<thinking>
1. Can this actually crash/fail in production?
   - Code path analysis: [describe the execution flow]
   - Production scenarios: [real-world conditions]
   - Result: [yes/no with justification]

2. What input would trigger this issue?
   - Trigger conditions: [specific inputs/states]
   - Edge cases: [boundary conditions]
   - Likelihood: [HIGH/MEDIUM/LOW]

3. Are there existing safeguards I'm missing?
   - Defensive code: [try-catch, validation, guards]
   - Framework protections: [built-in safety]
   - Result: [SAFEGUARDED/VULNERABLE]

Overall assessment: [REPORT/SKIP]
Decision: [If REPORT, include in findings. If SKIP, explain why it's a false positive]
</thinking>

Only report issues that pass all three checks. Use `<thinking>` tags to show your reasoning explicitly.
</quality_guidelines>
</instructions>

<output_format>
For each finding, report:

File: packages/cli/src/path/to/file.mts:lineNumber
Issue: [One-line description of the bug]
Severity: Critical
Pattern: [The problematic code snippet]
Trigger: [What input/condition causes the bug]
Fix: [Specific code change to fix it]
Impact: [What happens if this bug is triggered]

Example:
File: packages/cli/src/commands/scan/fetch-scan.mts:145
Issue: Unhandled promise rejection in Socket API call
Severity: Critical
Pattern: `fetchScanData(scanId)`
Trigger: When Socket API returns 500 error or network timeout
Fix: `await fetchScanData(scanId).catch(err => { logger.error(err); throw new InputError(\`Failed to fetch scan: \${err.message}\`) })`
Impact: Uncaught exception crashes CLI process, leaving user without error message

Example:
File: packages/cli/src/utils/dlx/vfs-extract.mts:234
Issue: Potential null pointer access when extracting VFS tools
Severity: Critical
Pattern: `const packageDir = process.smol.mount(vfsPath); const toolPath = path.join(packageDir, 'bin/tool')`
Trigger: When process.smol.mount() returns undefined (not in SEA mode)
Fix: `if (!processWithSmol.smol?.mount) throw new Error('VFS mount not available'); const packageDir = processWithSmol.smol.mount(vfsPath); if (!packageDir) throw new Error('Failed to mount VFS path');`
Impact: TypeError crashes CLI when running outside SEA binary
</output_format>

<quality_guidelines>
- Only report actual bugs, not style issues or minor improvements
- Verify bugs are not already handled by surrounding code
- Prioritize bugs affecting CLI reliability and user data integrity
- Focus on promise handling, type guards, external API validation
- Skip false positives (TypeScript type guards are sufficient in many cases)
- Pay special attention to Socket API and GitHub API error handling
- VFS extraction code is recently updated - check process.smol.mount() usage
</quality_guidelines>

Scan systematically through packages/cli/src/ and report all critical bugs found. If no critical bugs are found, state that explicitly with "✓ No critical issues found".
```

---

### Logic Scan Agent

**Mission**: Detect logical errors in CLI commands, parsers, and data processing that could produce incorrect output or unexpected behavior.

**Scan Targets**: packages/cli/src/

**Prompt Template:**
```
Your task is to detect logic errors in socket-cli's command handling, data parsing, and API integration that could produce incorrect output or unexpected behavior.

<context>
socket-cli is Socket Security's CLI tool:
- **Commands**: scan, npm, npx, pnpm, yarn, optimize, fix, wrapper, package, organization, repository
- **Parsers**: Package manifests (package.json, package-lock.json, pnpm-lock.yaml, yarn.lock)
- **API Integration**: Socket API for security data, GitHub API for PR/issue management
- **Data Processing**: SBOM generation, dependency analysis, vulnerability scoring
- **Output Formats**: Terminal (React/Ink), JSON, Markdown

Critical operations:
- Package manifest parsing and validation
- Dependency resolution and analysis
- Security score calculation
- GitHub PR creation and management
- Socket registry override application
- VFS tool extraction and execution
</context>

<instructions>
Analyze packages/cli/src/ for these logic error patterns:

<pattern name="off_by_one">
Off-by-one errors in loops and slicing:
- Loop bounds: `i <= arr.length` should be `i < arr.length`
- Slice operations: `arr.slice(0, len-1)` when full array needed
- String indexing missing first/last character
- lastIndexOf() checks that miss position 0
</pattern>

<pattern name="type_guards">
Insufficient type validation:
- `if (obj)` allows 0, "", false - use `obj != null` or explicit checks
- `if (arr.length)` crashes if arr is undefined - check existence first
- `typeof x === 'object'` true for null and arrays - use Array.isArray() or null check
- Missing validation before destructuring or property access
- Socket API responses assumed to match TypeScript types without runtime validation
</pattern>

<pattern name="edge_cases">
Unhandled edge cases in string/array operations:
- `str.split('.')[0]` when delimiter might not exist
- `parseInt(str)` without NaN validation
- `lastIndexOf('@')` returns -1 if not found, === 0 is valid (e.g., '@package')
- Empty strings, empty arrays, single-element arrays
- Malformed input handling (missing try-catch, no fallback)
</pattern>

<pattern name="algorithm_correctness">
Algorithm implementation issues:
- Dependency resolution: Missing transitive dependencies
- Version comparison: Failing on semver edge cases (prerelease, build metadata)
- Path resolution: Symlink handling, relative vs absolute path logic
- Deduplication: Missing deduplication of duplicate packages/dependencies
- Score calculation: Incorrect weighting or aggregation
</pattern>

<pattern name="api_integration">
Socket API and GitHub API integration errors:
- Pagination: Not handling paginated responses correctly
- Rate limiting: Not respecting rate limit headers
- Error codes: Not handling all error response codes
- Data transformation: Incorrect mapping between API response and CLI data model
- Authentication: Token validation missing or incorrect
</pattern>

<pattern name="cli_parsing">
CLI argument parsing errors:
- Flag validation: Accepting invalid flag combinations
- Required flags: Not enforcing required flags
- Flag types: Not validating flag value types (number, boolean, string)
- Default values: Incorrect or missing defaults
- Help text: Mismatched help text and actual behavior
</pattern>

<quality_guidelines>
For each potential issue found, use explicit chain-of-thought reasoning with `<thinking>` tags:

<thinking>
1. Can this actually produce wrong output in production?
   - Code path analysis: [describe the execution flow]
   - Production scenarios: [real-world conditions]
   - Result: [yes/no with justification]

2. What input would trigger this issue?
   - Trigger conditions: [specific inputs/states]
   - Edge cases: [boundary conditions]
   - Likelihood: [HIGH/MEDIUM/LOW]

3. Are there existing safeguards I'm missing?
   - Defensive code: [try-catch, validation, guards]
   - Framework protections: [built-in safety]
   - Result: [SAFEGUARDED/VULNERABLE]

Overall assessment: [REPORT/SKIP]
Decision: [If REPORT, include in findings. If SKIP, explain why it's a false positive]
</thinking>

Only report issues that pass all three checks. Use `<thinking>` tags to show your reasoning explicitly.
</quality_guidelines>
</instructions>

<output_format>
For each finding, report:

File: packages/cli/src/path/to/file.mts:lineNumber
Issue: [One-line description]
Severity: High | Medium
Edge Case: [Specific input that triggers the error]
Pattern: [The problematic code snippet]
Fix: [Corrected code]
Impact: [What incorrect output is produced]

Example:
File: packages/cli/src/commands/package/handle-purl-score.mts:89
Issue: Off-by-one in vulnerability count aggregation
Severity: High
Edge Case: When package has exactly 1 vulnerability
Pattern: `for (let i = 0; i < vulns.length - 1; i++)`
Fix: `for (let i = 0; i < vulns.length; i++)`
Impact: Last vulnerability is silently omitted from score calculation, producing incorrect security score

Example:
File: packages/cli/src/utils/socket/api.mts:234
Issue: Incorrect pagination handling for Socket API
Severity: High
Edge Case: When response has more than 100 results requiring pagination
Pattern: `const results = await fetchData(url); return results;`
Fix: `const allResults = []; let nextUrl = url; while (nextUrl) { const { data, nextPage } = await fetchData(nextUrl); allResults.push(...data); nextUrl = nextPage; } return allResults;`
Impact: Only first page of results returned, missing packages/vulnerabilities in subsequent pages
</output_format>

<quality_guidelines>
- Prioritize code handling external data (Socket API, GitHub API, package manifests)
- Focus on errors affecting CLI correctness and data accuracy
- Verify logic errors aren't false alarms due to type narrowing
- Consider real-world edge cases: malformed manifests, API errors, rate limits
- Pay special attention to recently modified VFS extraction code
</quality_guidelines>

Analyze systematically across packages/cli/src/ and report all logic errors found. If no errors are found, state that explicitly with "✓ No logic errors found".
```

---

### Cache Scan Agent

**Mission**: Identify caching bugs that cause stale data, race conditions, or incorrect behavior.

**Scan Targets**: Caching logic in packages/cli/src/

**Prompt Template:**
```
Your task is to analyze socket-cli's caching implementation for correctness, staleness bugs, and race conditions.

<context>
socket-cli uses multiple caching layers:
- **GitHub cache**: Caches GitHub API responses (5-minute TTL) in ~/.socket/_github/
- **Update cache**: Caches npm registry version checks (24-hour TTL) in ~/.socket/_update/
- **Config cache**: In-memory cache for config file (validated by mtime)
- **VFS extraction cache**: Caches extracted tools in ~/.socket/_dlx/

Caching locations:
- packages/cli/src/utils/git/github.mts (GitHub API cache)
- packages/cli/src/utils/update/checker.mts (update check cache)
- packages/cli/src/utils/config.mts (config file cache)
- packages/cli/src/utils/dlx/vfs-extract.mts (VFS extraction cache)
</context>

<instructions>
Analyze caching implementation for these issue categories:

<pattern name="cache_invalidation">
Stale cache from incorrect invalidation:
- GitHub cache: Are API response etags/timestamps properly checked?
- Update cache: Is 24-hour TTL properly enforced?
- Config cache: Is file mtime properly validated?
- VFS cache: Is node-smol hash included in cache key?
- Restoration: Is cache validated before use (corrupted files)?
- Race: Cache modified/deleted between validation and use?
</pattern>

<pattern name="cache_keys">
Cache key generation correctness:
- GitHub cache: Are org slug and endpoint properly separated?
- Update cache: Is platform/arch included in cache key?
- VFS cache: Are tool name and platform properly isolated?
- Hash collisions: Is hash function sufficient?
- Environment: Are env vars affecting cache included in key?
</pattern>

<pattern name="cache_corruption">
Cache file corruption:
- Partial writes: JSON file creation interrupted, incomplete data
- Disk full: File truncated due to disk space issues
- Concurrent writes: Multiple processes writing same cache file
- Invalid JSON: Corrupted cache file not handled gracefully
</pattern>

<pattern name="concurrency">
Race conditions in cache operations:
- Creation races: Multiple processes creating same cache file simultaneously
- TOCTOU: Cache validated then corrupted before use
- In-flight deduplication: Multiple concurrent requests for same data
- Lock files: Missing lock files allowing concurrent cache access
</pattern>

<pattern name="stale_caches">
Scenarios producing stale/incorrect caches:
- GitHub data modified but cache not invalidated
- Update check showing old version (24-hour delay)
- Config file changed but in-memory cache not refreshed
- VFS tools updated but cache not invalidated
- Platform mismatch: Using wrong platform cache
</pattern>

<quality_guidelines>
For each potential issue found, use explicit chain-of-thought reasoning with `<thinking>` tags:

<thinking>
1. Can this actually cause stale data in production?
   - Code path analysis: [describe the execution flow]
   - Production scenarios: [real-world conditions]
   - Result: [yes/no with justification]

2. What input would trigger this issue?
   - Trigger conditions: [specific inputs/states]
   - Edge cases: [boundary conditions]
   - Likelihood: [HIGH/MEDIUM/LOW]

3. Are there existing safeguards I'm missing?
   - Defensive code: [try-catch, validation, guards]
   - Framework protections: [built-in safety]
   - Result: [SAFEGUARDED/VULNERABLE]

Overall assessment: [REPORT/SKIP]
Decision: [If REPORT, include in findings. If SKIP, explain why it's a false positive]
</thinking>

Only report issues that pass all three checks. Use `<thinking>` tags to show your reasoning explicitly.
</quality_guidelines>
</instructions>

<output_format>
For each finding, report:

File: packages/cli/src/utils/cache/file-cache.mts:lineNumber
Issue: [One-line description]
Severity: High | Medium
Scenario: [Step-by-step sequence showing how bug manifests]
Pattern: [The problematic code snippet]
Fix: [Specific code change]
Impact: [Observable effect - wrong output, performance, crash]

Example:
File: packages/cli/src/utils/update/checker.mts:145
Issue: Cache key missing platform, causing cross-platform cache pollution
Severity: High
Scenario: 1) Check for updates on macOS, caches "1.2.3". 2) Run on Linux, reads macOS cache. 3) Shows "1.2.3" even though Linux latest is "1.2.4"
Pattern: `const cacheKey = \`socket-cli-\${currentVersion}\``
Fix: `const cacheKey = \`socket-cli-\${currentVersion}-\${process.platform}-\${process.arch}\``
Impact: Cross-platform users see incorrect "no updates available" message

Example:
File: packages/cli/src/utils/git/github.mts:89
Issue: TOCTOU race between cache validation and read
Severity: Medium
Scenario: 1) Check cache exists and is fresh. 2) Cache deleted/corrupted. 3) Read cache, throws error
Pattern: `if (existsSync(cachePath) && isFresh(cachePath)) { return readCache(cachePath); }`
Fix: `try { const data = readCache(cachePath); if (isFresh(data.timestamp)) return data; } catch { /* cache miss */ }`
Impact: Rare race condition causes CLI to crash instead of gracefully fetching fresh data
</output_format>

<quality_guidelines>
- Focus on correctness issues that produce stale or wrong data
- Consider concurrent CLI invocations (multiple terminals)
- Evaluate cache invalidation scenarios (data changed, files updated)
- Prioritize issues causing silent incorrectness over performance
- Verify issues aren't prevented by existing cache key generation
- Known safe patterns: Config write batching with nextTick, GitHub cache TOCTOU double-check
</quality_guidelines>

Analyze the caching implementation thoroughly and report all issues found. If the implementation is sound, state that explicitly with "✓ No cache issues found".
```

---

### Workflow Scan Agent

**Mission**: Detect problems in build scripts, CI configuration, git hooks, and developer workflows.

**Scan Targets**: `scripts/`, `package.json`, `.husky/`, `.github/workflows/`

**Prompt Template:**
```
Your task is to identify issues in socket-cli's development workflows, build scripts, and CI configuration that could cause build failures, test flakiness, or poor developer experience.

<context>
socket-cli is a pnpm monorepo with:
- **Build scripts**: scripts/*.mjs (ESM, cross-platform Node.js)
- **Package manager**: pnpm workspaces with scripts in package.json
- **Git hooks**: .husky/* for pre-commit, commit-msg, pre-push validation
- **CI**: GitHub Actions (.github/workflows/)
- **Platforms**: Must work on Windows, macOS, Linux (ARM64, x64)
- **CLAUDE.md**: Defines conventions (no process.exit() in most code, no backward compat, etc.)

Packages:
- @socketsecurity/cli: Main CLI package in packages/cli/
- build-infra: Build utilities for SEA binary generation
- package-builder: Template-based package generation
</context>

<instructions>
Analyze workflow files for these issue categories:

<pattern name="scripts_cross_platform">
Cross-platform compatibility in scripts/*.mjs:
- Path separators: Hardcoded / or \ instead of path.join() or path.resolve()
- Shell commands: Platform-specific (e.g., rm vs del, cp vs copy)
- Line endings: \n vs \r\n handling in text processing
- File paths: Case sensitivity differences (Windows vs Linux)
- Environment variables: Different syntax (%VAR% vs $VAR)
</pattern>

<pattern name="scripts_errors">
Error handling in scripts:
- process.exit() usage: CLAUDE.md forbids this in most code - should throw errors instead
- Missing try-catch: Async operations without error handling
- Exit codes: Non-zero exit on failure for CI detection
- Error messages: Are they helpful for debugging?
- Dependency checks: Do scripts check for required tools before use?

**Note on file existence checks**: existsSync() is ACCEPTABLE and PREFERRED over async fs.access() for synchronous file checks.

**Exception**: Interactive test runner scripts/test.mjs intentionally uses process.exit() (documented exception).
</pattern>

<pattern name="package_json_scripts">
package.json script correctness:
- Script chaining: Use && (fail fast) not ; (continue on error) when errors matter
- Platform-specific: Commands that don't work cross-platform
- Convention compliance: Match patterns in CLAUDE.md
- Missing scripts: Standard scripts like build, test, lint documented?
- Test file paths: Using -- before paths runs ALL tests (incorrect)
</pattern>

<pattern name="git_hooks">
Git hooks configuration in .husky/:
- Pre-commit: Does it run linting/formatting? Is it fast (<10s)?
- Commit-msg: Does it strip AI attribution?
- Pre-push: Does it validate commits and secrets?
- False positives: Do hooks block legitimate commits?
- Error messages: Are hook failures clearly explained?
- Syntax: Are hooks compatible with all shells (bash, zsh, etc.)?
</pattern>

<pattern name="ci_configuration">
CI pipeline issues in .github/workflows/:
- Build order: Are steps in correct sequence (install → build → test)?
- Cross-platform: Are Windows/macOS/Linux builds all tested?
- SEA binary: Are standalone executable builds tested?
- Build artifacts: Are binaries uploaded for each platform?
- Failure notifications: Are build failures clearly visible?
- Security: Template injection vulnerabilities in workflows?
</pattern>

<pattern name="developer_experience">
Documentation and setup:
- Common errors: Are frequent issues documented with solutions?
- Environment variables: Are required env vars documented?
- Setup instructions: Are they accurate and complete?
</pattern>

<quality_guidelines>
For each potential issue found, use explicit chain-of-thought reasoning with `<thinking>` tags:

<thinking>
1. Can this actually cause build/test failures in production?
   - Code path analysis: [describe the execution flow]
   - Production scenarios: [real-world conditions]
   - Result: [yes/no with justification]

2. What input would trigger this issue?
   - Trigger conditions: [specific inputs/states]
   - Edge cases: [boundary conditions]
   - Likelihood: [HIGH/MEDIUM/LOW]

3. Are there existing safeguards I'm missing?
   - Defensive code: [try-catch, validation, guards]
   - Framework protections: [built-in safety]
   - Result: [SAFEGUARDED/VULNERABLE]

Overall assessment: [REPORT/SKIP]
Decision: [If REPORT, include in findings. If SKIP, explain why it's a false positive]
</thinking>

Only report issues that pass all three checks. Use `<thinking>` tags to show your reasoning explicitly.
</quality_guidelines>
</instructions>

<output_format>
For each finding, report:

File: [scripts/foo.mjs:line OR package.json:scripts.build OR .husky/pre-push:line]
Issue: [One-line description]
Severity: Medium | Low
Impact: [How this affects developers or CI]
Pattern: [The problematic code or configuration]
Fix: [Specific change to resolve]

Example:
File: scripts/build.mjs:23
Issue: Uses process.exit() violating CLAUDE.md convention
Severity: Medium
Impact: Cannot be tested properly, unconventional error handling
Pattern: `process.exit(1)`
Fix: `throw new Error('Build failed: ...')`

Example:
File: package.json:scripts.test
Issue: Script uses -- before file path, running ALL tests instead of specific file
Severity: Medium
Impact: "pnpm test:unit -- file.test.mts" runs entire test suite, not just one file
Pattern: `"test:unit": "vitest run -- "`
Fix: `"test:unit": "vitest run"` (no trailing -- needed)

Example:
File: .husky/pre-push:70
Issue: Process substitution syntax not compatible with all shells
Severity: Medium
Impact: Hook fails on some systems with "syntax error near unexpected token"
Pattern: `done < <(git rev-list "$range")`
Fix: `git rev-list "$range" | while read; do ... done`
</output_format>

<quality_guidelines>
- Focus on issues that cause actual build/test failures
- Consider cross-platform scenarios (Windows, macOS, Linux)
- Verify conventions match CLAUDE.md requirements
- Prioritize developer experience issues (confusing errors, missing docs)
- Note documented exceptions (test runner using process.exit)
</quality_guidelines>

Analyze workflow files systematically and report all issues found. If workflows are well-configured, state that explicitly with "✓ No workflow issues found".
```

---

### Security Scan Agent

**Mission**: Scan GitHub Actions workflows for security vulnerabilities using zizmor.

**Scan Targets**: All `.yml` files in `.github/workflows/`

**Prompt Template:**
```
Your task is to run the zizmor security scanner on GitHub Actions workflows to identify security vulnerabilities such as template injection, cache poisoning, and other workflow security issues.

<context>
Zizmor is a GitHub Actions workflow security scanner that detects:
- Template injection vulnerabilities (code injection via template expansion)
- Cache poisoning attacks (artifacts vulnerable to cache poisoning)
- Credential exposure in workflow logs
- Dangerous workflow patterns and misconfigurations
- OIDC token abuse risks
- Artipacked vulnerabilities

This repository uses GitHub Actions for CI/CD with workflows in `.github/workflows/`.

**Installation:**
Zizmor is not available via npm. Install zizmor v1.22.0 using one of these methods:

**GitHub Releases (Recommended):**
```bash
# Download from https://github.com/zizmorcore/zizmor/releases/tag/v1.22.0
# macOS ARM64:
curl -L https://github.com/zizmorcore/zizmor/releases/download/v1.22.0/zizmor-aarch64-apple-darwin -o /usr/local/bin/zizmor
chmod +x /usr/local/bin/zizmor

# macOS x64:
curl -L https://github.com/zizmorcore/zizmor/releases/download/v1.22.0/zizmor-x86_64-apple-darwin -o /usr/local/bin/zizmor
chmod +x /usr/local/bin/zizmor

# Linux x64:
curl -L https://github.com/zizmorcore/zizmor/releases/download/v1.22.0/zizmor-x86_64-unknown-linux-musl -o /usr/local/bin/zizmor
chmod +x /usr/local/bin/zizmor
```

**Alternative Methods:**
- Homebrew: `brew install zizmor@1.22.0`
- Cargo: `cargo install zizmor --version 1.22.0`
- See https://docs.zizmor.sh/installation/ for all options
</context>

<instructions>
1. Run zizmor on all GitHub Actions workflow files:
   ```bash
   zizmor .github/workflows/
   ```

2. Parse the zizmor output and identify all findings:
   - Extract severity level (info, low, medium, high, error)
   - Extract vulnerability type (template-injection, cache-poisoning, etc.)
   - Extract file path and line numbers
   - Extract audit confidence level
   - Note if auto-fix is available

3. For each finding, report:
   - File and line number
   - Vulnerability type and severity
   - Description of the security issue
   - Why it's a problem (security impact)
   - Suggested fix (use zizmor's suggestions if available)
   - Whether auto-fix is available (`zizmor --fix`)

4. If zizmor reports no findings, state explicitly: "✓ No security issues found in GitHub Actions workflows"

5. Note any suppressed findings (shown by zizmor but marked as suppressed)
</instructions>

<pattern name="template_injection">
Look for findings like:
- `info[template-injection]` or `error[template-injection]`
- Code injection via template expansion in run blocks
- Unsanitized use of `\${{ }}` syntax in dangerous contexts
- User-controlled input used in shell commands
</pattern>

<pattern name="cache_poisoning">
Look for findings like:
- `error[cache-poisoning]` or `warning[cache-poisoning]`
- Caching enabled when publishing artifacts
- Vulnerable to cache poisoning attacks in release workflows
- actions/setup-node or actions/setup-python with cache enabled during artifact publishing
</pattern>

<pattern name="credential_exposure">
Look for findings like:
- Secrets logged to console
- Credentials passed in insecure ways
- Token leakage through workflow logs
</pattern>

<output_format>
For each finding, output in this structured format:

File: .github/workflows/workflow-name.yml:123
Issue: [Vulnerability description]
Severity: High | Medium | Low
Pattern: [The problematic code]
Trigger: [What attack vector this enables]
Fix: [Specific remediation]
Impact: [Security consequences]
Auto-fix: [Yes/No]
Confidence: [High/Medium/Low from zizmor]

Group findings by severity (Error → High → Medium → Low → Info)
</output_format>

<quality_guidelines>
- Only report actual zizmor findings (don't invent issues)
- Include all details from zizmor output
- Note the audit confidence level for each finding
- Indicate if auto-fix is available
- If no findings, explicitly state the workflows are secure
- Report suppressed findings separately
</quality_guidelines>

Run zizmor scanner and report all findings. If zizmor is not installed, report that and provide installation instructions.
```

---

### Documentation Scan Agent

**Mission**: Verify documentation accuracy by checking README files against actual codebase implementation.

**Scan Targets**: All README.md files

**Prompt Template:**
```
Your task is to verify documentation accuracy across all README files by comparing documented behavior, examples, commands, and API descriptions against the actual codebase implementation.

<context>
Documentation accuracy is critical for:
- Developer onboarding and productivity
- Preventing confusion from outdated examples
- Maintaining trust in the project documentation
- Reducing support burden from incorrect instructions

Common documentation issues:
- Package names that don't match package.json
- Command examples with incorrect flags or options
- File paths that are incorrect or outdated
- Build outputs documented in wrong locations
- Configuration examples using deprecated formats
- Missing documentation for new features
- Examples that would fail if run as-is
</context>

<instructions>
Systematically verify all README files against the actual code:

1. **Find all documentation files**:
   ```bash
   find . -name "README.md" -path "*/packages/*" -o -name "*.md" -path "*/docs/*"
   ```

2. **For each README, verify**:
   - Package names match package.json "name" field
   - Command examples use correct flags (check --help output or source)
   - File paths exist and match actual structure
   - Build output paths match actual build script outputs
   - Configuration examples match actual schema/validation
   - Version numbers are current (not outdated)

3. **Check against actual code**:
   - Read package.json to verify names, scripts, dependencies
   - Read source files to verify CLI commands exist
   - Check build scripts to verify output paths
   - Verify CLI --help matches documented flags
   - Check tests to see what's actually supported

4. **Pattern categories to check**:

<pattern name="package_names">
Look for:
- README showing @socketsecurity/cli when npm package is "socket"
- Import examples using wrong package names
- Installation instructions with wrong package names
</pattern>

<pattern name="command_examples">
Look for:
   - Commands with flags that don't exist (check --help)
- Missing required flags in examples
- Deprecated flags still documented
- Examples that would error if run as-is
- Wrong command names
- Non-existent commands (e.g., "socket console")
</pattern>

<pattern name="file_paths">
Look for:
- Documented paths that don't exist in codebase
- Output paths that don't match build script outputs
- Config file locations that are incorrect
- Source file references that are outdated
</pattern>

<pattern name="configuration">
Look for:
- Config examples using wrong keys or structure
- Documented options that aren't validated in code
- Missing required config fields
- Wrong default values documented
</pattern>

<pattern name="build_outputs">
Look for:
- Build output paths that don't match actual outputs
- SEA binary names that are incorrect
- Missing build artifacts
</pattern>

<pattern name="missing_documentation">
Look for:
- Public commands not documented in README
- Important environment variables not documented
- New features added but not documented
</pattern>

<quality_guidelines>
For each potential issue found, use explicit chain-of-thought reasoning with `<thinking>` tags:

<thinking>
1. Is this actually incorrect documentation?
   - Verification: [check against code/package.json/--help]
   - Evidence: [what the actual code shows]
   - Result: [INCORRECT/CORRECT]

2. What confusion would this cause?
   - User impact: [what happens if user follows docs]
   - Severity: [HIGH/MEDIUM/LOW]

3. Is there a reason for the discrepancy?
   - Legacy reasons: [historical context]
   - Multiple packages: [scoped vs unscoped names]
   - Result: [REPORT/SKIP]

Overall assessment: [REPORT/SKIP]
Decision: [If REPORT, include in findings. If SKIP, explain why]
</thinking>

Only report issues that are actual documentation errors.
</quality_guidelines>
</instructions>

<output_format>
For each finding, report:

File: path/to/README.md:lineNumber
Issue: [One-line description of the documentation error]
Severity: High/Medium/Low
Pattern: [The incorrect documentation text]
Actual: [What the correct information should be]
Fix: [Exact documentation correction needed]
Impact: [Why this matters - confusion, errors, etc.]

Severity Guidelines:
- High: Critical inaccuracies that would cause errors if followed (wrong commands, non-existent APIs)
- Medium: Outdated information that misleads but doesn't immediately break (wrong paths, old examples)
- Low: Minor inaccuracies or missing non-critical information

Example:
File: packages/cli/README.md:25
Issue: Incorrect package name in installation command
Severity: High
Pattern: "npm install -g @socketsecurity/cli"
Actual: Package name is "socket" (not "@socketsecurity/cli")
Fix: Change to: "npm install -g socket"
Impact: Installation command will fail with "package not found" error

Example:
File: README.md:89
Issue: Documents non-existent "socket console" command
Severity: High
Pattern: "socket console - Interactive console for Socket API"
Actual: No "console" command exists in packages/cli/src/commands/
Fix: Remove "socket console" from command list
Impact: Users will get "unknown command" error when trying to use it

Example:
File: docs/build-guide.md:45
Issue: Incorrect SEA binary output path
Severity: Medium
Pattern: "Outputs to dist/socket-darwin-arm64"
Actual: SEA binaries output to packages/cli/dist/sea/socket-darwin-arm64
Fix: Change to: "packages/cli/dist/sea/socket-darwin-arm64"
Impact: Developers won't find built binaries at documented location
</output_format>

<quality_guidelines>
- Verify every claim against actual code - don't assume documentation is correct
- Read package.json files to check names, scripts, versions
- Check src/commands/ to verify CLI commands exist
- Look at build script outputs to verify paths
- Focus on high-impact errors first (wrong commands, non-existent APIs)
- Provide exact fixes, not vague suggestions
- Known facts:
  - npm package name is "socket", NOT "@socketsecurity/cli"
  - "socket console" command does NOT exist
  - Interactive test runner using process.exit() is a documented exception
</quality_guidelines>

Scan all README.md files in the repository and report all documentation inaccuracies found. If documentation is accurate, state that explicitly with "✓ No documentation issues found".
```

---

## Known False Positives

These patterns should NOT be flagged as issues - they have been verified as correct:

### Array Access After Length Check

**Pattern:** `if (arr.length === 1) { const item = arr[0]! }`

**Why it's safe:** When `arr.length === 1`, `arr[0]` is guaranteed to exist. The non-null assertion is valid.

### Split After StartsWith Check

**Pattern:** `if (str.startsWith('-')) { indent = str.split('-')[0] }`

**Why it's safe:** If `startsWith('-')` is true, `split('-')[0]` returns the prefix before the first '-' (possibly empty string, but never undefined).

### Package Name "socket"

**Fact:** The npm package name is `socket`, NOT `@socketsecurity/cli`. The scoped name is used internally but the published package is `socket`.

**Correct installation:**
```bash
npm install -g socket
pnpm install -g socket
```

### Non-Existent Commands

**Fact:** There is NO `socket console` command. Do not flag it as missing documentation.

### Interactive Test Runner Exception

**Fact:** The `scripts/test.mjs` file uses `process.exit()` intentionally.

This is an exception to the CLAUDE.md convention because:
- Interactive test runner spawns child processes that keep the event loop alive
- Explicit exit is required to prevent hanging after tests complete
- The code includes comments documenting this exception

### Config Write Mechanism

**Fact:** The config write using `process.nextTick` in `config.mts` is NOT a race condition.

Why it's safe:
- `localConfig` (which IS `_cachedConfig`) is always updated synchronously
- `process.nextTick` only batches the disk write operation
- If multiple updates happen before nextTick fires, all values are already in `_cachedConfig`
- The single pending write persists all accumulated changes correctly

### VFS Extraction Using process.smol.mount()

**Fact:** VFS extraction was recently updated to use `process.smol.mount()` for full directory extraction.

The code correctly:
- Checks if `process.smol.mount` is available
- Mounts entire npm package directories with dependencies
- Mounts standalone binaries from VFS root
- No longer needs manual getAsset() + fs.writeFile() pattern

### GitHub Cache Implementation

**Fact:** GitHub cache using file mtime for TTL is acceptable for 5-minute TTL use case. TOCTOU race is mitigated with double-check pattern.

### Update Cache Platform Independence

**Fact:** npm registry returns the same latest version regardless of platform. Platform-specific binaries are handled via optionalDependencies, so update cache doesn't need platform in key.
