# quality-scan Reference Documentation

## Core Principles

### KISS (Keep It Simple, Stupid)

**Always prioritize simplicity** - the simpler the code, the fewer bugs it will have.

Common violations to flag:
- **Over-abstraction**: Creating utilities, helpers, or wrappers for one-time operations
- **Premature optimization**: Complex caching, memoization, or performance tricks before profiling
- **Unnecessary indirection**: Multiple layers of function calls when direct code would be clearer
- **Complex path construction**: Building paths manually instead of using helper return values
- **Feature creep**: Adding "nice to have" features that complicate the core logic

Examples:

**BAD - Ignoring return values and reconstructing paths:**
```javascript
await downloadSocketBtmRelease({ asset, downloadDir, tool: 'lief' })
const downloadedPath = path.join(downloadDir, 'lief', 'assets', asset)  // ❌ Assumes path structure
```

**GOOD - Use the return value:**
```javascript
const downloadedPath = await downloadSocketBtmRelease({ asset, downloadDir })  // ✅ Simple, trust the function
```

**Principle**: If a function returns what you need, use it. Don't reconstruct or assume.

## Agent Prompts

### Critical Scan Agent

**Mission**: Identify critical bugs that could cause crashes, data corruption, or security vulnerabilities.

**Scan Targets**: All `.mts` files in `src/`

**Prompt Template:**
```
Your task is to perform a critical bug scan on the codebase. Identify bugs that could cause crashes, data corruption, or security vulnerabilities.

<context>
[CONDITIONAL: Adapt this context based on the repository you're scanning]

Common characteristics to look for:
- TypeScript/JavaScript files (.ts, .mts, .mjs, .js)
- Async operations and promise handling
- External API integrations
- File system operations
- Cross-platform compatibility requirements
- Error handling patterns
- Resource management (connections, file handles, timers)
</context>

<instructions>
Scan all code files for these critical bug patterns:
- [IF monorepo] TypeScript/JavaScript: packages/*/scripts/**/*.{mjs,mts}, packages/*/src/**/*.{mjs,mts}
- [IF single package] TypeScript/JavaScript: src/**/*.{ts,mts,mjs,js}, lib/**/*.{ts,mts,mjs,js}
- [IF C/C++ code exists] C/C++: src/**/*.{c,cc,cpp,h}
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

<pattern name="primordials_protection">
**CRITICAL for Node.js internal code (IF repository has Node.js internals):**
- Direct Promise method calls (Promise.all, Promise.allSettled, Promise.race, Promise.any) instead of primordials
- Missing primordials import in internal/ modules
- Using Promise.all where Promise.allSettled would be safer for error collection
- [SOCKET-BTM SPECIFIC] Check additions/source-patched/lib/internal/socketsecurity/smol/*.js for SafePromiseAllSettled usage
- [SOCKET-BTM SPECIFIC] Check additions/source-patched/deps/fast-webstreams/*.js for SafePromiseAllReturnVoid usage
- [SOCKET-BTM SPECIFIC] Verify sync scripts (vendor-fast-webstreams/sync.mjs) inject primordials when syncing from upstream
</pattern>

<pattern name="cross_platform_binary_bugs">
**[SOCKET-BTM SPECIFIC] CRITICAL for binary tooling (binject, binpress, stubs-builder):**
Cross-platform binary processing that uses compile-time platform detection:
- `#ifdef __APPLE__` / `#ifdef _WIN32` selecting sizes, offsets, or behaviors for binary operations
- Host platform detection instead of target binary format detection
- Example buggy pattern (causes "Cannot inject into uncompressed stub" errors):
  ```c
  #ifdef __APPLE__
  size_t search_size = SEARCH_SIZE_MACHO;  // Uses macOS size even for Linux ELF binaries!
  #else
  size_t search_size = SEARCH_SIZE_ELF;
  #endif
  ```
- Fix: Use runtime binary format detection based on the executable being processed:
  ```c
  binject_format_t format = binject_detect_format(executable);
  size_t search_size = get_search_size_for_format(format);
  ```
- Impact: Cross-platform CI (e.g., macOS building Linux binaries) silently produces broken binaries
</pattern>

<pattern name="pe_resource_requirements">
**[SOCKET-BTM SPECIFIC] CRITICAL for Windows binary tooling:**
Windows PE binaries missing required .rsrc sections for LIEF injection:
- LIEF cannot create resource sections from scratch - must exist in the binary
- Symptoms: "Binary has no resources section" error during SEA injection
- Check Windows Makefiles (Makefile.windows) for:
  1. Missing .rc resource file compilation with windres
  2. Missing RESOURCE_OBJ in the final link step
- Required for any PE binary that will receive NODE_SEA_BLOB or other injected resources
</pattern>

<pattern name="binsuite_self_compression_in_tests">
**[SOCKET-BTM SPECIFIC] CRITICAL for test reliability and CI stability:**
Tests compressing binsuite binaries (binpress, binflate, binject) as test input cause:
- Flaky/slow tests: These binaries vary between builds, causing inconsistent test behavior
- CI timeouts: Large binary compression takes excessive time
- Parallel test interference: Tests using static paths collide in parallel runs

**Bad patterns to flag:**
```typescript
// BAD - compressing binsuite tools themselves
const originalBinary = BINPRESS  // or BINFLATE, BINJECT
await execCommand(BINPRESS, [BINFLATE, '-o', output])

// BAD - static testDir paths (parallel collision risk)
const testDir = path.join(PACKAGE_DIR, 'test-tmp')
```

**Correct patterns:**
```typescript
// GOOD - use Node.js binary (consistent across builds)
const NODE_BINARY = process.execPath
let testDir: string
let testBinary: string

beforeAll(async () => {
  // Unique testDir isolates parallel test runs
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testDir = path.join(os.tmpdir(), `package-test-${uniqueId}`)
  await safeMkdir(testDir)
  // Copy Node.js as consistent test input
  testBinary = path.join(testDir, 'test-node')
  await fs.copyFile(NODE_BINARY, testBinary)
})
```

**[SOCKET-BTM SPECIFIC] Where to check:**
- packages/binpress/test/*.test.mts
- packages/binflate/test/*.test.mts
- packages/binject/test/*.test.mts
- Any test that uses `BINPRESS`, `BINFLATE`, or `BINJECT` as compression input

**Impact:** Tests using binsuite tools as input cause Linux CI timeouts (180-360 seconds)
</pattern>

For each bug found, think through:
1. Can this actually crash in production?
2. What input would trigger it?
3. Is there existing safeguards I'm missing?
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
File: src/path/to/file.mjs:145
Issue: Unhandled promise rejection in async operation
Severity: Critical
Pattern: `await asyncOperation()`
Trigger: When operation fails without error handling
Fix: `await asyncOperation().catch(err => { logger.error(err); throw new Error(\`Operation failed: \${err.message}\`) })`
Impact: Uncaught exception crashes process

Example (C/C++):
File: src/path/to/file.c:234
Issue: Potential null pointer dereference after malloc
Severity: Critical
Pattern: `uint8_t* buffer = malloc(size); memcpy(buffer, data, size);`
Trigger: When malloc fails due to insufficient memory
Fix: `uint8_t* buffer = malloc(size); if (!buffer) return ERROR_MEMORY; memcpy(buffer, data, size);`
Impact: Segmentation fault crashes process
</output_format>

<quality_guidelines>
- Only report actual bugs, not style issues or minor improvements
- Verify bugs are not already handled by surrounding code
- Prioritize bugs affecting reliability and correctness
- For C/C++: Focus on memory safety, null checks, buffer overflows
- For TypeScript: Focus on promise handling, type guards, external input validation
- Skip false positives (TypeScript type guards are sufficient in many cases)
- [IF monorepo] Scan across all packages systematically
- [IF single package] Scan all source directories (src/, lib/, scripts/)
</quality_guidelines>

Scan systematically and report all critical bugs found. If no critical bugs are found, state that explicitly.
```

---

### Logic Scan Agent

**Mission**: Detect logical errors in algorithms, data processing, and business logic that could produce incorrect output or incorrect behavior.

**Scan Targets**: All source code files

**Prompt Template:**
```
Your task is to detect logic errors in the codebase that could produce incorrect output or incorrect behavior. Focus on algorithm correctness, edge case handling, and data validation.

<context>
[CONDITIONAL: Adapt this context based on the repository you're scanning]

Common areas to analyze:
- Algorithm implementation and correctness
- Data parsing and transformation logic
- Input validation and sanitization
- Edge case handling
- Cross-platform compatibility
- Business logic implementation
</context>

<instructions>
Analyze code for these logic error patterns:

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
- [IF parsing logic exists] Parsing: Header/format validation, delimiter handling errors
- Version comparison: Failing on semver edge cases (prerelease, build metadata)
- Path resolution: Symlink handling, relative vs absolute path logic
- File ordering: Incorrect dependency ordering in sequences
- Deduplication: Missing deduplication of duplicate items
</pattern>

<pattern name="patch_handling">
**[SOCKET-BTM SPECIFIC] Patch application logic errors:**
- Unified diff parsing: Line offset calculation errors, context matching failures
- Hunk application: Off-by-one in line number calculations
- Patch validation: Missing validation of patch format (malformed hunks)
- Backup/restore: Not properly handling patch failures mid-application
- Independent patches: Assumptions about patch ordering or dependencies
</pattern>

<pattern name="binary_format">
**[SOCKET-BTM SPECIFIC] Binary format handling errors:**
- Format detection: Misidentifying ELF/Mach-O/PE headers
- Section/segment: Off-by-one in offset calculations, size validation missing
- Endianness: Not handling big-endian vs little-endian correctly
- Alignment: Missing alignment requirements for injected data
- Cross-platform: Windows vs Unix path separators, line endings
</pattern>

<pattern name="compile_time_vs_runtime_platform">
**[SOCKET-BTM SPECIFIC] Cross-platform binary processing bugs (CRITICAL - causes silent failures):**
- Using `#ifdef __APPLE__` / `#ifdef _WIN32` to select binary format-specific behavior
- Code uses host platform instead of target binary format for size/offset calculations
- Magic marker search using compile-time constants instead of runtime binary format detection
- Example bug pattern:
  ```c
  // BAD - uses compile-time platform, breaks cross-platform builds
  #ifdef __APPLE__
  size_t search_size = 64 * 1024;   // Mach-O size
  #elif defined(_WIN32)
  size_t search_size = 128 * 1024;  // PE size
  #else
  size_t search_size = 1408 * 1024; // ELF size
  #endif

  // GOOD - runtime detection based on binary being processed
  binject_format_t format = binject_detect_format(executable);
  size_t search_size = get_search_size_for_format(format);
  ```
- Symptoms: "Cannot inject into uncompressed stub binary" when building Linux binaries on macOS
- Critical for: binject, binpress, stubs-builder, any code manipulating binaries cross-platform
- Real-world impact: macOS CI processing Linux ELF binaries uses wrong search size, fails to find markers
</pattern>

<pattern name="missing_pe_resources">
**[SOCKET-BTM SPECIFIC] Windows PE binaries missing required resource sections:**
- PE stub binaries without .rsrc section cannot receive LIEF-injected resources
- LIEF cannot create resource sections from scratch - binary must have existing resources
- Symptoms: "Binary has no resources section" error during Windows SEA injection
- Check Windows Makefiles for:
  1. Missing .rc resource file (stub.rc or similar)
  2. Missing windres compilation step: `$(WINDRES) -i $(RESOURCE_RC) -o $@`
  3. Missing resource object in link step: `$(CC) ... $(RESOURCE_OBJ) ...`
- Required for binaries that need NODE_SEA_BLOB or other injected resources
- Example fix for Makefile.windows:
  ```makefile
  RESOURCE_RC = src/socketsecurity/stubs-builder/stub.rc
  RESOURCE_OBJ = $(OUT_DIR)/stub.res.o
  WINDRES ?= windres

  $(RESOURCE_OBJ): $(RESOURCE_RC) | $(OUT_DIR)
      $(WINDRES) -i $(RESOURCE_RC) -o $@

  $(OUT_DIR)/$(TARGET): $(SOURCE) $(RESOURCE_OBJ) ...
      $(CC) ... $(SOURCE) $(RESOURCE_OBJ) ...
  ```
</pattern>

Before reporting, think through:
1. Does this logic error produce incorrect output?
2. What specific input would trigger it?
3. Is the error already handled elsewhere?
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
File: src/path/to/file.mjs:89
Issue: Off-by-one in array iteration
Severity: High
Edge Case: When array has trailing elements
Pattern: `for (let i = 0; i < items.length - 1; i++)`
Fix: `for (let i = 0; i < items.length; i++)`
Impact: Last item is silently omitted, causing incorrect processing

Example (C code):
File: src/path/to/file.c:234
Issue: Incorrect size calculation with alignment
Severity: High
Edge Case: When data requires alignment
Pattern: `new_size = existing_size + data_size;`
Fix: `new_size = ALIGN_UP(existing_size + data_size, alignment);`
Impact: Misaligned data causes segfault
</output_format>

<quality_guidelines>
- Prioritize code handling external data (user input, file parsing, API responses)
- Focus on errors affecting correctness and data integrity
- Verify logic errors aren't false alarms due to type narrowing
- Consider real-world edge cases: malformed input, unusual formats, cross-platform paths
- [IF C/C++ exists] Pay special attention to pointer arithmetic and buffer calculations
</quality_guidelines>

Analyze systematically and report all logic errors found. If no errors are found, state that explicitly.
```

---

### Cache Scan Agent

**Mission**: Identify caching bugs that cause stale data, cache corruption, or incorrect behavior.

**Scan Targets**: Caching logic across the codebase (if applicable)

**Prompt Template:**
```
Your task is to analyze caching implementation for correctness, staleness bugs, and performance issues. Focus on cache corruption, invalidation failures, and race conditions.

<context>
**[SOCKET-BTM SPECIFIC - Adapt for your repository's caching strategy]**

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

**[SOCKET-BTM SPECIFIC]** NOTE: SOURCE_PATCHED and SOURCE_COPIED checkpoints intentionally omit platform/arch/libc
because source patching is platform-agnostic - the same patches apply regardless of
target platform. Only binary compilation stages (COMPILED, STRIPPED, COMPRESSED, FINALIZED)
need platform-specific cache keys. Do NOT flag this as an issue.
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

Think through each issue:
1. Can this actually happen in production?
2. What observable behavior results?
3. How likely/severe is the impact?
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

<pattern name="import_conventions">
Import style conventions (Socket Security standards):
- Use `@socketsecurity/lib/logger` instead of custom log functions or cherry-picked console methods
- Use `@socketsecurity/lib/spawn` instead of `node:child_process` (except in `additions/` directory)
- For Node.js built-in modules: **Cherry-pick fs, default import path/os/url/crypto**
  - For `fs`: cherry-pick sync methods, use promises namespace for async
  - For `child_process`: **avoid direct usage** - prefer `@socketsecurity/lib/spawn`
  - For `path`, `os`, `url`, `crypto`: use default imports
  - Examples:
    - `import { existsSync, promises as fs } from 'node:fs'` ✅
    - `import { spawn } from '@socketsecurity/lib/spawn'` ✅ (preferred over node:child_process)
    - `import path from 'node:path'` ✅
    - `import os from 'node:os'` ✅
    - `import { fileURLToPath } from 'node:url'` ✅ (exception: cherry-pick specific exports from url)
- Prefer standard library patterns over custom implementations

Examples of what to flag:
- Custom log functions: `function log(msg) { console.log(msg) }` → use `@socketsecurity/lib/logger`
- Direct child_process usage (except in additions/):
  - `import { execSync } from 'node:child_process'` → use `import { spawn } from '@socketsecurity/lib/spawn'`
  - `execSync('cmd arg1')` → use `await spawn('cmd', ['arg1'])`
- Default imports for fs:
  - `import fs from 'node:fs'` → use `import { existsSync, promises as fs } from 'node:fs'`
- Cherry-picking from path/os:
  - `import { join, resolve } from 'node:path'` → use `import path from 'node:path'`
  - `import { platform, arch } from 'node:os'` → use `import os from 'node:os'`
- Wrong async imports: `import { readFile } from 'node:fs/promises'` → use `import { promises as fs } from 'node:fs'`

Why this matters:
- Consistent logging across all packages (formatting, levels, CI integration)
- @socketsecurity/lib/spawn provides better error handling and cross-platform support than raw child_process
- Cherry-picked fs methods are explicit and tree-shakeable
- Promises namespace clearly distinguishes async operations from sync
- Default imports for path/os/crypto show which module provides the function
- Easier refactoring and IDE navigation
- Avoids naming conflicts
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
- Common errors: Are frequent issues documented with solutions?
- Environment variables: Are required env vars documented?
</pattern>

<pattern name="build_infrastructure">
Build script architecture and helper methods (CRITICAL for consistent builds):

**Package Build Entry Points:**
- Packages MUST use `scripts/build.mjs` as the build entry point, never direct Makefile invocation
- build.mjs handles: dependency downloads, environment setup, then Make invocation
- Direct `make -f Makefile.<platform>` bypasses critical setup (curl/LIEF downloads)

**Required build.mjs patterns:**
```javascript
// CORRECT - uses buildBinSuitePackage from bin-infra
import { buildBinSuitePackage } from 'bin-infra/lib/builder'

buildBinSuitePackage({
  packageName: 'tool-name',
  packageDir: packageRoot,
  beforeBuild: async () => {
    // Download dependencies BEFORE Make runs
    await ensureCurl()  // stubs-builder
    await ensureLief()          // binject, binpress
  },
  smokeTest: async (binaryPath) => { ... }
})
```

**Dependency download helpers:**
- `ensureCurl()` - Downloads curl+mbedTLS from releases (stubs-builder)
- `ensureLief()` - Downloads LIEF library from releases (binject, binpress)
- `downloadSocketBtmRelease()` - Generic helper from `@socketsecurity/lib/releases/socket-btm`

**Common mistakes to flag:**
1. Makefile invoked directly without pnpm wrapper:
   - Bug: `make -f Makefile.macos` in documentation or scripts
   - Fix: Use `pnpm run build` or `pnpm --filter <package> build`

2. Missing beforeBuild hook:
   - Bug: build.mjs doesn't download dependencies before Make
   - Fix: Add beforeBuild with appropriate ensure* calls

3. Wrong dependency helper:
   - Bug: Manually downloading curl/LIEF with curl/wget
   - Fix: Use downloadSocketBtmRelease() or package-specific helpers

4. Not using buildBinSuitePackage:
   - Bug: Custom build script without standard patterns
   - Fix: Use bin-infra/lib/builder for consistent behavior

**Check these files:**
- packages/*/scripts/build.mjs - Must use buildBinSuitePackage
- packages/*/Makefile.* - Should not be invoked directly (only via build.mjs)
- README.md files - Should document `pnpm run build`, not direct make
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

## Workflow Optimization Scan Agent

**Mission**: Verify GitHub Actions workflows optimize CI time by checking `build-required` conditions on expensive installation/setup steps when checkpoint caching is used.

**Scan Targets**: All `.github/workflows/*.yml` files that use checkpoint caching

**Prompt Template:**
```
Your task is to verify GitHub Actions workflows properly skip expensive tool installation steps when builds are restored from cache by checking for `build-required` conditions.

<context>
**Why Workflow Optimization Matters:**
CI workflows waste significant time installing build tools (compilers, CMake, toolchains) even when builds are restored from cache. For socket-btm with 9 workflows building Node.js binaries across multiple platforms, these optimizations save:
- **Windows**: 1-3 minutes per run (MinGW/LLVM/CMake installation)
- **macOS**: 30-60 seconds per run (brew installs, Xcode setup)
- **Linux**: 30-60 seconds per run (apt-get installs, toolchain setup)

**socket-btm Checkpoint Caching System:**
socket-btm uses a sophisticated checkpoint caching system to speed up builds:
- `restore-checkpoint` action: Restores build artifacts from cache (yoga-layout, models, lief, onnxruntime, node-smol)
- `setup-checkpoints` action: Manages checkpoints for binsuite tools (binpress, binflate, binject)
- `build-required` output: Indicates if actual build is needed (false when cache restored)

**Workflows Using Checkpoints:**
1. binsuite.yml - Uses `setup-checkpoints` (binpress, binflate, binject jobs)
2. node-smol.yml - Uses `restore-checkpoint`
3. lief.yml - Uses `restore-checkpoint`
4. onnxruntime.yml - Uses `restore-checkpoint`
5. yoga-layout.yml - Uses `restore-checkpoint` (Docker-only, no native steps)
6. models.yml - Uses `restore-checkpoint` (Docker-only, no native steps)
7. curl.yml - No checkpoint caching
8. stubs.yml - No checkpoint caching for native builds

**Expected Pattern:**
Installation steps should check `build-required` before running:
```yaml
- name: Install CMake (Windows)
  if: steps.setup-checkpoints.outputs.build-required == 'true' && matrix.os == 'windows'
  run: choco install cmake -y
```

Or the full cache validation pattern:
```yaml
- name: Setup build toolchain (macOS)
  if: |
    matrix.os == 'macos' &&
    ((steps.lief-checkpoint-cache.outputs.cache-hit != 'true' || steps.validate-cache.outputs.valid == 'false') ||
    steps.restore-checkpoint.outputs.build-required == 'true')
  run: brew install cmake ccache
```
</context>

<instructions>
Systematically verify all workflows that use checkpoint caching properly optimize installation steps:

**Step 1: Identify workflows with checkpoint caching**
```bash
grep -l "restore-checkpoint\|setup-checkpoints" .github/workflows/*.yml
```

**Step 2: For each workflow, check:**
1. Which checkpoint action is used (`restore-checkpoint` or `setup-checkpoints`)
2. Identify ALL installation/setup steps:
   - Steps with names: "Install", "Setup", "Select Xcode"
   - Steps running: `choco install`, `apt-get install`, `brew install`, `xcode-select`
   - Steps downloading tools: llvm-mingw downloads, toolchain downloads

**Step 3: Verify each installation step has correct condition:**
- For `setup-checkpoints`: `steps.setup-checkpoints.outputs.build-required == 'true'`
- For `restore-checkpoint`: `steps.restore-checkpoint.outputs.build-required == 'true'`
- OR full cache check: `(cache-hit != 'true' || valid == 'false') || build-required == 'true'`

**Step 4: Exceptions (steps that should NOT check build-required):**
- pnpm/Node.js setup (needed to run build scripts)
- QEMU/Docker setup for testing (not build dependencies)
- Depot CLI setup (needed for Docker builds)
- Steps in workflows without checkpoint caching

<pattern name="missing_build_required_check">
Installation step runs unconditionally even when cache is restored:
```yaml
# BAD - no build-required check
- name: Install CMake (Windows)
  if: matrix.os == 'windows'
  run: choco install cmake -y

# GOOD - checks build-required
- name: Install CMake (Windows)
  if: steps.setup-checkpoints.outputs.build-required == 'true' && matrix.os == 'windows'
  run: choco install cmake -y
```

Look for steps that:
- Install compilers (gcc, clang, MinGW, llvm-mingw)
- Install build tools (cmake, ninja, make, ccache)
- Setup toolchains (musl-tools, cross-compilers)
- Select Xcode versions
- Download toolchain archives
</pattern>

<pattern name="wrong_checkpoint_reference">
Step references wrong checkpoint action output:
```yaml
# BAD - binsuite.yml uses setup-checkpoints, not restore-checkpoint
- name: Install tools
  if: steps.restore-checkpoint.outputs.build-required == 'true'

# GOOD - correct reference
- name: Install tools
  if: steps.setup-checkpoints.outputs.build-required == 'true'
```

socket-btm conventions:
- binsuite.yml (binpress/binflate/binject): Use `steps.setup-checkpoints.outputs.build-required`
- node-smol.yml, lief.yml, onnxruntime.yml: Use `steps.restore-checkpoint.outputs.build-required`
</pattern>

<pattern name="incomplete_condition">
Step checks some conditions but misses build-required:
```yaml
# BAD - checks platform but not build-required
- name: Setup toolchain (Windows ARM64)
  if: matrix.os == 'windows' && matrix.cross_compile
  run: |
    curl -o llvm-mingw.zip https://...
    7z x llvm-mingw.zip

# GOOD - includes build-required check
- name: Setup toolchain (Windows ARM64)
  if: |
    matrix.os == 'windows' && matrix.cross_compile &&
    ((steps.cache.outputs.cache-hit != 'true' || steps.validate.outputs.valid == 'false') ||
    steps.restore-checkpoint.outputs.build-required == 'true')
```
</pattern>

**socket-btm-Specific Workflow Patterns:**

1. **binsuite.yml** (binpress, binflate, binject jobs):
   - Uses: `setup-checkpoints` action
   - Steps to check: Compiler setup, dependency installation, toolchain setup, Xcode selection, CMake installation

2. **node-smol.yml**:
   - Uses: `restore-checkpoint` action
   - Steps to check: musl toolchain, Xcode selection, Windows tools, compression dependencies

3. **lief.yml**:
   - Uses: `restore-checkpoint` action with full cache validation
   - Steps to check: macOS toolchain (brew install cmake ccache), Windows toolchains

4. **onnxruntime.yml**:
   - Uses: `restore-checkpoint` action
   - Steps to check: Build tools installation (ninja-build)

For each issue found:
1. Identify the workflow file and line number
2. Show the current condition
3. Explain why build-required check is missing or incorrect
4. Provide the corrected condition
5. Estimate time savings from the fix
</instructions>

<output_format>
For each finding, report:

File: .github/workflows/workflow-name.yml:line
Issue: Installation step missing build-required check
Severity: Medium
Impact: Wastes N seconds/minutes installing tools when cache is restored
Pattern: [current condition]
Fix: [corrected condition with build-required check]
Savings: Estimated ~N seconds per cached CI run

Example:
File: .github/workflows/lief.yml:310
Issue: macOS toolchain setup missing build-required check
Severity: Medium
Impact: Wastes 30-60 seconds installing cmake/ccache when LIEF is restored from cache
Pattern: `if: matrix.os == 'macos'`
Fix: `if: matrix.os == 'macos' && ((steps.lief-checkpoint-cache.outputs.cache-hit != 'true' || steps.validate-cache.outputs.valid == 'false') || steps.restore-checkpoint.outputs.build-required == 'true')`
Savings: ~45 seconds per cached macOS CI run
</output_format>

<quality_guidelines>
- Only report installation/setup steps that install tools needed for building
- Don't report steps needed for running build scripts (pnpm, Node.js)
- Verify the checkpoint action type before suggesting fix
- Calculate realistic time savings based on actual tool installation times
- If all workflows are optimized, state that explicitly
- Group findings by workflow file
</quality_guidelines>

Systematically analyze all workflows with checkpoints and report all missing optimizations. If workflows are fully optimized, state: "✓ All workflows properly optimize installation steps with build-required checks."
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

**CRITICAL: For third-party library versions (LIEF, Node.js, ONNX Runtime, etc.):**
- DO NOT blindly "correct" documented versions without verification
- For socket-btm specifically, versions must align with what Node.js upstream uses
- LIEF version: Documented version (v0.17.0) is correct - aligned with Node.js needs
- Node.js version: Check .node-version file (source of truth)
- ONNX Runtime, Yoga: Verify against package configurations
- If unsure about a version, SKIP reporting it as incorrect - ask user to verify
- NEVER change version numbers based on git describe output from dependencies
- When in doubt, assume documentation is correct unless you can definitively verify otherwise
</pattern>

<pattern name="missing_documentation">
Look for:
- Public APIs/exports not documented in README
- Important environment variables not documented
- New features added but not documented
- Critical sections (75%+ of package) not mentioned
</pattern>

<pattern name="junior_dev_friendliness">
**CRITICAL: Evaluate documentation from a junior developer perspective**

Check for junior-developer unfriendly patterns:
- Missing "Why" explanations (e.g., "Use binject to inject SEA" without explaining what SEA is)
- Assumed knowledge not documented (Node.js SEA, LIEF, VFS concepts)
- No examples for common workflows (first-time setup, typical usage)
- Missing troubleshooting sections
- No explanation of error messages
- Complex architecture diagrams without beginner-friendly overview
- Technical jargon without definitions/links
- Missing prerequisites or setup instructions
- No "Getting Started" or "Quick Start" section
- Undocumented debugging techniques

**Pay special attention to:**
1. **Root README.md** - First thing junior devs see, must be welcoming and clear
2. **Package READMEs** - Should explain purpose, use cases, and provide examples
3. **CLAUDE.md** - Project guidelines must be understandable by junior contributors
4. **Build/setup docs** - Critical for onboarding, must be step-by-step
5. **Error message handling** - Should help debug, not confuse

**Areas requiring extra scrutiny:**
- Binary manipulation concepts (SEA, VFS, section injection)
- Build system complexity (checkpoints, caching, cross-compilation)
- Patch management (upstream sync, patch regeneration)
- C/C++ integration points (LIEF, native code)
- Cross-platform differences (Linux musl/glibc, macOS universal binaries, Windows)

For each junior-dev issue:
- Identify the knowledge gap or assumption
- Explain why this is confusing for juniors
- Suggest specific documentation additions (not just "add more docs")
- Provide example of clear explanation

Example findings:
- "README assumes knowledge of Node.js SEA without explaining it"
- "No explanation of what 'upstream sync' means or why it matters"
- "Technical term 'checkpoint caching' used without definition"
- "Build errors not documented in troubleshooting section"
</pattern>

For each issue found:
1. Read the documented information
2. Read the actual code/config to verify
3. Determine the discrepancy
4. Provide the correct information
5. Evaluate junior developer friendliness
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

**Junior Developer Friendliness Examples:**

Example:
File: README.md:1-50
Issue: Missing beginner-friendly introduction explaining project purpose
Severity: High
Pattern: Jumps directly to technical architecture without explaining what socket-btm is or why it exists
Actual: Junior devs need context: "What is BTM?", "Why custom Node.js?", "When would I use this?"
Fix: Add "What is Socket BTM?" section explaining: (1) Custom Node.js with Socket Security patches, (2) Minimal builds for production, (3) Use cases (CLI tools, serverless, containers)
Impact: Junior devs confused about project purpose, may not understand if they need it

Example:
File: packages/binject/README.md:15
Issue: Assumes knowledge of Node.js SEA without explanation
Severity: Medium
Pattern: "Injects SEA blobs into Node.js binaries"
Actual: Junior devs don't know what SEA is or why injection is needed
Fix: Add: "Single Executable Application (SEA) - bundles your app into a standalone binary. binject handles the low-level binary manipulation to embed your code into Node.js executables."
Impact: Technical jargon barrier prevents junior devs from understanding tool purpose

Example:
File: packages/node-smol-builder/README.md:80
Issue: No troubleshooting section for common build errors
Severity: Medium
Pattern: Documentation shows happy path but no error handling guidance
Actual: Junior devs hit errors like "Patch failed to apply" or "Checkpoint extraction failed" with no guidance
Fix: Add "Troubleshooting" section covering: (1) Patch application failures → check upstream version, (2) Checkpoint errors → run clean, (3) Build timeouts → increase TIMEOUT_MS
Impact: Junior devs stuck when errors occur, need hand-holding for common issues

Example:
File: CLAUDE.md:125
Issue: Complex "Source of Truth Architecture" without visual diagram or simple explanation
Severity: Medium
Pattern: Dense text explaining package relationships and sync direction
Actual: Junior devs need visual representation and concrete examples to understand data flow
Fix: Add ASCII diagram showing: packages/build-infra → additions/source-patched (one-way sync), plus example: "When you fix a bug in build-infra/debug_common.h, you must sync it to node-smol-builder/additions/"
Impact: Junior contributors may edit wrong files, creating wasted work

Example:
File: packages/binpress/README.md:1-100
Issue: Missing "Getting Started" section with minimal working example
Severity: High
Pattern: Extensive API documentation but no simple end-to-end example
Actual: Junior devs need: "How do I compress my first binary? Step 1, Step 2, Step 3"
Fix: Add "Quick Start" section: "(1) Build binpress: pnpm run build, (2) Compress a binary: ./build/dev/out/Final/binpress input.exe output.exe, (3) Verify: ls -lh output.exe"
Impact: Without concrete starting point, juniors struggle to use tool effectively
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
- **Pattern**: "Applies 15 patches to Node.js source"
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

