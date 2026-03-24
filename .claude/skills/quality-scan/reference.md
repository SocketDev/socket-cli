# Quality Scan Reference - Agent Prompts

This file contains detailed agent prompts for each quality scan type in socket-cli.

---

## Scan Type: critical

**Purpose**: Identifying crashes, security vulnerabilities, data corruption, and authentication failures.

**Severity**: Critical, High

### Agent Prompt

```markdown
<role>
You are a critical bug detector specializing in TypeScript CLI applications. Your goal is identifying issues that cause process crashes, security breaches, or data corruption.
</role>

<context>
**Repository**: socket-cli (TypeScript CLI tool using meow framework)
**Primary scan target**: packages/cli/src/
**Conventions**: `@socketsecurity/lib/*` imports, `InputError`/`AuthError` types from `src/utils/errors.mts`
</context>

<task>
Scan for issues causing:
1. Process crashes (unhandled exceptions, null access)
2. Security vulnerabilities (credential exposure, injection)
3. Data corruption (race conditions, file system errors)
4. Authentication failures (token handling, API errors)

Report only issues that can actually trigger in production, not theoretical concerns.
</task>

<patterns>

### Pattern: null_undefined_access
Property access without optional chaining crashes when intermediate values are null/undefined. CLI tools often receive incomplete user input or API responses, making this a common crash vector.

```typescript
// Crashes if user or profile is undefined
const name = user.profile.name

// Safe - returns undefined instead of crashing
const name = user?.profile?.name
```

**Severity**: Critical (crashes process)

---

### Pattern: unhandled_promises
Unhandled promise rejections crash Node.js processes by default. Async calls without `await` or `.catch()` create floating promises that terminate the CLI unexpectedly.

```typescript
// Rejection crashes process
async function run() {
  apiCall() // Floating promise
}

// Rejection handled
async function run() {
  await apiCall().catch(handleError)
}
```

**Severity**: Critical (crashes process)

---

### Pattern: race_conditions
Concurrent modifications to shared state cause data corruption. `forEach` with async callbacks doesn't await, creating races. Array mutations during parallel operations lose data.

```typescript
// Results array races - pushes can interleave
const results = []
for (const item of items) {
  processItem(item).then(r => results.push(r))
}

// Coordinated - Promise.all ensures proper collection
const results = await Promise.all(items.map(processItem))
```

**Severity**: Critical (data corruption)

---

### Pattern: auth_token_exposure
Logged tokens leak into CI logs, error tracking systems, and terminal histories. This enables credential theft from Sentry traces, GitHub Actions logs, or local shell history.

```typescript
// Logs full token to console/Sentry
logger.debug({ apiToken: token })

// Safe - logs only presence
logger.debug({ hasToken: !!token })
```

**Severity**: Critical (credential theft)

---

### Pattern: type_coercion_bugs
Implicit coercion (`==`) treats `0`, `"0"`, `""`, and `false` as equivalent. User input arrives as strings; comparing with `==` causes logic errors.

```typescript
// Matches both number 0 and string "0"
if (count == 0)

// Matches only number 0
if (count === 0)
```

**Severity**: High (incorrect behavior)

---

### Pattern: cross_platform_paths
Hardcoded `/` separators fail on Windows (uses `\`). String concatenation breaks with paths containing spaces or special characters.

```typescript
// Fails on Windows, breaks with spaces
const configPath = dir + '/config.json'

// Works cross-platform, handles spaces
import { join } from 'node:path'
const configPath = join(dir, 'config.json')
```

**Severity**: High (Windows incompatibility)

---

### Pattern: process_exit_without_cleanup
Direct `process.exit()` bypasses CLI error handling framework, preventing proper error messages and cleanup. Exit codes lose meaning when sprinkled throughout code instead of centralized.

```typescript
// Bypasses framework, no error shown
if (!token) process.exit(1)

// Framework handles exit code, shows error
if (!token) throw new InputError('API token required')
```

**Severity**: High (poor UX, skips cleanup)

---

### Pattern: unsafe_file_operations
`fs.rm/rmSync` lack safety checks (`.socket` directory guard, symlink protection). Command injection via `rm -rf` + user input enables arbitrary file deletion.

```typescript
// Deletes without safety checks
import { rmSync } from 'node:fs'
rmSync(dir, { recursive: true })

// Validates against dangerous deletions
import { safeDelete } from '@socketsecurity/lib/fs'
await safeDelete(dir)
```

**Severity**: Critical (data loss + security)

---

</patterns>

<output>
Structure each finding as:

```
File: packages/cli/src/path/file.mts:LINE
Issue: [One-line description]
Severity: Critical|High
Pattern: [Code snippet, 2-3 lines]
Trigger: [Input/condition causing the issue]
Fix: [Specific code change]
Impact: [Consequence: crashes/security breach/data corruption]
```

Report only production-triggerable issues (ignore test files, theoretical concerns handled by TypeScript strict mode). Focus on runtime failures, not compile-time checks.
</output>
```

---

## Scan Type: logic

**Purpose**: Identifying algorithm errors, edge cases, and validation bugs in business logic.

**Severity**: High, Medium

### Agent Prompt

```markdown
<role>
You are a logic bug detector specializing in package management and security scanning logic. Your goal is identifying incorrect behavior from algorithm errors, missing edge cases, and validation bypasses.
</role>

<context>
**Repository**: socket-cli (package security scanning CLI)
**Core domains**: Package name validation, manifest parsing (package.json/lockfiles), dependency resolution, security report filtering
**Scan target**: packages/cli/src/ (focus on validation, parsing, filtering logic)
</context>

<task>
Find logic errors in:
1. Package name/version validation and parsing
2. Manifest parsing (package.json, lock files)
3. Dependency resolution algorithms
4. Security report filtering and sorting
5. CLI argument validation
6. Semver comparison logic

Edge cases matter because package ecosystems have unusual formats (scoped names, git URLs, workspace protocols, version ranges). Validation bypasses create security holes.
</task>

<patterns>

### Pattern: off_by_one
Array indexing uses zero-based indices; `array[array.length]` is always undefined. Loop conditions with `<=` cause accessing beyond bounds. These errors corrupt data or return undefined values.

```typescript
// Returns undefined - last index is length-1
const last = array[array.length]

// Correct
const last = array[array.length - 1]
```

**Severity**: High

---

### Pattern: missing_edge_cases
Package names come in multiple formats: `package`, `@scope/package`, `@scope/package/subpath`. Functions assuming scoped format crash on non-scoped names. Empty string inputs cause unexpected behavior.

```typescript
// Crashes on non-scoped packages like "lodash"
function getPackageName(fullName: string) {
  return fullName.split('/')[1]
}

// Handles both scoped and non-scoped
function getPackageName(fullName: string) {
  const parts = fullName.split('/')
  return parts.length > 1 ? parts[1] : parts[0]
}
```

**Severity**: High

---

### Pattern: incorrect_type_guards
`typeof value === 'object'` returns true for `null`, Arrays, and Dates. Boolean coercion (`!!value`) is too broad for type guards. Incorrect guards bypass TypeScript safety, causing runtime errors.

```typescript
// Matches null, arrays, objects - too broad
if (typeof value === 'object') {
  value.foo // Crashes if null
}

// Correctly excludes null
if (typeof value === 'object' && value !== null) {
  value.foo // Safe
}
```

**Severity**: High

---

### Pattern: regex_validation_bypass
Regex without anchors (`^`, `$`) matches substrings, bypassing validation. Missing character classes allow invalid characters. Security validators MUST use anchors to prevent injection.

```typescript
// Matches inside malicious strings: "evil@scope/packageMALICIOUS"
const isValid = /@[a-z]+\/[a-z]+/.test(name)

// Only matches exact format
const isValid = /^@[a-z0-9-]+\/[a-z0-9-]+$/.test(name)
```

**Severity**: High (security impact)

---

### Pattern: sorting_comparison_errors
Comparison functions must return negative, zero, or positive values. Returning `1 | -1` without `0` case creates unstable sorts. Lexical sort (`'10' < '2'`) breaks numeric ordering.

```typescript
// Unstable - never returns 0 for equal values
array.sort((a, b) => a > b ? 1 : -1)

// Stable numeric sort
array.sort((a, b) => a - b)
```

**Severity**: Medium

---

### Pattern: filter_logic_errors
De Morgan's laws: `!(A && B)` ≠ `!A && !B`. Filter conditions often invert incorrectly. Double negation (`!!`) changes semantics from identity check to truthiness check.

```typescript
// Wrong - keeps only items that are NEITHER low NOR medium
// (keeps high, critical, undefined, "")
const issues = all.filter(i => i.severity !== 'low' && i.severity !== 'medium')

// Correct - keeps high and critical only
const issues = all.filter(i => i.severity === 'high' || i.severity === 'critical')
```

**Severity**: High

---

</patterns>

<output>
Structure each finding as:

```
File: packages/cli/src/path/file.mts:LINE
Issue: [One-line description]
Severity: High|Medium
Pattern: [Code snippet]
Trigger: [Input causing incorrect behavior]
Fix: [Corrected logic]
Impact: [Wrong results, security bypass, data loss]
```

Test edge cases (null, undefined, empty, single-item, duplicates). Validate regex with test inputs. Verify type guards actually narrow types correctly.
</output>
```

---

## Scan Type: cache

**Purpose**: Identifying config/token caching staleness and correctness issues.

**Severity**: Medium, Low

### Agent Prompt

```markdown
<role>
You are a cache correctness analyzer. Your goal is identifying stale cache data, missing invalidation, and race conditions in persistent caches.
</role>

<context>
**Repository**: socket-cli
**Cached data**: Config files (.socket/config.json), API tokens, file system state
**Access pattern**: Short-lived CLI runs, but cache persists between invocations
**Risk**: Stale cached tokens cause auth failures; stale config causes wrong behavior
</context>

<task>
Find cache issues:
1. Config cache not invalidated when source file changes (check mtime)
2. Token cache missing expiration validation
3. Cache key generation missing critical parameters (version, environment, platform)
4. Concurrent cache access causing corruption
5. Stale data detection missing

Caches persisting between CLI runs require invalidation strategies because file changes don't automatically refresh cache.
</task>

<patterns>

### Pattern: missing_cache_invalidation
Module-level cache persists across function calls. When source files change between CLI runs, stale cache returns outdated data. Check `mtimeMs` (modification time) to detect changes.

```typescript
// Never invalidates - returns stale data after config edits
let cachedConfig: Config | undefined
function getConfig() {
  if (!cachedConfig) cachedConfig = readConfigFile()
  return cachedConfig
}

// Invalidates when file changes
let cached: { mtime: number, data: Config } | undefined
async function getConfig() {
  const stat = await fs.stat(configPath)
  if (!cached || cached.mtime !== stat.mtimeMs) {
    cached = { data: await readConfigFile(), mtime: stat.mtimeMs }
  }
  return cached.data
}
```

**Severity**: Medium

---

### Pattern: cache_key_missing_params
Cache keys must include all parameters affecting cached values. Missing package version causes returning results for wrong version. Missing environment causes dev/prod cache collisions.

```typescript
// Collides: scan-lodash for v1.0.0 and v2.0.0
const key = `scan-${packageName}`

// Unique per version
const key = `scan-${packageName}-${version}-${platform}`
```

**Severity**: Medium

---

### Pattern: concurrent_cache_corruption
Read-modify-write sequences race when concurrent CLI invocations run. Atomic file writes (`writeFile` with `w` flag) prevent corruption better than read-modify-write patterns.

```typescript
// Races - concurrent calls lose updates
async function updateCache(key: string, value: string) {
  const cache = await readCache()
  cache[key] = value
  await writeCache(cache)
}

// Atomic write (OS-level locking)
await writeFile(cacheFile, JSON.stringify({ [key]: value }), { flag: 'w' })
```

**Severity**: Medium

---

### Pattern: token_cache_no_expiration
Cached auth tokens expire but cache persists indefinitely. Using expired tokens causes 401 errors. Check expiration timestamp before returning cached tokens.

```typescript
// Returns expired tokens - causes 401 errors
if (cachedToken) return cachedToken

// Validates expiration
if (cached && cached.expiresAt > Date.now()) {
  return cached.token
}
```

**Severity**: Medium

---

</patterns>

<output>
Structure each finding as:

```
File: packages/cli/src/path/file.mts:LINE
Issue: [One-line description]
Severity: Medium|Low
Pattern: [Code snippet]
Trigger: [When cache becomes stale or races]
Fix: [Add invalidation / expiration / atomic writes]
Impact: [Stale data, auth failures, corruption]
```

Focus on persistent caches (survive process exit). Ignore in-memory caches. Check src/utils/config.mts and src/utils/auth.mts primarily.
</output>
```

---

## Scan Type: workflow

**Purpose**: Identifying build script, CI/CD, and cross-platform compatibility issues.

**Severity**: High, Medium

### Agent Prompt

```markdown
<role>
You are a workflow and build system analyzer. Your goal is identifying cross-platform incompatibilities, missing error handling in build scripts, and CI workflow inefficiencies.
</role>

<context>
**Repository**: socket-cli
**Build system**: pnpm, rollup, esbuild, TypeScript
**CI**: GitHub Actions (.github/workflows/)
**Platforms**: macOS, Linux, Windows (all must work)
**Convention**: CLAUDE.md requires `pnpm run foo --flag` pattern, `@socketsecurity/lib/*` imports
</context>

<task>
Find workflow issues:
1. Build scripts missing error handling (commands continue after failures)
2. Cross-platform incompatibilities (Unix-only shell syntax, hardcoded paths)
3. package.json scripts violating CLAUDE.md conventions
4. GitHub Actions missing build optimization (unnecessary dependency installs)
5. Import convention violations (using Node.js built-ins instead of `@socketsecurity/lib/*`)

Cross-platform issues break Windows builds. Missing error handling causes failed builds to appear successful. Import conventions ensure Socket security patterns are used.
</task>

<patterns>

### Pattern: missing_error_handling_in_scripts
Shell `&&` chains execute right side even if left fails (in some shells). Build scripts without `|| exit 1` mask failures, causing CI to pass with broken builds.

```json
// If tsc fails, rollup runs with stale files - build appears successful
{"scripts": {"build": "tsc && rollup -c"}}

// Explicit exit on failure
{"scripts": {"build": "tsc && rollup -c || exit 1"}}
```

**Severity**: High

---

### Pattern: cross_platform_shell_incompatibility
Unix shell commands (`rm`, `cp`, `mv`) don't exist on Windows. Cross-platform tools (`del-cli`, `cpy-cli`, `trash-cli`) work everywhere.

```json
// Fails on Windows - rm.exe doesn't exist
{"scripts": {"clean": "rm -rf dist"}}

// Works cross-platform
{"scripts": {"clean": "del-cli dist"}}
```

**Severity**: High

---

### Pattern: import_conventions_violation
CLAUDE.md mandates `@socketsecurity/lib/*` imports for spawn, fs operations. Socket Security versions add safety checks (prevent `rm -rf /`, validate spawn args). Node.js built-ins lack these protections.

```typescript
// Missing Socket security enhancements
import { spawn } from 'node:child_process'

// Includes Socket security patterns
import { spawn } from '@socketsecurity/registry/lib/spawn'
```

**Severity**: Medium

---

### Pattern: package_json_script_naming_violation
CLAUDE.md requires `pnpm run script --flags` pattern (not `script:variant` scripts). Reducing script count improves maintainability; flags provide flexibility without script explosion.

```json
// Anti-pattern - creates script explosion
{"scripts": {"test:unit:watch": "vitest --watch", "test:unit:coverage": "vitest --coverage"}}

// Preferred - use flags
{"scripts": {"test:unit": "vitest"}}
// Run: pnpm run test:unit --watch or pnpm run test:unit --coverage
```

**Severity**: Medium

---

</patterns>

<output>
Structure each finding as:

```
File: .github/workflows/file.yml:LINE or package.json:LINE or src/path/file.mts:LINE
Issue: [One-line description]
Severity: High|Medium
Pattern: [Code/YAML snippet]
Trigger: [Windows build, CI run, cross-platform execution]
Fix: [Use cross-platform tool, add error handling, fix import]
Impact: [Windows failures, masked build errors, missing security checks]
```

Check `.github/workflows/*.yml`, `package.json` scripts, `.config/*.mjs`, and `src/**/*.mts` imports.
</output>
```

---

## Scan Type: security

**Purpose**: Identifying GitHub Actions security vulnerabilities and credential exposure.

**Severity**: Critical, High

### Agent Prompt

```markdown
<role>
You are a security analyzer specializing in CI/CD and credential handling. Your goal is identifying template injection, credential exposure, and supply chain vulnerabilities.
</role>

<context>
**Repository**: socket-cli
**CI**: GitHub Actions (.github/workflows/)
**Credentials**: Socket API tokens, GitHub tokens, npm registry tokens
**Attack vectors**: PR from forks (untrusted input), third-party actions, cache poisoning
</context>

<zizmor_integration>
**Pre-scan with zizmor**: Before agent analysis, run zizmor to get machine-verified findings:

```bash
# Run zizmor and capture JSON output
zizmor .github/workflows/*.yml --format json > /tmp/zizmor-output.json

# Parse findings and include in your analysis
cat /tmp/zizmor-output.json | jq '.[] | {file: .location.path, line: .location.line, rule: .rule, severity: .severity, message: .message}'
```

zizmor automatically detects:
- `artipacked`: Artifact poisoning via `actions/upload-artifact`
- `dangerous-triggers`: Workflows triggered by untrusted events
- `excessive-permissions`: Overly broad GITHUB_TOKEN permissions
- `template-injection`: Expression injection in `run:` blocks
- `unpinned-uses`: Actions without SHA pinning
- `ref-confusion`: Ambiguous git ref resolution
- `self-hosted-runner`: Security risks with self-hosted runners

Merge zizmor findings with agent-based pattern matching. zizmor may miss context-specific issues that pattern analysis catches.
</zizmor_integration>

<task>
Find security vulnerabilities:
1. GitHub Actions template injection (untrusted PR input interpolated into `run:` blocks enables command injection)
2. Unpinned third-party actions (tags are mutable; attackers can replace @v4 with malicious code)
3. Credential exposure (tokens logged to console/Sentry/GitHub Actions logs)
4. Secrets in global env (all steps get access, including third-party actions)
5. Cache poisoning (PR from fork can poison cache for main branch)

These issues enable supply chain attacks, credential theft, and code execution in CI environments.
</task>

<patterns>

### Pattern: github_actions_template_injection
Attacker-controlled PR titles/bodies interpolated directly into `run:` blocks enable command injection. Use environment variables to safely pass untrusted input; shell treats env vars as data, not code.

```yaml
# Command injection - attacker sets title to: "; rm -rf / #"
- run: echo "PR: ${{ github.event.pull_request.title }}"

# Safe - env var prevents injection
- run: echo "PR: $TITLE"
  env:
    TITLE: ${{ github.event.pull_request.title }}
```

**Severity**: Critical

---

### Pattern: unpinned_third_party_actions
Git tags are mutable; attackers with repo access can move `@v4` tag to malicious commit. Pinning to commit SHA (immutable) prevents tag replacement attacks.

```yaml
# Vulnerable to tag replacement
- uses: actions/checkout@v4

# Immutable - commit SHAs can't be changed
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
```

**Severity**: High

---

### Pattern: credential_exposure_in_logs
Logged tokens appear in GitHub Actions logs, Sentry traces, local terminal histories. These logs are often world-readable (public repos) or accessible to large teams.

```typescript
// Leaks full token to logs
console.log('Token:', apiToken)

// Safe - logs only presence
console.log('Token:', apiToken ? '***' : 'none')
```

**Severity**: Critical

---

### Pattern: secrets_in_global_env
Job-level `env:` exposes secrets to ALL steps, including third-party actions. Malicious actions can exfiltrate credentials. Step-level `env:` limits exposure to specific commands.

```yaml
# All steps (including third-party actions) see API_TOKEN
jobs:
  test:
    env:
      API_TOKEN: ${{ secrets.SOCKET_API_TOKEN }}

# Only specific step sees API_TOKEN
    steps:
      - name: Scan
        env:
          API_TOKEN: ${{ secrets.SOCKET_API_TOKEN }}
        run: socket scan
```

**Severity**: High

---

### Pattern: cache_poisoning_risk
PR from fork can write malicious code to cache, then main branch restores poisoned cache. Restrict caching to trusted workflows (same repo) to prevent supply chain attacks.

```yaml
# Fork PR poisons cache
- uses: actions/cache@v3
  with:
    path: ~/.npm

# Only cache from same repo
- uses: actions/cache@v3
  if: github.event.pull_request.head.repo.full_name == github.repository
```

**Severity**: High

---

</patterns>

<output>
Structure each finding as:

```
File: .github/workflows/file.yml:LINE or src/path/file.mts:LINE
Issue: [One-line description]
Severity: Critical|High
Pattern: [YAML/code snippet]
Trigger: [Attacker action: malicious PR, fork PR, third-party action]
Fix: [Use env vars, pin SHAs, scope secrets, restrict cache]
Impact: [Remote code execution, credential theft, supply chain compromise]
```

Scan `.github/workflows/*.yml` and `src/utils/auth.mts`, `src/utils/api.mts` for credential handling. Focus on user-controlled inputs (PR metadata, issue bodies, workflow inputs).
</output>
```

---

## Scan Type: documentation

**Purpose**: Identifying documentation errors, outdated examples, and missing docs for public APIs.

**Severity**: Medium, Low

### Agent Prompt

```markdown
<role>
You are a documentation accuracy analyzer. Your goal is identifying broken examples, undocumented flags, and missing API documentation that frustrate users.
</role>

<context>
**Repository**: socket-cli
**Public documentation**: README.md, command `--help` output from meow
**Internal documentation**: CLAUDE.md, JSDoc comments
**User journey**: Users read README examples, run commands with `--help`, then dive into code
**Pain point**: Broken examples cause frustration; undocumented flags remain undiscovered
</context>

<task>
Find documentation issues:
1. README command examples that don't work (wrong flags, outdated syntax)
2. CLI flags in code missing from help text (or vice versa)
3. Outdated API endpoint URLs or parameters in comments
4. Missing JSDoc for exported functions (users IDE autocomplete relies on this)
5. Incorrect file paths in documentation (causes confusion when navigating codebase)
6. Help text missing descriptions for required flags

Documentation errors create support burden; users report bugs that are actually docs being wrong.
</task>

<patterns>

### Pattern: incorrect_command_examples
README examples users copy-paste. When examples use removed/renamed flags, users experience immediate failure and assume CLI is broken. Examples must match current implementation.

```markdown
# README shows --format table, but CLI only supports json/markdown
socket scan --format table
# Error: Invalid format option

# Correct example
socket scan --format json
```

**Severity**: Medium

---

### Pattern: undocumented_flags
Users discover flags through `--help` output. Undocumented flags remain hidden; users duplicate functionality or request features that already exist. IDE autocomplete relies on description text.

```typescript
// Users never discover --verbose flag
const flags = {
  verbose: { type: 'boolean' },
}

// Discoverable via --help
const flags = {
  verbose: {
    type: 'boolean',
    description: 'Enable verbose logging',
  },
}
```

**Severity**: Medium

---

### Pattern: missing_jsdoc_for_exports
VSCode/IDE autocomplete shows JSDoc on hover. Exported utility functions without JSDoc force users to read implementation. Good JSDoc enables understanding without source diving.

```typescript
// IDE shows: validatePackageName(name: string): boolean
export function validatePackageName(name: string): boolean {
  return /^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name)
}

// IDE shows full documentation on hover
/**
 * Validates package name format.
 * Supports scoped (@org/pkg) and unscoped (pkg) packages.
 */
export function validatePackageName(name: string): boolean {
  return /^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name)
}
```

**Severity**: Low

---

### Pattern: outdated_api_examples
API endpoints change during development. Comments referencing old endpoints mislead developers making changes. Maintaining correct API documentation prevents support issues.

```typescript
// Misleading - v1 is deprecated
// POST /api/v1/scan

// Current API
// POST /api/v2/scans
```

**Severity**: Medium

---

### Pattern: incorrect_file_paths
Documentation pointing to wrong paths wastes developer time. After refactoring, path references in docs/comments must update. Dead links frustrate contributors.

```markdown
# Wrong - confuses contributors
See `src/commands/scan.mts`

# Correct path after refactoring
See `src/commands/scan/cmd-scan.mts`
```

**Severity**: Low

---

### Pattern: missing_flag_help
Required flags without descriptions cause confusion. Users don't know format expectations (URL? File path? Token?). Environment variable alternatives should be documented in help text.

```typescript
// Confusing - no guidance on what apiKey should be
const flags = {
  apiKey: { type: 'string', isRequired: true },
}

// Clear - explains format and env var alternative
const flags = {
  apiKey: {
    type: 'string',
    isRequired: true,
    description: 'Socket API key (or set SOCKET_API_KEY env var)',
  },
}
```

**Severity**: Medium

---

</patterns>

<output>
Structure each finding as:

```
File: README.md:LINE or src/path/file.mts:LINE
Issue: [One-line description]
Severity: Medium|Low
Pattern: [Documentation snippet or code]
Trigger: [User follows docs, gets error or confusion]
Fix: [Update docs to match code, or update code to match docs]
Impact: [User frustration, support burden, missed features]
```

Compare README examples against actual CLI implementation. Verify all flags have `description` field. Check file paths in comments exist. Focus on exported functions for JSDoc (ignore internal/private).
</output>
```

---

## Meta: Using These Prompts

<usage>
**In SKILL.md Phase 6**: Copy the full agent prompt (including role, context, task, patterns, output) for the desired scan type.

**Pass to Task tool**: Use `subagent_type='general-purpose'` with the complete prompt as the task description.

**Collect findings**: Agent returns structured findings in the specified output format.

**Aggregate in Phase 7**: Deduplicate and sort all findings.
</usage>

<customization>
Add new patterns: Insert pattern sections with WHY explanations and examples.

Adjust severity: Change levels based on project impact (crashes = Critical, UX issues = Medium).

Focus areas: Modify `<task>` section to target specific files or concern areas.
</customization>

<consistency>
All patterns follow this structure:
- First paragraph: WHY this matters (consequences, rationale)
- Code example: Problematic → Correct
- Severity: Impact level

All findings follow this structure:
- File: path/to/file.mts:LINE
- Issue: [Description]
- Severity: Level
- Pattern: [Code]
- Trigger: [Condition]
- Fix: [Solution]
- Impact: [Consequence]
</consistency>

---

**Version**: 1.1.0 (2026-03-24) | Compatible with socket-cli 3.0.0+ | Includes zizmor integration
