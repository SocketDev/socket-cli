# quality-scan Reference Documentation

## Agent Prompts

### Critical Scan Agent

**Mission**: Identify critical bugs that could cause crashes, data corruption, or security vulnerabilities.

**Scan Targets**: All `.mts` files in `src/`

**Prompt Template:**
```
Your task is to perform a critical bug scan on socket-btm, a monorepo containing Node.js binary tooling written in TypeScript (.mts/.mjs), C/C++, and shell scripts. Identify bugs that could cause build failures, data corruption, or security vulnerabilities.

<context>
This is Socket Security's Binary Tooling Manager (BTM) monorepo with multiple packages:
- **node-smol-builder**: Builds Node.js from source with Socket Security patches
- **binject**: Binary injection library (C/C++ with LIEF integration)
- **bin-infra**: Binary infrastructure utilities (compression, format handling)
- **build-infra**: Build infrastructure utilities (tar, gzip, file I/O)
- **binsuite**: Binary suite tools

Key characteristics:
- Uses TypeScript with .mts/.mjs extension for build scripts
- C/C++ code for binary manipulation and injection
- Manages Node.js version synchronization and patch application
- Processes external source code and applies unified diff patches
- Handles cross-platform compilation (macOS, Linux, Windows)
- Manages build checkpoints and caching for performance
- Must handle patch failures and build errors gracefully
</context>

<instructions>
Scan all code files across the monorepo for these critical bug patterns:
- TypeScript/JavaScript: packages/*/scripts/**/*.{mjs,mts}, packages/*/src/**/*.{mjs,mts}
- C/C++: packages/*/src/**/*.{c,cc,cpp,h}
- Focus on:

<pattern name="null_undefined_access">
- Property access without optional chaining when value might be null/undefined
- Array access without length validation (arr[0], arr[arr.length-1])
- JSON.parse() without try-catch
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
- File handles opened but not closed (missing .close() or using())
- Timers created but not cleared (setTimeout/setInterval)
- Event listeners added but not removed
- Memory accumulation in long-running processes
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

File: src/path/to/file.mts:lineNumber
Issue: [One-line description of the bug]
Severity: Critical
Pattern: [The problematic code snippet]
Trigger: [What input/condition causes the bug]
Fix: [Specific code change to fix it]
Impact: [What happens if this bug is triggered]

Example:
File: packages/node-smol-builder/scripts/binary-released/shared/apply-patches.mjs:145
Issue: Unhandled promise rejection in patch application
Severity: Critical
Pattern: `applyPatch(patchFile, targetPath)`
Trigger: When patch file contains malformed unified diff format
Fix: `await applyPatch(patchFile, targetPath).catch(err => { log.error(err); throw new Error(\`Patch failed: \${err.message}\`) })`
Impact: Uncaught exception crashes build process, leaving Node.js source in inconsistent state

Example (C/C++):
File: packages/binject/src/socketsecurity/binject/binject.c:234
Issue: Potential null pointer dereference after malloc
Severity: Critical
Pattern: `uint8_t* buffer = malloc(size); memcpy(buffer, data, size);`
Trigger: When malloc fails due to insufficient memory
Fix: `uint8_t* buffer = malloc(size); if (!buffer) return BINJECT_ERROR_MEMORY; memcpy(buffer, data, size);`
Impact: Segmentation fault crashes binary injection process
</output_format>

<quality_guidelines>
- Only report actual bugs, not style issues or minor improvements
- Verify bugs are not already handled by surrounding code
- Prioritize bugs affecting build reliability and binary correctness
- For C/C++: Focus on memory safety, null checks, buffer overflows
- For TypeScript: Focus on promise handling, type guards, external input validation
- Skip false positives (TypeScript type guards are sufficient in many cases)
- Scan across all packages: node-smol-builder, binject, bin-infra, build-infra, binsuite
</quality_guidelines>

Scan systematically through all packages/ directories and report all critical bugs found. If no critical bugs are found, state that explicitly.
```

---

### Logic Scan Agent

**Mission**: Detect logical errors in build scripts, patch algorithms, and binary manipulation that could produce incorrect builds or corrupted binaries.

**Scan Targets**: All packages in the monorepo

**Prompt Template:**
```
Your task is to detect logic errors in socket-btm's build scripts, patch application logic, and binary manipulation code that could produce incorrect builds or corrupted binaries. Focus on algorithm correctness, edge case handling, and data validation.

<context>
socket-btm is a monorepo for Node.js binary tooling:
- **node-smol-builder**: Build orchestration, patch application, checkpoint management
- **binject**: Binary injection logic, ELF/Mach-O/PE format handling
- **bin-infra**: Binary compression, format detection, segment management
- **build-infra**: File I/O, tar creation, gzip compression

Critical operations:
- Patch parsing and application (unified diff format)
- Binary format detection and manipulation (ELF/Mach-O/PE)
- Checkpoint creation and restoration (tar.gz archives)
- Cross-platform path handling and file operations
- Version comparison and Node.js synchronization
</context>

<instructions>
Analyze all packages for these logic error patterns:

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
- Patch parsing: Hunk header line counts not validated, @@ parsing errors
- Version comparison: Failing on semver edge cases (prerelease, build metadata)
- Path resolution: Symlink handling, relative vs absolute path logic
- File ordering: Incorrect dependency ordering in build sequences
- Deduplication: Missing deduplication of duplicate files/patches
</pattern>

<pattern name="patch_handling">
Patch application logic errors:
- Unified diff parsing: Line offset calculation errors, context matching failures
- Hunk application: Off-by-one in line number calculations
- Patch validation: Missing validation of patch format (malformed hunks)
- Backup/restore: Not properly handling patch failures mid-application
- Independent patches: Assumptions about patch ordering or dependencies
</pattern>

<pattern name="binary_format">
Binary format handling errors:
- Format detection: Misidentifying ELF/Mach-O/PE headers
- Section/segment: Off-by-one in offset calculations, size validation missing
- Endianness: Not handling big-endian vs little-endian correctly
- Alignment: Missing alignment requirements for injected data
- Cross-platform: Windows vs Unix path separators, line endings
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

File: src/path/to/file.mts:lineNumber
Issue: [One-line description]
Severity: High | Medium
Edge Case: [Specific input that triggers the error]
Pattern: [The problematic code snippet]
Fix: [Corrected code]
Impact: [What incorrect output is produced]

Example:
File: packages/node-smol-builder/scripts/binary-released/shared/apply-patches.mjs:89
Issue: Off-by-one in patch hunk line counting
Severity: High
Edge Case: When patch hunk has trailing context lines
Pattern: `for (let i = 0; i < hunkLines.length - 1; i++)`
Fix: `for (let i = 0; i < hunkLines.length; i++)`
Impact: Last line of patch hunk is silently omitted, causing patch application to fail or produce incorrect output

Example (C code):
File: packages/binject/src/socketsecurity/binject/elf_inject.c:234
Issue: Incorrect section size calculation with alignment
Severity: High
Edge Case: When injecting data into sections requiring alignment
Pattern: `new_size = existing_size + data_size;`
Fix: `new_size = ALIGN_UP(existing_size + data_size, section_alignment);`
Impact: Injected data misaligned, causing segfault when binary loads section
</output_format>

<quality_guidelines>
- Prioritize code handling external data (patches, binary files, build configs)
- Focus on errors affecting build correctness and binary integrity
- Verify logic errors aren't false alarms due to type narrowing
- Consider real-world edge cases: malformed patches, unusual binary formats, cross-platform paths
- Pay special attention to C/C++ pointer arithmetic and buffer calculations
</quality_guidelines>

Analyze systematically across all packages and report all logic errors found. If no errors are found, state that explicitly.
```

---

### Cache Scan Agent

**Mission**: Identify caching bugs that cause stale builds, checkpoint corruption, or incorrect behavior.

**Scan Targets**: Build checkpoint system and caching logic across all packages

**Prompt Template:**
```
Your task is to analyze socket-btm's checkpoint and caching implementation for correctness, staleness bugs, and performance issues. Focus on checkpoint corruption, cache invalidation failures, and race conditions.

<context>
socket-btm uses a multi-stage checkpoint system to speed up builds:
- **Checkpoint stages**: source-copied, source-patched, configured, compiled, stripped, compressed, final
- **Storage**: tar.gz archives stored in build/checkpoints/{platform}-{arch}/
- **Invalidation**: Based on cache keys (hashes of patches, config, source version)
- **Progressive builds**: Can restore from any checkpoint and continue
- **Cross-platform**: Must work on Windows, macOS, Linux (ARM64, x64)
- **Critical**: Stale checkpoints cause incorrect builds that are hard to debug

Caching locations:
- packages/node-smol-builder/scripts/common/shared/checkpoints.mjs
- packages/node-smol-builder/build/checkpoints/
- Cache key generation and validation logic
</context>

<instructions>
Analyze caching implementation for these issue categories:

<pattern name="cache_invalidation">
Stale checkpoints from incorrect invalidation:
- Patch changes: Are patch file hashes included in cache key?
- Source version: Is Node.js version properly included in cache key?
- Config changes: Are build flags (debug/release, ICU settings) in cache key?
- Cross-platform: Are platform/arch properly isolated (darwin-arm64 vs linux-x64)?
- Restoration: Is checkpoint validated before restoration (corrupted archives)?
- Race: Checkpoint modified/deleted between validation and restoration?
</pattern>

<pattern name="cache_keys">
Checkpoint key generation correctness:
- Hash collisions: Is hash function sufficient for patch content?
- Patch ordering: Does key depend on patch application order?
- Platform isolation: Are Windows/macOS/Linux checkpoints properly separated?
- Arch isolation: Are ARM64/x64 checkpoints kept separate?
- Additions: Are build-infra/binject changes invalidating checkpoints?
- Environment: Are env vars (NODE_OPTIONS, etc.) affecting builds included?
</pattern>

<pattern name="checkpoint_corruption">
Checkpoint archive corruption:
- Partial writes: tar.gz creation interrupted, incomplete archive
- Disk full: Archive truncated due to disk space issues
- Extraction failures: Corrupted archive extracted partially
- Overwrite races: Concurrent builds overwriting same checkpoint
- Cleanup races: Checkpoint deleted while being restored
</pattern>

<pattern name="concurrency">
Race conditions in checkpoint operations:
- Creation races: Multiple builds creating same checkpoint simultaneously
- Restoration races: Checkpoint deleted/modified during restoration
- Validation races: Checkpoint validated then corrupted before use
- Directory conflicts: Concurrent builds using same build directory
- Lock files: Missing lock files allowing concurrent checkpoint access
</pattern>

<pattern name="stale_checkpoints">
Scenarios producing stale/incorrect checkpoints:
- Patch modified but checkpoint not invalidated (hash not updated)
- Platform mismatch: Restoring darwin checkpoint on linux
- Arch mismatch: Restoring arm64 checkpoint for x64 build
- Version mismatch: Node.js version changed but checkpoint reused
- Additions changed: build-infra/binject updated but checkpoint not invalidated
- Environment drift: Build flags changed but cache key unchanged
</pattern>

<pattern name="edge_cases">
Uncommon scenarios:
- Empty files (zero bytes) - cached correctly?
- File deletion while cached - stale entry persists?
- Rapid successive reads/writes (stress testing)
- Very large files exceeding maxEntrySize
- Permission changes during caching
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

File: packages/node-smol-builder/scripts/common/shared/checkpoints.mjs:lineNumber
Issue: [One-line description]
Severity: High | Medium
Scenario: [Step-by-step sequence showing how bug manifests]
Pattern: [The problematic code snippet]
Fix: [Specific code change]
Impact: [Observable effect - wrong output, performance, crash]

Example:
File: packages/node-smol-builder/scripts/common/shared/checkpoints.mjs:145
Issue: Cache key missing patch content hashes
Severity: High
Scenario: 1) Build with patch v1, creates checkpoint. 2) Patch file modified to v2 (same filename). 3) Build restores v1 checkpoint. 4) Produces binary with v1 patches but v2 expected
Pattern: `const cacheKey = \`\${nodeVersion}-\${platform}-\${arch}\``
Fix: `const patchHashes = await hashAllPatches(); const cacheKey = \`\${nodeVersion}-\${platform}-\${arch}-\${patchHashes}\``
Impact: Stale checkpoints produce incorrect Node.js binaries with wrong patches applied
</output_format>

<quality_guidelines>
- Focus on correctness issues that produce wrong builds or corrupted checkpoints
- Consider cross-platform differences (Windows, macOS, Linux)
- Evaluate checkpoint invalidation scenarios (patches changed, additions changed)
- Prioritize issues causing silent build incorrectness over performance
- Verify issues aren't prevented by existing cache key generation
</quality_guidelines>

Analyze the checkpoint implementation thoroughly across all checkpoint stages and report all issues found. If the implementation is sound, state that explicitly.
```

---

### Workflow Scan Agent

**Mission**: Detect problems in build scripts, CI configuration, git hooks, and developer workflows across the socket-btm monorepo.

**Scan Targets**: All `scripts/`, `package.json`, `.git-hooks/*`, `.github/workflows/*` across packages

**Prompt Template:**
```
Your task is to identify issues in socket-btm's development workflows, build scripts, and CI configuration that could cause build failures, test flakiness, or poor developer experience.

<context>
socket-btm is a pnpm monorepo with:
- **Build scripts**: packages/*/scripts/**/*.{mjs,mts} (ESM, cross-platform Node.js)
- **Package manager**: pnpm workspaces with scripts in each package.json
- **Git hooks**: .git-hooks/* for pre-commit, pre-push validation
- **CI**: GitHub Actions (.github/workflows/)
- **Platforms**: Must work on Windows, macOS, Linux (ARM64, x64)
- **CLAUDE.md**: Defines conventions (no process.exit(), no backward compat, etc.)
- **Critical**: Build scripts compile C/C++ code and apply patches - must handle errors gracefully

Packages:
- node-smol-builder: Main build orchestration
- binject: C/C++ binary injection library
- bin-infra, build-infra: Utilities used by node-smol-builder
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
- process.exit() usage: CLAUDE.md forbids this - should throw errors instead
- Missing try-catch: Async operations without error handling
- Exit codes: Non-zero exit on failure for CI detection
- Error messages: Are they helpful for debugging?
- Dependency checks: Do scripts check for required tools before use?

**Note on file existence checks**: existsSync() is ACCEPTABLE and actually PREFERRED over async fs.access() for synchronous file checks. Node.js has quirks where the synchronous check is more reliable for immediate validation. Do NOT flag existsSync() as an issue.
</pattern>

<pattern name="package_json_scripts">
package.json script correctness:
- Script chaining: Use && (fail fast) not ; (continue on error) when errors matter
- Platform-specific: Commands that don't work cross-platform (grep, find, etc.)
- Convention compliance: Match patterns in CLAUDE.md (e.g., `pnpm run foo --flag` not `foo:bar`)
- Missing scripts: Standard scripts like build, test, lint documented?
</pattern>

<pattern name="git_hooks">
Git hooks configuration:
- Pre-commit: Does it run linting/formatting? Is it fast (<10s)?
- Pre-push: Does it run tests to prevent broken pushes?
- False positives: Do hooks block legitimate commits?
- Error messages: Are hook failures clearly explained?
- Hook installation: Is setup documented in README?
</pattern>

<pattern name="ci_configuration">
CI pipeline issues:
- Build order: Are steps in correct sequence (install → build → test)?
- Cross-platform: Are Windows/macOS/Linux builds all tested?
- C/C++ compilation: Are compiler toolchains (clang, gcc, MSVC) properly configured?
- Build artifacts: Are Node.js binaries uploaded for each platform?
- Checkpoint caching: Are build checkpoints cached across CI runs?
- Failure notifications: Are build failures clearly visible?
- Node.js versions: Are upstream Node.js version updates tested?
- Patch validation: Are patch files validated before application?
</pattern>

<pattern name="developer_experience">
Documentation and setup:
- README: Setup instructions clear and complete?
- Common errors: Are frequent issues documented with solutions?
- Required tools: List of prerequisites (Node.js version, pnpm, etc.)?
- Environment variables: Are required env vars documented?
- First-time setup: Can a new contributor get started easily?
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

File: [scripts/foo.mjs:line OR package.json:scripts.build OR .github/workflows/ci.yml:line]
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
Issue: Script chaining uses semicolon instead of &&
Severity: Medium
Impact: Tests run even if build fails, masking build issues
Pattern: `"test": "pnpm build ; pnpm vitest"`
Fix: `"test": "pnpm build && pnpm vitest"`
</output_format>

<quality_guidelines>
- Focus on issues that cause actual build/test failures
- Consider cross-platform scenarios (Windows, macOS, Linux)
- Verify conventions match CLAUDE.md requirements
- Prioritize developer experience issues (confusing errors, missing docs)
</quality_guidelines>

Analyze workflow files systematically and report all issues found. If workflows are well-configured, state that explicitly.
```

---

## Scan Configuration

### Severity Levels

| Level | Description | Action Required |
|-------|-------------|-----------------|
| **Critical** | Crashes, security vulnerabilities, data corruption | Fix immediately |
| **High** | Logic errors, incorrect output, resource leaks | Fix before release |
| **Medium** | Performance issues, edge case bugs | Fix in next sprint |
| **Low** | Code smells, minor inconsistencies | Fix when convenient |

### Scan Priority Order

1. **critical** - Most important, run first
2. **logic** - Parser correctness critical for SBOM accuracy
3. **cache** - Performance and correctness
4. **workflow** - Developer experience

### Coverage Targets

- **critical**: All src/ files
- **logic**: src/parsers/ (19 ecosystems) + src/utils/
- **cache**: src/utils/file-cache.mts + related
- **workflow**: scripts/, package.json, .git-hooks/, CI

---

## Report Format

### Structured Findings

Each finding should include:
```typescript
{
  file: "src/utils/file-cache.mts:89",
  issue: "Potential race condition in cache update",
  severity: "High",
  scanType: "cache",
  pattern: "if (cached) { /* check-then-act */ }",
  suggestion: "Use atomic operations or locking",
  impact: "Could return stale data under concurrent access"
}
```

### Example Report Output

```markdown
# Quality Scan Report

**Date:** 2026-02-05
**Scans:** critical, logic, cache, workflow
**Files Scanned:** 127
**Findings:** 2 critical, 5 high, 8 medium, 3 low

## Critical Issues (Priority 1) - 2 found

### src/utils/file-cache.mts:89
- **Issue**: Potential null pointer access on cache miss
- **Pattern**: `const stats = await fs.stat(normalizedPath)`
- **Fix**: Add try-catch or check file existence first
- **Impact**: Crashes when file deleted between cache check and stat

### src/parsers/npm/index.mts:234
- **Issue**: Unhandled promise rejection
- **Pattern**: `parsePackageJson(path)` without await or .catch()
- **Fix**: Add await or .catch() handler
- **Impact**: Uncaught exception crashes process

## High Issues (Priority 2) - 5 found

### src/parsers/pypi/index.mts:512
- **Issue**: Off-by-one error in bracket depth calculation
- **Pattern**: `bracketDepth - 1` can go negative
- **Fix**: Use `Math.max(0, bracketDepth - 1)`
- **Impact**: Incorrect dependency parsing for malformed files

...

## Scan Coverage
- **Critical scan**: 127 files analyzed in src/
- **Logic scan**: 19 parsers + 15 utils analyzed
- **Cache scan**: 1 file + related code paths
- **Workflow scan**: 12 scripts + package.json + 3 hooks

## Recommendations
1. Address 2 critical issues immediately before next release
2. Review 5 high-severity logic errors in parsers
3. Schedule medium issues for next sprint
4. Low-priority items can be addressed during refactoring
```

---

## Edge Cases

### No Findings

If scan finds no issues:
```markdown
# Quality Scan Report

**Result**: ✓ No issues found

All scans completed successfully with no findings.

- Critical scan: ✓ Clean
- Logic scan: ✓ Clean
- Cache scan: ✓ Clean
- Workflow scan: ✓ Clean

**Code quality**: Excellent
```

### Scan Failures

If an agent fails or times out:
```markdown
## Scan Errors

- **critical scan**: ✗ Failed (agent timeout)
  - Retry recommended
  - Check agent prompt size

- **logic scan**: ✓ Completed
- **cache scan**: ✓ Completed
- **workflow scan**: ✓ Completed
```

### Partial Scans

User can request specific scan types:
```bash
# Only run critical and logic scans
quality-scan --types critical,logic
```

Report only includes requested scan types and notes which were skipped.

---

## Security Scan Agent

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
- Unsanitized use of `${{ }}` syntax in dangerous contexts
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

{
  file: ".github/workflows/workflow-name.yml:123",
  issue: "Template injection vulnerability in run block",
  severity: "High",
  scanType: "security",
  pattern: "run: echo ${{ github.event.comment.body }}",
  trigger: "Untrusted user input from PR comment",
  fix: "Use environment variables: env: COMMENT: ${{ github.event.comment.body }} then echo \"$COMMENT\"",
  impact: "Attacker can execute arbitrary code in CI environment",
  autofix: true
}

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
```

### Example Security Scan Output

```markdown
## Security Issues - 2 found

### .github/workflows/ci.yml:45
- **Issue**: Template injection in run block
- **Severity**: High
- **Pattern**: `echo "User comment: ${{ github.event.comment.body }}"`
- **Trigger**: Untrusted PR comment body injected into shell command
- **Fix**: Use environment variable: `env: COMMENT: ${{ github.event.comment.body }}` then `echo "User comment: $COMMENT"`
- **Impact**: Attacker can execute arbitrary commands in CI by crafting malicious PR comment
- **Auto-fix**: Available (`zizmor --fix`)
- **Confidence**: High

### .github/workflows/release.yml:89
- **Issue**: Cache poisoning vulnerability when publishing artifacts
- **Severity**: Medium
- **Pattern**: `actions/setup-node@v4` with `cache: 'npm'` in release workflow
- **Trigger**: Dependency cache enabled in workflow that publishes release artifacts
- **Fix**: Disable cache: `cache: ''` or remove cache parameter when publishing
- **Impact**: Attacker could poison dependency cache and inject malicious code into releases
- **Auto-fix**: Not available
- **Confidence**: Low
```

---

## Documentation Scan Agent

**Mission**: Verify documentation accuracy by checking README files, code comments, and examples against actual codebase implementation.

**Scan Targets**: All README.md files, documentation files, and inline code examples

**Prompt Template:**
```
Your task is to verify documentation accuracy across all README files and documentation by comparing documented behavior, examples, commands, and API descriptions against the actual codebase implementation.

<context>
Documentation accuracy is critical for:
- Developer onboarding and productivity
- Preventing confusion from outdated examples
- Maintaining trust in the project documentation
- Reducing support burden from incorrect instructions

Common documentation issues:
- Package names that don't match package.json
- Command examples with incorrect flags or options
- API documentation showing methods that don't exist
- File paths that are incorrect or outdated
- Build outputs documented in wrong locations
- Configuration examples using deprecated formats
- Missing documentation for new features
- Examples that would fail if run as-is
</context>

<instructions>
Systematically verify all README files and documentation against the actual code:

1. **Find all documentation files**:
   ```bash
   find . -name "README.md" -o -name "*.md" -path "*/docs/*"
   ```

2. **For each README, verify**:
   - Package names match package.json "name" field
   - Command examples use correct flags (check --help output or source)
   - File paths exist and match actual structure
   - Build output paths match actual build script outputs
   - API examples match actual exported functions/types
   - Configuration examples match actual schema/validation
   - Version numbers are current (not outdated)
   - Prerequisites are accurate (correct tool versions)

3. **Check against actual code**:
   - Read package.json to verify names, scripts, dependencies
   - Read source files to verify APIs, exports, types
   - Check build scripts to verify output paths
   - Verify CLI --help matches documented flags
   - Check tests to see what's actually supported

4. **Pattern categories to check**:

<pattern name="package_names">
Look for:
- README showing @scope/package when package.json has no scope
- README showing package-name when package.json shows different name
- Installation instructions with wrong package names
- Import examples using wrong package names
</pattern>

<pattern name="command_examples">
Look for:
- Commands with flags that don't exist (check --help)
- Missing required flags in examples
- Deprecated flags still documented
- Examples that would error if run as-is
- Wrong command names (typos or renamed commands)
</pattern>

<pattern name="file_paths">
Look for:
- Documented paths that don't exist in codebase
- Output paths that don't match build script outputs
- Config file locations that are incorrect
- Source file references that are outdated
</pattern>

<pattern name="api_documentation">
Look for:
- Functions/methods documented that don't exist in exports
- Parameter types that don't match actual implementation
- Return types incorrectly documented
- Missing required parameters in examples
- Examples using deprecated APIs
</pattern>

<pattern name="configuration">
Look for:
- Config examples using wrong keys or structure
- Documented options that aren't validated in code
- Missing required config fields
- Wrong default values documented
- Obsolete configuration formats
</pattern>

<pattern name="build_outputs">
Look for:
- Build output paths that don't match actual outputs
- File sizes that are significantly outdated
- Checkpoint names that don't match actual implementation
- Binary names that are incorrect
- Missing intermediate build stages
</pattern>

<pattern name="version_information">
Look for:
- Outdated version numbers in examples
- Dependency versions that don't match package.json
- Tool version requirements that are incorrect
- Patch counts that don't match actual patches
</pattern>

<pattern name="missing_documentation">
Look for:
- Public APIs/exports not documented in README
- Important environment variables not documented
- New features added but not documented
- Critical sections (75%+ of package) not mentioned
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
File: packages/binject/README.md:46
Issue: Incorrect description of NODE_SEA section compression format
Severity: High
Pattern: "NODE_SEA - Compressed application code (Brotli, ~70-80% reduction)"
Actual: NODE_SEA contains uncompressed blobs generated by Node.js itself, not Brotli-compressed data
Fix: Change to: "NODE_SEA - Single Executable Application code (generated by Node.js)"
Impact: Misleads developers about the actual format, causing confusion when inspecting binaries

Example:
File: README.md:25
Issue: Incorrect package name in build command
Severity: High
Pattern: "pnpm --filter @socketbin/node-smol-builder run build"
Actual: package.json shows "name": "node-smol-builder" without @socketbin scope
Fix: Change to: "pnpm --filter node-smol-builder run build"
Impact: Command will fail with "No projects matched" error

Example:
File: packages/build-infra/README.md:14
Issue: References non-existent module name
Severity: Medium
Pattern: "paths - Standard directory structure"
Actual: Module is exported as "path-builder" in package.json exports
Fix: Change to: "path-builder - Standard directory structure"
Impact: Developers looking for "paths" module will not find it

Example:
File: packages/binject/README.md:227
Issue: Incorrect config size documented
Severity: Low
Pattern: "Config stored in binary format (1112 bytes)"
Actual: Config is 1176 bytes (verified in source code)
Fix: Change to: "Config stored in binary format (1176 bytes)"
Impact: Minor inaccuracy in technical specification
</output_format>

<quality_guidelines>
- Verify every claim against actual code - don't assume documentation is correct
- Read package.json files to check names, scripts, versions
- Run --help commands to verify CLI flags when possible
- Check exports in source files to verify APIs
- Look at build script outputs to verify paths
- Focus on high-impact errors first (wrong commands, non-existent APIs)
- Report missing documentation for major features (not every minor detail)
- Group related issues (e.g., "5 packages using @scope incorrectly")
- Provide exact fixes, not vague suggestions
- If a README is mostly missing (75%+ of package undocumented), report as single high-severity issue
</quality_guidelines>

Scan all README.md files in the repository and report all documentation inaccuracies found. If documentation is accurate, state that explicitly.
```

### Example Documentation Scan Output

```markdown
## Documentation Issues - 8 found

### High Severity - 3 issues

#### README.md:25
- **Issue**: Incorrect package name in build command
- **Pattern**: `pnpm --filter @socketbin/node-smol-builder run build`
- **Actual**: package.json shows `"name": "node-smol-builder"` without scope
- **Fix**: Change to: `pnpm --filter node-smol-builder run build`
- **Impact**: Command fails with "No projects matched" error

#### packages/binject/README.md:100
- **Issue**: Documents obsolete --update-config flag
- **Pattern**: `binject inject -e ./node-smol -o ./my-app --sea app.blob --update-config update-config.json`
- **Actual**: Flag was removed, config now embedded via sea-config.json smol.update section
- **Fix**: Remove --update-config example, document sea-config.json approach instead
- **Impact**: Users will get "unknown flag" error, approach no longer works

#### packages/build-infra/README.md:12
- **Issue**: Documents non-existent "c-package" builder
- **Pattern**: "*-builder - Build strategies (cmake, rust, emscripten, c-package)"
- **Actual**: No c-package-builder.mjs exists; actual builders are: cmake, rust, emscripten, docker, clean
- **Fix**: List actual builders: "cmake, rust, emscripten, docker, clean"
- **Impact**: Users looking for c-package builder will be confused

### Medium Severity - 3 issues

#### packages/binject/README.md:62
- **Issue**: Output path missing build mode variants
- **Pattern**: "Outputs to `build/prod/out/Final/binject`"
- **Actual**: Build system supports both dev and prod modes: `build/{dev|prod}/out/Final/binject`
- **Fix**: Change to: "Outputs to `build/{dev|prod}/out/Final/binject`"
- **Impact**: Confusing for developers doing dev builds

#### packages/node-smol-builder/README.md:182
- **Issue**: Incorrect patch count
- **Pattern**: "Applies 13 patches to Node.js source"
- **Actual**: Only 12 patches in patches/source-patched/ directory
- **Fix**: Change to: "Applies 12 patches to Node.js source"
- **Impact**: Minor discrepancy in technical details

#### packages/bin-infra/README.md:1-21
- **Issue**: Missing 75% of package contents in documentation
- **Pattern**: Only documents src/ and make/, omits lib/, test/, scripts/, upstream/, patches/
- **Actual**: Package has extensive JavaScript API (lib/), test utilities, build scripts, and upstream dependencies
- **Fix**: Add comprehensive documentation of all 17 C files, 3 JS modules with API examples, test helpers, scripts, and upstream submodules
- **Impact**: Developers unaware of most package functionality

### Low Severity - 2 issues

#### packages/binject/README.md:227
- **Issue**: Incorrect config size
- **Pattern**: "1112 bytes"
- **Actual**: Config is 1176 bytes (verified in source)
- **Fix**: Change all occurrences to: "1176 bytes"
- **Impact**: Minor technical inaccuracy

#### packages/binflate/README.md:18
- **Issue**: Claims caching functionality
- **Pattern**: "Uses cache at ~/.socket/_dlx/"
- **Actual**: binflate only extracts; self-extracting stubs (not binflate) implement caching
- **Fix**: Clarify that binflate extracts only, stubs handle caching
- **Impact**: Confusion about which component caches
```

