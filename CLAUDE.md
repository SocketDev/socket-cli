# CLAUDE.md

🚨 **MANDATORY**: Act as principal-level engineer with deep expertise in TypeScript, Node.js, and CLI development.

## 👤 USER CONTEXT

- **Identify users by git credentials**: Extract name from git commit author, GitHub account, or context
- 🚨 **When identity is verified**: ALWAYS use their actual name - NEVER use "the user" or "user"
- **Direct communication**: Use "you/your" when speaking directly to the verified user
- **Discussing their work**: Use their actual name when referencing their commits/contributions
- **Example**: If git shows "John-David Dalton <jdalton@example.com>", refer to them as "John-David"
- **Other contributors**: Use their actual names from commit history/context

## 📚 SHARED STANDARDS

**Canonical reference**: `../socket-registry/CLAUDE.md`

All shared standards (git, testing, code style, cross-platform, CI) defined in socket-registry/CLAUDE.md.

**Quick references**:
- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `<type>(<scope>): <description>` - NO AI attribution
- Scripts: Prefer `pnpm run foo --flag` over `foo:bar` scripts

---

## 📝 EMOJI & OUTPUT STYLE

**Terminal Symbols** (based on `@socketsecurity/lib/logger` LOG_SYMBOLS):
- ✓ Success/checkmark - MUST be green (NOT ✅)
- ✗ Error/failure - MUST be red (NOT ❌)
- ⚠ Warning/caution - MUST be yellow (NOT ⚠️)
- ℹ Info - MUST be blue (NOT ℹ️)

**Color Requirements** (apply color to icon ONLY, not entire message):
```javascript
import colors from 'yoctocolors-cjs'

`${colors.green('✓')} ${msg}`   // Success
`${colors.red('✗')} ${msg}`     // Error
`${colors.yellow('⚠')} ${msg}`  // Warning
`${colors.blue('ℹ')} ${msg}`    // Info
```

**Color Package**:
- Use `yoctocolors-cjs` (NOT `yoctocolors` ESM package)
- Pinned dev dependency in all Socket projects
- CommonJS compatibility for scripts and tooling

**Allowed Emojis** (use sparingly):
- 📦 Packages
- 💡 Ideas/tips
- 🚀 Launch/deploy/excitement
- 🎉 Major success/celebration

**General Philosophy**:
- Prefer colored text-based symbols (✓✗⚠ℹ) for maximum terminal compatibility
- Always color-code symbols: green=success, red=error, yellow=warning, blue=info
- Use emojis sparingly for emphasis and delight
- Avoid emoji overload - less is more
- When in doubt, use plain text

---

## 🏗️ CLI-SPECIFIC

### Commands
- **Build**: `npm run build` (alias for `npm run build:dist`)
- **Build source**: `npm run build:dist:src` or `pnpm build:dist:src`
- **Build types**: `npm run build:dist:types`
- **Test**: `npm run test` (runs check + all tests)
- **Test unit only**: `npm run test:unit` or `pnpm test:unit`
- **Lint**: `npm run lint` (uses eslint)
- **Type check**: `npm run type` (uses tsgo)
- **Check all**: `npm run check` (lint + typecheck)
- **Fix linting**: `npm run fix` (auto-fixes linting issues)
- **Commit without tests**: `git commit --no-verify` (skips pre-commit hooks including tests)

### Testing Best Practices
- **🚨 NEVER USE `--` BEFORE TEST FILE PATHS** - This runs ALL tests, not just your specified files!
- **Always build before testing**: Run `pnpm build:dist:src` before running tests to ensure dist files are up to date
- **Test single file**: ✅ CORRECT: `pnpm test:unit src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm test:unit -- src/commands/specific/cmd-file.test.mts` (runs ALL tests!)
- **Test multiple files**: ✅ CORRECT: `pnpm test:unit file1.test.mts file2.test.mts`
- **Test with pattern**: ✅ CORRECT: `pnpm test:unit src/commands/specific/cmd-file.test.mts -t "pattern"`
  - ❌ WRONG: `pnpm test:unit -- src/commands/specific/cmd-file.test.mts -t "pattern"`
- **Run E2E socket fix tests**: ✅ CORRECT: Run `pnpm run e2e-tests`
- **Update snapshots**:
  - All tests: `pnpm testu` (builds first, then updates all snapshots)
  - Single file: ✅ CORRECT: `pnpm testu src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm testu -- src/commands/specific/cmd-file.test.mts` (updates ALL snapshots!)
- **Update with --update flag**: `pnpm test:unit src/commands/specific/cmd-file.test.mts --update`
- **Timeout for long tests**: Use `timeout` command or specify in test file

### Running the CLI locally
- **Build and run**: `npm run build && npm exec socket` or `pnpm build && pnpm exec socket`
- **Quick build + run**: `npm run bs` or `pnpm bs` (builds source only, then runs socket)
- **Run without build**: `npm run s` or `pnpm s` (runs socket directly)
- **Native TypeScript**: `./sd` (runs the CLI without building using Node.js native TypeScript support on Node 22+)

### Unified Script Loader
The `scripts/load.mjs` file acts as both a module loader and a convenient script wrapper:

**As a wrapper (recommended):**
```bash
node scripts/load.mjs <script-name> [flags]
node scripts/load.mjs build-yao-pkg-node --clean
```

**As an import (also works):**
```bash
node --import=./scripts/load.mjs scripts/build-yao-pkg-node.mjs --clean
```

**Benefits:**
- Automatically applies alias loader for registry imports
- Enables `logger.substep()` and other enhanced logger methods
- Shorter, cleaner command syntax
- Script name with or without `.mjs` extension works

### CLI-Specific Notes
- **Dynamic imports**: Only use dynamic imports for test mocking (e.g., `vi.importActual` in Vitest). Avoid runtime dynamic imports in production code

### Custom Node.js Binary (yao-pkg Patched)
- **Testing yao-pkg binaries**: The custom-built Node.js binary has yao-pkg patches that modify argument handling
- **🚨 CRITICAL**: Always use `PKG_EXECPATH=PKG_INVOKE_NODEJS` when testing the binary directly
  - ✅ CORRECT: `PKG_EXECPATH=PKG_INVOKE_NODEJS .node-source/out/Release/node --version`
  - ❌ WRONG: `.node-source/out/Release/node --version` (treats `--version` as module path)
- **Why this happens**: yao-pkg's PKG_DUMMY_ENTRYPOINT behavior interprets the first argument as a module to load unless `PKG_EXECPATH=PKG_INVOKE_NODEJS` is set
- **Build script wrapper**: The build script automatically sets this environment variable when testing binaries
- **Binary locations**:
  - `.node-source/out/Release/node` - Main build output (stripped, signed)
  - `build/out/Release/node` - Copy for distribution

### Socket Node.js Patches

Socket CLI applies custom patches to Node.js during the yao-pkg build process. These patches enable critical functionality like Brotli compression, SEA support, and size optimizations.

**🚨 CRITICAL REQUIREMENTS**:
- **Patches are the ONLY way to modify Node.js source** - Direct modifications to files are forbidden.
- **All patches MUST be created using git diff** against pristine Node.js source.
- **Patch failures MUST stop the build** - No fallbacks or workarounds allowed.
- **Each patch is considered critical** - All must apply cleanly or the build fails.

**Standard Patch Creation Process**:
1. Clone pristine source file from specific Node.js version.
2. Apply modifications (using Node.js script or manual editing).
3. Generate patch with `git diff --cached > patch-file`.
4. Validate with `patch -p1 --dry-run < patch-file`.
5. Add metadata header documenting creation process.
6. Final validation to ensure patch applies cleanly.

**Why This Process?**
- Pristine and reproducible - patches generated from clean upstream source.
- Format guaranteed - git diff produces properly formatted unified diffs.
- Validation built-in - each step includes verification.
- Documented - process embedded in patch headers for reference.

**📚 Detailed Documentation**: See `build/patches/socket/README.md` for complete patch creation guide, troubleshooting, and examples.

**📁 Patch Application**: Patches applied automatically by `scripts/build-yao-pkg-node.mjs` with validation before application.

## Architecture

This is a CLI tool for Socket.dev security analysis, built with TypeScript using .mts extensions.

### Core Structure
- **Entry point**: `src/cli.mts` - Main CLI entry with meow subcommands
- **Commands**: `src/commands.mts` - Exports all command definitions
- **Command modules**: `src/commands/*/` - Each feature has its own directory with cmd-*, handle-*, and output-* files
- **Utilities**: `src/utils/` - Shared utilities for API, config, formatting, etc.
- **Constants**: `src/constants.mts` - Application constants
- **Types**: `src/types.mts` - TypeScript type definitions

### Command Architecture Pattern
Each command follows a consistent pattern:
- `cmd-*.mts` - Command definition and CLI interface
- `handle-*.mts` - Business logic and processing
- `output-*.mts` - Output formatting (JSON, markdown, etc.)
- `fetch-*.mts` - API calls (where applicable)

### Key Command Categories
- **npm/npx wrapping**: `socket npm`, `socket npx` - Wraps npm/npx with security scanning
- **Scanning**: `socket scan` - Create and manage security scans
- **Organization management**: `socket organization` - Manage org settings and policies
- **Package analysis**: `socket package` - Analyze package scores
- **Optimization**: `socket optimize` - Apply Socket registry overrides
- **Configuration**: `socket config` - Manage CLI configuration

### Build System
- Uses Rollup for building distribution files
- TypeScript compilation with tsgo (preferred) or standard tsc
- Individual file compilation rather than bundling for better maintainability
- Multiple environment configs (.env.local, .env.test, .env.dist)
- Dual linting with oxlint and eslint
- Formatting with Biome

### Testing

Socket CLI uses Vitest for unit testing with comprehensive test helpers for consistent patterns.

#### Test Structure
- **Test helpers**: `test/helpers/` - Reusable test utilities
- **Command tests**: `src/commands/*/*.test.mts` - Tests co-located with command modules
- **Test utils**: `test/utils.mts`, `test/constants.mts` - Core test infrastructure
- **Fixtures**: `test/fixtures/` - Test data and mock files
- **Organization**: Tests organized by command area (organization, repository, scan, etc.)

#### Test Helpers
Socket CLI provides four categories of test helpers for consistent testing patterns:

1. **CLI Execution Helpers** (`test/helpers/cli-execution.mts` - 312 lines)
   - `executeCliCommand()` - Execute CLI with enhanced result handling
   - `expectCliSuccess()` - Expect successful command execution
   - `expectCliError()` - Expect command failure with specific exit code
   - `executeCliJson()` - Execute and parse JSON output automatically
   - `executeCliWithRetry()` - Execute with retry logic for transient failures
   - `executeBatchCliCommands()` - Execute multiple commands in sequence
   - `executeCliWithTiming()` - Execute with performance timing

2. **Output Assertions** (`test/helpers/output-assertions.mts` - 423 lines)
   - `expectOutput()` - Fluent API for output validation
   - `expectStdoutContainsAll()` - Validate multiple required strings
   - `expectOrderedPatterns()` - Validate patterns appear in order
   - `expectValidJson()` - Validate and parse JSON output
   - `expectLineCount()` - Validate output line count
   - `expectNoAnsiCodes()` - Validate plain text output
   - `expectTableStructure()` - Validate table-like structure

3. **Result Assertions** (`test/helpers/result-assertions.mts` - 418 lines)
   - `expectResult()` - Fluent API for CResult validation
   - `expectSuccess()` - Extract data from successful CResult
   - `expectFailure()` - Extract error from failed CResult
   - `expectFailureWithMessage()` - Validate error message and code
   - `expectAllSuccess()` - Validate array of results all succeeded
   - `extractSuccessData()` - Extract data from successful results
   - `extractErrorMessages()` - Extract error messages from failures

4. **Workspace Helpers** (`test/helpers/workspace-helper.mts` - 402 lines)
   - `createTestWorkspace()` - Create temporary test workspace
   - `withTestWorkspace()` - Auto-cleanup workspace pattern
   - `createWorkspaceWithLockfile()` - Create workspace with lockfiles (npm/pnpm/yarn)
   - `createMonorepoWorkspace()` - Create monorepo structure
   - `createWorkspaceWithSocketConfig()` - Create workspace with .socketrc.json
   - `setupPackageJson()` - Add dependencies to existing workspace

#### Usage Examples

**Before (without helpers):**
```typescript
describe('socket scan', () => {
  it('should execute scan', async () => {
    const binPath = path.join(__dirname, '../../bin/cli.js')
    const result = await spawn(process.execPath, [binPath, 'scan', '--json', '--config', '{}'])
    expect(result.code).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.id).toBeDefined()
    const cleanedStdout = stripAnsi(result.stdout.trim())
    expect(cleanedStdout).toContain('scan')
  })
})
```

**After (with helpers):**
```typescript
import { executeCliJson, expectOutput } from '../helpers/index.mts'

describe('socket scan', () => {
  it('should execute scan', async () => {
    const { data, result } = await executeCliJson<ScanResult>(['scan'])
    expectOutput(result).succeeded().stdoutContains('scan')
    expect(data.id).toBeDefined()
  })
})
```

**Benefits:**
- 70% fewer lines of code
- Automatic config isolation
- Built-in output cleaning
- Type-safe JSON parsing
- Fluent assertion API
- Better error messages

See `test/helpers/EXAMPLES.md` for comprehensive usage examples and `test/helpers/example-usage.test.mts` for working test demonstrations.

#### Running Tests
- **All tests**: `pnpm test`
- **Unit tests only**: `pnpm test:unit`
- **Specific file**: `pnpm test:unit src/commands/specific/cmd-file.test.mts`
  - **CRITICAL**: NEVER use `--` before test file paths (runs ALL tests instead!)
- **With pattern**: `pnpm test:unit src/commands/specific/cmd-file.test.mts -t "pattern"`
- **Update snapshots**: `pnpm testu` (all) or `pnpm testu <file>`
- **Coverage**: `pnpm run test:unit:coverage` (individual test coverage)
- **Coverage percentage**: `pnpm run coverage:percent`

#### Test Best Practices
- **Use `setupTestEnvironment()`** in `beforeEach` hooks for consistent test setup
- **Use helper factories**: `createSuccessResult()`, `createErrorResult()` for CResult patterns
- **Use `executeCliCommand()`** for CLI tests instead of raw spawn
- **Leverage fluent assertions**: Chain `expectOutput()` and `expectResult()` methods
- **Auto-cleanup workspaces**: Use `withTestWorkspace()` instead of manual cleanup
- **Isolate config**: All CLI commands automatically add `--config {}` to prevent user config pollution
- **Type safety**: Use generic types in `executeCliJson<T>()` and `expectResult<T>()`
- **Follow migrated patterns**: Reference existing test files for established patterns

#### Coverage Status
Coverage reporting available via:
- `pnpm run test:unit:coverage` - Run tests with coverage
- `pnpm run coverage:percent` - Display coverage percentage
- **Known Issue**: `pnpm run cover` currently broken due to import issues in `scripts/cover.mjs`
  - **Workaround**: Use `pnpm run test:unit:coverage` instead

### External Dependencies
- Bundles external dependencies in `external/` directory
- Uses Socket registry overrides for security
- Custom patches applied to dependencies in `patches/`

## Environment and Configuration

### Environment Files
- **`.env.local`** - Local development environment
- **`.env.test`** - Test environment configuration
- **`.env.testu`** - Test update environment
- **`.env.dist`** - Distribution build environment
- **`.env.external`** - External dependencies environment

### Configuration Files
- **`biome.json`** - Biome formatter and linter configuration
- **`vitest.config.mts`** - Vitest test runner configuration
- **`eslint.config.js`** - ESLint configuration
- **`tsconfig.json`** - Main TypeScript configuration
- **`tsconfig.dts.json`** - TypeScript configuration for type definitions
- **`knip.json`** - Knip unused code detection configuration

### Shadow Binaries
- **`shadow-bin/`** - Contains wrapper scripts for npm/npx commands
  - `shadow-bin/npm` - Wraps npm with Socket security scanning
  - `shadow-bin/npx` - Wraps npx with Socket security scanning
  - These enable `socket npm` and `socket npx` functionality

### Package Structure
- **Binary entries**: `socket`, `socket-npm`, `socket-npx` (in `bin/` directory)
- **Distribution**: Built files go to `dist/` directory
- **External dependencies**: Bundled in `external/` directory
- **Test fixtures**: Located in `test/fixtures/`

### Dependency Management
- Uses Socket registry overrides for enhanced alternatives
- Custom patches applied to dependencies via `custompatch`
- Overrides specified in package.json for enhanced alternatives

## Changelog Management

When updating the changelog (`CHANGELOG.md`):
- Version headers should be formatted as markdown links to GitHub releases
- Use the format: `## [version](https://github.com/SocketDev/socket-cli/releases/tag/vversion) - date`
- Example: `## [1.0.80](https://github.com/SocketDev/socket-cli/releases/tag/v1.0.80) - 2025-07-29`
- This allows users to click version numbers to view the corresponding GitHub release

### Keep a Changelog Compliance
Follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format:
- Use standard sections: Added, Changed, Fixed, Removed (Security if applicable)
- Maintain chronological order with latest version first
- Include release dates in YYYY-MM-DD format
- Make entries human-readable, not machine diffs
- Focus on notable changes that impact users

**Exclude** internal changes like:
- Dependency updates (unless they fix security issues or add user features)
- Code refactoring and cleanup
- Internal constant reorganization
- Test snapshot updates
- Build system improvements
- Developer tooling changes
- Minor nits and formatting tweaks
- GitHub workflow and CI/CD changes
- Third-party integration updates (unless they add user-visible features)


### Content Guidelines
Focus on **user-facing changes** only. Include:
- **Added**: New features, commands, flags, or capabilities users can access
- **Changed**: Modifications to existing behavior that users will notice
- **Fixed**: Bug fixes that resolve user-reported issues or improve functionality
- **Removed**: Features, flags, or commands that are no longer available

### Writing Style
Use a **marketing voice** that emphasizes user benefits while staying **concise**:
- Focus on what users can accomplish rather than technical implementation
- Highlight improvements in user experience and productivity
- Use active, positive language that showcases value
- Keep entries brief - users need to find information quickly
- Example: Instead of "Added flag X", write "Enhanced security scanning with new X option"

### Third-Party Integrations

Socket CLI integrates with various third-party tools and services:
- **@coana-tech/cli**: Static analysis tool for reachability analysis and vulnerability detection
- **cdxgen**: CycloneDX BOM generator for creating software bill of materials
- **synp**: Tool for converting between yarn.lock and package-lock.json formats

## 🔧 Git & Workflow

### GitHub Actions Guidelines
- **🚨 MANDATORY**: All GitHub Actions MUST reference commit SHAs, not version tags
- **Security requirement**: SocketDev repositories require pinned commit hashes for supply chain security
- **🚨 MANDATORY**: Reusable workflows MUST be created in `socket-registry/.github/workflows/`, NOT in individual project repositories
- **Workflow location**: Individual projects should reference workflows from `SocketDev/socket-registry/.github/workflows/`
- **Standard action SHAs** (keep these updated across all Socket projects):
  - `actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8` (v5.0.0)
  - `pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda` (v4.1.0)
  - `actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444` (v5.0.0)
  - `actions/upload-artifact@50769540e7f4bd5e21e526ee35c689e35e0d6874` (v4.4.0)
- **Format**: Always include version comment: `uses: owner/repo@sha # vX.Y.Z`
- **Examples**:
  - ✅ CORRECT: `uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0`
  - ✅ CORRECT: `uses: SocketDev/socket-registry/.github/workflows/test.yml@main`
  - ❌ FORBIDDEN: `uses: actions/checkout@v4` or `uses: actions/checkout@v5`
  - ❌ FORBIDDEN: `uses: ./.github/workflows/_reusable-test.yml` (reusable workflows belong in socket-registry)
- **Allowed actions**: Either SocketDev-owned or pinned by SHA from trusted sources
- **Cross-project consistency**: Maintain identical SHAs across all Socket projects

### CI Workflow Strategy
- **🚨 MANDATORY**: Use the centralized `ci.yml` reusable workflow from socket-registry
- **Workflow location**: `SocketDev/socket-registry/.github/workflows/ci.yml@main`
- **Benefits**: Consistent CI strategy across all Socket projects, parallel execution of lint/type-check/test/coverage
- **Configuration**: Customize via workflow inputs (scripts, node versions, OS versions, timeouts, etc.)
- **Standard configuration pattern**:
  ```yaml
  jobs:
    ci:
      name: Run CI Pipeline
      uses: SocketDev/socket-registry/.github/workflows/ci.yml@main
      with:
        coverage-script: 'pnpm run test:unit:coverage'
        coverage-report-script: 'pnpm run coverage:percent --json'
        fail-fast: false
        lint-script: 'pnpm run check-ci'
        node-versions: '[20, 22, 24]'
        os-versions: '["ubuntu-latest", "windows-latest"]'
        test-script: 'pnpm run test-ci'
        test-setup-script: 'pnpm run build'
        type-check-script: 'pnpm run type'
        type-check-setup-script: 'pnpm run build'
  ```
- **Orchestration**: CI workflow orchestrates lint.yml, types.yml, test.yml, and coverage reporting
- **Individual workflows**: Keep lint.yml, types.yml, test.yml for targeted runs; ci.yml runs all together
- **Cross-project consistency**: All Socket projects should use identical CI orchestration pattern

## 🔧 Code Style (MANDATORY)

### 📁 File Organization
- **File extensions**: Use `.mts` for TypeScript module files
- **Import order**: Node.js built-ins first, then third-party packages, then local imports
- **Import grouping**: Group imports by source (Node.js, external packages, local modules)
- **Node.js path module**: 🚨 ALWAYS import path as namespace `import path from 'node:path'`, NEVER cherry-pick individual functions
  - ✅ CORRECT: `import path from 'node:path'` then use `path.join()`, `path.dirname()`, `path.basename()`
  - ❌ FORBIDDEN: `import { join, dirname, basename } from 'node:path'`
  - **Rationale**: Namespace imports are clearer, prevent naming conflicts, and make it obvious where utilities come from
- **Type imports**: 🚨 ALWAYS use separate `import type` statements for TypeScript types, NEVER mix runtime imports with type imports in the same statement
  - ✅ CORRECT: `import { readPackageJson } from '@socketsecurity/registry/lib/packages'` followed by `import type { PackageJson } from '@socketsecurity/registry/lib/packages'`
  - ❌ FORBIDDEN: `import { readPackageJson, type PackageJson } from '@socketsecurity/registry/lib/packages'`

### Naming Conventions
- **Constants**: Use `UPPER_SNAKE_CASE` for constants (e.g., `CMD_NAME`, `REPORT_LEVEL`)
- **Files**: Use kebab-case for filenames (e.g., `cmd-scan-create.mts`, `handle-create-new-scan.mts`)
- **Variables**: Use camelCase for variables and functions

### 🏗️ Code Structure (CRITICAL PATTERNS)
- **Command pattern**: 🚨 MANDATORY - Each command MUST have `cmd-*.mts`, `handle-*.mts`, and `output-*.mts` files
- **Type definitions**: 🚨 ALWAYS use `import type` for better tree-shaking
- **Flags**: 🚨 MUST use `MeowFlags` type with descriptive help text
- **Error handling**: 🚨 REQUIRED - Use custom error types `AuthError` and `InputError`
- **Array destructuring**: Use object notation `{ 0: key, 1: data }` instead of array destructuring `[key, data]`
- **Dynamic imports**: 🚨 FORBIDDEN - Never use dynamic imports (`await import()`). Always use static imports at the top of the file
- **Sorting**: 🚨 MANDATORY - Always sort lists, exports, and items in documentation headers alphabetically/alphanumerically for consistency
- **Comment formatting**: 🚨 MANDATORY - ALL comments MUST follow these rules:
  - **Periods required**: Every comment MUST end with a period, except ESLint disable comments and URLs which are directives/references. This includes single-line, multi-line, inline, and c8 ignore comments.
  - **Sentence structure**: Comments should be complete sentences with proper capitalization and grammar.
  - **Placement**: Place comments on their own line above the code they describe, not trailing to the right of code.
  - **Style**: Use fewer hyphens/dashes and prefer commas, colons, or semicolons for better readability.
  - **Examples**:
    - ✅ CORRECT: `// This function validates user input.`
    - ✅ CORRECT: `/* This is a multi-line comment that explains the complex logic below. */`
    - ✅ CORRECT: `// eslint-disable-next-line no-await-in-loop` (directive, no period)
    - ✅ CORRECT: `// See https://example.com/docs` (URL reference, no period)
    - ✅ CORRECT: `// c8 ignore start - Reason for ignoring.` (explanation has period)
    - ❌ WRONG: `// this validates input` (no period, not capitalized)
    - ❌ WRONG: `const x = 5 // some value` (trailing comment)
- **Await in loops**: When using `await` inside for-loops, add `// eslint-disable-next-line no-await-in-loop` to suppress the ESLint warning when sequential processing is intentional
- **If statement returns**: Never use single-line return if statements; always use proper block syntax with braces
- **List formatting**: Use `-` for bullet points in text output, not `•` or other Unicode characters, for better terminal compatibility
- **Existence checks**: Perform simple existence checks first before complex operations
- **Destructuring order**: Sort destructured properties alphabetically in const declarations
- **Function ordering**: Place functions in alphabetical order, with private functions first, then exported functions
- **GitHub API calls**: Use Octokit instances from `src/utils/github.mts` (`getOctokit()`, `getOctokitGraphql()`) instead of raw fetch calls for GitHub API interactions
- **Object mappings**: Use objects with `__proto__: null` (not `undefined`) for static string-to-string mappings and lookup tables to prevent prototype pollution; use `Map` for dynamic collections that will be mutated
- **Mapping constants**: Move static mapping objects outside functions as module-level constants with descriptive UPPER_SNAKE_CASE names
- **Array length checks**: Use `!array.length` instead of `array.length === 0`. For `array.length > 0`, use `!!array.length` when function must return boolean, or `array.length` when used in conditional contexts
- **Catch parameter naming**: Use `catch (e)` instead of `catch (error)` for consistency across the codebase
- **Node.js fs imports**: 🚨 MANDATORY pattern - `import { someSyncThing, promises as fs } from 'node:fs'`
- **Process spawning**: 🚨 FORBIDDEN to use Node.js built-in `child_process.spawn` - MUST use `spawn` from `@socketsecurity/registry/lib/spawn`
- **Number formatting**: 🚨 REQUIRED - Use underscore separators (e.g., `20_000`) for large numeric literals. 🚨 FORBIDDEN - Do NOT modify number values inside strings

### Error Handling
- **Input validation errors**: Use `InputError` from `src/utils/errors.mts` for user input validation failures (missing files, invalid arguments, etc.)
- **Authentication errors**: Use `AuthError` from `src/utils/errors.mts` for API authentication issues
- **CResult pattern**: Use `CResult<T>` type for functions that can fail, following the Result/Either pattern with `ok: true/false`
- **Process exit**: Avoid `process.exit(1)` unless absolutely necessary; prefer throwing appropriate error types that the CLI framework handles
- **Error messages**: Write clear, actionable error messages that help users understand what went wrong and how to fix it
- **Examples**:
  - ✅ `throw new InputError('No .socket directory found in current directory')`
  - ✅ `throw new AuthError('Invalid API token')`
  - ❌ `logger.error('Error occurred'); return` (doesn't set proper exit code)
  - ❌ `process.exit(1)` (bypasses error handling framework)

### 🗑️ Safe File Operations (SECURITY CRITICAL)
- **Script usage only**: Use `trash` package ONLY in scripts, build files, and utilities - NOT in `/src/` files
- **Import and use `trash` package**: `import { trash } from 'trash'` then `await trash(paths)` (scripts only)
- **Source code deletion**: In `/src/` files, use `fs.rm()` with proper error handling when deletion is required
- **Script deletion operations**: Use `await trash()` for scripts, build processes, and development utilities
- **Array optimization**: `trash` accepts arrays - collect paths and pass as array
- **Async requirement**: Always `await trash()` - it's an async operation
- **NO rmSync**: 🚨 ABSOLUTELY FORBIDDEN - NEVER use `fs.rmSync()` or `rm -rf` commands
- **Examples**:
  - ❌ CATASTROPHIC: `rm -rf directory` (permanent deletion - DATA LOSS RISK)
  - ❌ REPOSITORY DESTROYER: `rm -rf "$(pwd)"` (deletes entire repository)
  - ❌ FORBIDDEN: `fs.rmSync(tmpDir, { recursive: true, force: true })` (dangerous)
  - ✅ SCRIPTS: `await trash([tmpDir])` (recoverable deletion in build scripts)
  - ✅ SOURCE CODE: `await fs.rm(tmpDir, { recursive: true, force: true })` (when needed in /src/)
- **Why scripts use trash**: Enables recovery from accidental deletions during development and build processes
- **Why source avoids trash**: Bundling complications and dependency management issues in production code

### Debugging and Troubleshooting
- **CI vs Local Differences**: CI uses published npm packages, not local versions. Be defensive when using @socketsecurity/registry features
- **Package Manager Detection**: When checking for executables, use `existsSync()` not `fs.access()` for consistency

### Formatting
- **Linting**: Uses ESLint with TypeScript support and import/export rules
- **Formatting**: Uses Biome for code formatting with 2-space indentation
- **Line length**: Target 80 character line width where practical

### Test Coverage
- All `c8 ignore` comments MUST include a reason why the code is being ignored
- All c8 ignore comments MUST end with periods for consistency
- Format: `// c8 ignore start - Reason for ignoring.`
- Example: `// c8 ignore start - Internal helper functions not exported.`
- This helps maintain clarity about why certain code paths aren't tested

## 📝 SCRATCH DOCUMENTS

### Working Documents Directory
- **Location**: `.claude/` directory (gitignored)
- **Purpose**: Store scratch documents, planning notes, analysis reports, and temporary documentation
- **🚨 CRITICAL**: NEVER commit files in `.claude/` to version control
- **Examples of scratch documents**:
  - Working notes and implementation plans
  - Analysis reports from codebase investigations
  - Temporary documentation and TODO lists
  - Any files not intended for production use

**Git Workflow Reminder**: When user says "commit changes" → create actual commits, use small atomic commits, follow all CLAUDE.md rules (NO AI attribution).

---

# 🚨 CRITICAL BEHAVIORAL REQUIREMENTS

## 🔍 Pre-Action Protocol
- **🚨 MANDATORY**: Before taking ANY action, ALWAYS review and verify compliance with CLAUDE.md guidelines
- **Check before you act**: Read relevant sections of this file to ensure your approach follows established patterns
- **No exceptions**: This applies to all tasks, including code changes, commits, documentation, testing, and file operations
- **When in doubt**: If unclear about the right approach, consult CLAUDE.md first before proceeding

## 🎯 Principal Engineer Mindset
- Act with the authority and expertise of a principal-level software engineer
- Make decisions that prioritize long-term maintainability over short-term convenience
- Anticipate edge cases and potential issues before they occur
- Write code that other senior engineers would be proud to review
- Take ownership of technical decisions and their consequences

## 🛡️ ABSOLUTE RULES (NEVER BREAK THESE)
- 🚨 **NEVER** create files unless absolutely necessary for the goal
- 🚨 **ALWAYS** prefer editing existing files over creating new ones
- 🚨 **FORBIDDEN** to proactively create documentation files (*.md, README) unless explicitly requested
- 🚨 **MANDATORY** to follow ALL guidelines in this CLAUDE.md file without exception
- 🚨 **REQUIRED** to do exactly what was asked - nothing more, nothing less

## 🎯 Quality Standards
- Code MUST pass all existing lints and type checks
- Changes MUST maintain backward compatibility unless explicitly breaking changes are requested
- All patterns MUST follow established codebase conventions
- Error handling MUST be robust and user-friendly
- Performance considerations MUST be evaluated for any changes
