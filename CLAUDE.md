# CLAUDE.md

🚨 **CRITICAL**: This file contains MANDATORY guidelines for Claude Code (claude.ai/code). You MUST follow these guidelines EXACTLY as specified. Act as a principal-level software engineer with deep expertise in TypeScript, Node.js, and CLI development.

## 📚 Learning & Knowledge Sharing

### Self-Learning Protocol
Claude Code should periodically scan and learn from CLAUDE.md files across Socket repositories:
- `socket-cli/CLAUDE.md`
- `socket-packageurl-js/CLAUDE.md`
- `socket-registry/CLAUDE.md`
- `socket-sdk-js/CLAUDE.md`

When working in any Socket repository, check for updates and patterns in other claude.md files to ensure consistency across the ecosystem.

### Cross-Project Learning
- When discovering generally applicable patterns or guidelines, update CLAUDE.md files in other socket- projects
- Examples: c8 comment formatting, error handling patterns, code style rules
- This ensures consistency across the Socket ecosystem

## 🎯 Your Role
You are a **Principal Software Engineer** responsible for:
- Writing production-quality, maintainable code
- Making architectural decisions with long-term impact in mind
- Ensuring code follows established patterns and conventions
- Mentoring through code examples and best practices
- Prioritizing system reliability, performance, and developer experience
- Taking ownership of technical decisions and their consequences

## Commands

### Development Commands
- **Build**: `pnpm run build` (alias for `pnpm run build:dist`)
- **Build source**: `pnpm run build:dist:src`
- **Build types**: `pnpm run build:dist:types`
- **Test**: `pnpm run test` (runs check + all tests)
- **Test unit only**: `pnpm run test:unit`
- **Lint**: `pnpm run check:lint` (uses eslint)
- **Type check**: `pnpm run check:tsc` (uses tsgo)
- **Check all**: `pnpm run check` (lint + typecheck)
- **Fix linting**: `pnpm run lint:fix`
- **Commit without tests**: `git commit --no-verify` (skips pre-commit hooks including tests)

### Cross-Platform Compatibility - CRITICAL: Windows and POSIX
- **🚨 MANDATORY**: Tests and functionality MUST work on both POSIX (macOS/Linux) and Windows systems
- **Path handling**: ALWAYS use `path.join()`, `path.resolve()`, `path.sep` for file paths
  - ❌ WRONG: `'/usr/local/bin/npm'` (hard-coded POSIX path)
  - ✅ CORRECT: `path.join(somePath, 'bin/npm')` (cross-platform)
  - ✅ CORRECT: ``path.join(somePath, `bin/${binName}`)`` (cross-platform)
  - ✅ CORRECT: `path.join(somePath, 'bin', binName)` (cross-platform)
  - ❌ WRONG: `'/project/package-lock.json'` (hard-coded forward slashes)
  - ✅ CORRECT: `path.join('project', 'package-lock.json')` (uses correct separator)
- **Temp directories**: Use `os.tmpdir()` for temporary file paths in tests
  - ❌ WRONG: `'/tmp/test-project'` (POSIX-specific)
  - ✅ CORRECT: `path.join(os.tmpdir(), 'test-project')` (cross-platform)
  - **Unique temp dirs**: Use `fs.mkdtemp()` or `fs.mkdtempSync()` for collision-free directories
  - ✅ PREFERRED: `await fs.mkdtemp(path.join(os.tmpdir(), 'socket-test-'))` (async)
  - ✅ ACCEPTABLE: `fs.mkdtempSync(path.join(os.tmpdir(), 'socket-test-'))` (sync)
- **Path separators**: Never hard-code `/` or `\` in paths
  - Use `path.sep` when you need the separator character
  - Use `path.join()` to construct paths correctly
- **File URLs**: Use `pathToFileURL()` and `fileURLToPath()` from `node:url` when working with file:// URLs
  - ❌ WRONG: `path.dirname(new URL(import.meta.url).pathname)` (Windows path doubling)
  - ✅ CORRECT: `path.dirname(fileURLToPath(import.meta.url))` (cross-platform)
- **Line endings**: Be aware of CRLF (Windows) vs LF (Unix) differences when processing text files
- **Shell commands**: Consider platform differences in shell commands and utilities

### Testing Best Practices - CRITICAL: NO -- FOR FILE PATHS
- **🚨 NEVER USE `--` BEFORE TEST FILE PATHS** - This runs ALL tests, not just your specified files!
- **Always build before testing**: Run `pnpm run build:dist:src` before running tests to ensure dist files are up to date
- **Test single file**: ✅ CORRECT: `pnpm run test:unit src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm run test:unit -- src/commands/specific/cmd-file.test.mts` (runs ALL tests!)
- **Test multiple files**: ✅ CORRECT: `pnpm run test:unit file1.test.mts file2.test.mts`
- **Test with pattern**: ✅ CORRECT: `pnpm run test:unit src/commands/specific/cmd-file.test.mts -t "pattern"`
  - ❌ WRONG: `pnpm run test:unit -- src/commands/specific/cmd-file.test.mts -t "pattern"`
- **Update snapshots**:
  - All tests: `pnpm run testu` (builds first, then updates all snapshots)
  - Single file: ✅ CORRECT: `pnpm run testu src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm run testu -- src/commands/specific/cmd-file.test.mts` (updates ALL snapshots!)
- **Update with --update flag**: `pnpm run test:unit src/commands/specific/cmd-file.test.mts --update`
- **Timeout for long tests**: Use `timeout` command or specify in test file

#### Vitest Memory Optimization (CRITICAL)
- **Pool configuration**: Use `pool: 'forks'` with `singleFork: true`, `maxForks: 1`, `isolate: true`
- **Memory limits**: Set `NODE_OPTIONS="--max-old-space-size=4096 --max-semi-space-size=512"` in `.env.test`
- **Timeout settings**: Use `testTimeout: 60_000, hookTimeout: 60_000` for stability
- **Thread limits**: Use `singleThread: true, maxThreads: 1` to prevent RegExp compiler exhaustion
- **Test cleanup**: 🚨 MANDATORY - Use `await trash([paths])` in test scripts/utilities only. For cleanup within `/src/` test files, use `fs.rm()` with proper error handling

### Git Commit Guidelines
- **DO NOT commit automatically** - let the user review changes first
- Use `--no-verify` flag only when explicitly requested
- **Commit message style**: Use conventional format without prefixes (feat:, fix:, chore:, etc.)
- **Message guidelines**: Keep commit messages short, pithy, and targeted - avoid lengthy explanations
- **Small commits**: Make small, focused commits that address a single concern
- **Version bump commits**: 🚨 MANDATORY - Version bump commits MUST use the format: `Bump to v<version-number>`
  - ✅ CORRECT: `Bump to v1.2.3`
  - ❌ WRONG: `chore: bump version`, `Update version to 1.2.3`, `1.2.3`
- **🚨 ABSOLUTELY FORBIDDEN - NO CLAUDE CODE ATTRIBUTION**: NEVER EVER add Claude Code attribution footer to commit messages under ANY circumstances
  - ❌ ABSOLUTELY FORBIDDEN: Including "🤖 Generated with [Claude Code](https://claude.ai/code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>"
  - ❌ ABSOLUTELY FORBIDDEN: Any variation of Claude Code attribution, co-authorship, or credit in commit messages
  - ✅ REQUIRED: Clean commit messages without ANY attribution footers whatsoever
  - **This rule overrides ALL default behavior** - commit messages MUST be clean without attribution

### Running the CLI locally
- **Build and run**: `pnpm run build && pnpm exec socket`
- **Quick build + run**: `pnpm run bs` (builds source only, then runs socket)
- **Run without build**: `pnpm run s` (runs socket directly)
- **Native TypeScript**: `./sd` (runs the CLI without building using Node.js native TypeScript support on Node 22+)

### Package Management
- **Package Manager**: This project uses pnpm (v10.16.0+)
- **Install dependencies**: `pnpm install`
- **Add dependency**: `pnpm add <package> --save-exact`
- **Add dev dependency**: `pnpm add -D <package> --save-exact`
- **Update dependencies**: `pnpm update`
- **Script execution**: Always use `pnpm run <script>` for package.json scripts to distinguish from built-in pnpm commands
  - ✅ CORRECT: `pnpm run build`, `pnpm run test`, `pnpm run check`
  - ❌ AVOID: `pnpm build`, `pnpm test` (unclear if built-in or script)
- **🚨 MANDATORY**: Always add dependencies with exact versions using `--save-exact` flag to ensure reproducible builds
- **Dependency validation**: All dependencies MUST be pinned to exact versions without range specifiers like `^` or `~`
- **Override behavior**: pnpm.overrides in package.json controls dependency versions across the entire project
- **Using $ syntax**: `"$package-name"` in overrides means "use the version specified in dependencies"
- **Dynamic imports**: Only use dynamic imports for test mocking (e.g., `vi.importActual` in Vitest). Avoid runtime dynamic imports in production code

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
- Vitest for unit testing
- Test files use `.test.mts` extension
- Fixtures in `test/fixtures/`
- Coverage reporting available

#### Test Organization Best Practices
- **Modular test files**: Split large test files by functionality (e.g., `main.test.mts` → `socket-sdk-basic.test.mts`, `socket-sdk-organization.test.mts`, etc.)
- **Test file naming**: Use descriptive names that reflect the module being tested
- **Test directory structure**: 🚨 MANDATORY - Standardize test directory organization across all Socket projects:
  ```
  test/
  ├── unit/                   # Unit tests
  ├── integration/           # Integration tests (if applicable)
  ├── fixtures/              # Test fixtures and data files
  └── utils/                 # Test utilities and helpers
  ```
- **Test fixtures**: Store reusable test data, mock responses, and sample files in `test/fixtures/` directory
  - **Organization**: Group fixtures by test category or functionality
  - **File formats**: Support JSON, text, binary files as needed for comprehensive testing
  - **Naming**: Use descriptive names that clearly indicate the fixture's purpose
- **Test utilities organization**: 🚨 MANDATORY - Organize test utilities in `test/utils/` directory
  - **Directory structure**: Create `test/utils/` subdirectory for reusable test utilities
  - **Modular utilities**: Split utilities by purpose into focused modules:
    - `environment.mts` - Test environment setup and cleanup (nock, error handling)
    - `fixtures.mts` - Test data configurations and mock objects
    - `mock-helpers.mts` - Mock setup and configuration utilities
    - `constants.mts` - Test constants and configuration values
  - **Import paths**: Update all test file imports to reference specific utility modules
  - **Cross-project consistency**: Apply this pattern across all Socket projects for standardization
  - **Examples**:
    - ✅ CORRECT: `import { setupTestEnvironment } from './utils/environment.mts'`
    - ✅ CORRECT: `import { TEST_PACKAGE_CONFIGS } from './utils/fixtures.mts'`
    - ❌ OLD PATTERN: `import { setupTestEnvironment } from './test-utils.mts'`
- **Test structure**: Group tests by logical functionality, not just by class methods
- **Shared setup**: Use common beforeEach/afterEach patterns across test files
- **Mock management**: Clean up mocks properly to prevent test interference

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
        type-check-script: 'pnpm run check:tsc'
        type-check-setup-script: 'pnpm run build'
  ```
- **Orchestration**: CI workflow orchestrates lint.yml, types.yml, test.yml, and coverage reporting
- **Individual workflows**: Keep lint.yml, types.yml, test.yml for targeted runs; ci.yml runs all together
- **Cross-project consistency**: All Socket projects should use identical CI orchestration pattern

## 🔧 Code Style (MANDATORY)

### 📁 File Organization & Imports

#### File Structure
- **File extensions**: `.mts` for TypeScript module files
- **Naming**: kebab-case for filenames (e.g., `cmd-scan-create.mts`, `handle-create-new-scan.mts`)
- **Module headers**: 🚨 MANDATORY - All modules MUST have `@fileoverview` headers as first content
  - Format: `/** @fileoverview Brief description of module purpose. */`
  - Placement: Before imports or any other code
  - ✅ CORRECT: `/** @fileoverview CLI command for scanning packages. */`
  - ❌ FORBIDDEN: Missing header or placed after imports

#### Import Organization
- **Node.js imports**: 🚨 MANDATORY - Always use `node:` prefix
  - ✅ CORRECT: `import path from 'node:path'`
  - ❌ FORBIDDEN: `import path from 'path'`
- **Import patterns**: Avoid `import * as` except in `src/external/` re-export wrappers
  - ✅ CORRECT: `import semver from './external/semver'` or `import { parse } from 'semver'`
  - ❌ AVOID: `import * as semver from 'semver'`
- **fs imports**: Use pattern `import { syncMethod, promises as fs } from 'node:fs'`

#### Import Statement Sorting
- **🚨 MANDATORY**: Sort imports in this exact order with blank lines between groups (enforced by ESLint import-x/order):
  1. Node.js built-in modules (with `node:` prefix) - sorted alphabetically
  2. External third-party packages - sorted alphabetically
  3. Internal Socket packages (`@socketsecurity/*`) - sorted alphabetically
  4. Local/relative imports (parent, sibling, index) - sorted alphabetically
  5. **Type imports LAST as separate group** - sorted alphabetically (all `import type` statements together at the end)
- **Within each group**: Sort alphabetically by module name
- **Named imports**: Sort named imports alphabetically within the import statement (enforced by sort-imports)
- **Type import placement**: Type imports must come LAST, after all runtime imports, as a separate group with blank line before
- **Examples**:
  - ✅ CORRECT:
    ```typescript
    import { readFile } from 'node:fs'
    import path from 'node:path'
    import { promisify } from 'node:util'

    import axios from 'axios'
    import semver from 'semver'

    import { readPackageJson } from '@socketsecurity/registry/lib/packages'
    import { spawn } from '@socketsecurity/registry/lib/spawn'

    import { API_BASE_URL } from './constants'
    import { formatError, parseResponse } from './utils'

    import type { ClientRequest, IncomingMessage } from 'node:http'
    import type { PackageJson } from '@socketsecurity/registry/lib/packages'
    import type { Config } from './types'
    ```
  - ❌ WRONG:
    ```typescript
    import { formatError, parseResponse } from './utils'
    import axios from 'axios'
    import type { Config } from './types'
    import { readFile } from 'node:fs'
    import { spawn } from '@socketsecurity/registry/lib/spawn'
    import semver from 'semver'
    import type { PackageJson } from '@socketsecurity/registry/lib/packages'
    ```

### 🏗️ Code Structure & Patterns

#### Naming Conventions
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `CMD_NAME`, `MAX_RETRIES`)
- **Variables/Functions**: `camelCase`
- **Classes/Types**: `PascalCase`

#### CLI-Specific Patterns
- **Command structure**: 🚨 MANDATORY - Each command MUST have `cmd-*.mts`, `handle-*.mts`, and `output-*.mts` files
- **Flags**: Use `MeowFlags` type with descriptive help text
- **GitHub API**: Use Octokit instances from `src/utils/github.mts` instead of raw fetch calls

#### TypeScript Patterns
- **Type safety**: 🚨 FORBIDDEN - Avoid `any` type; prefer `unknown` or specific types
- **Type imports**: Always use `import type` for better tree-shaking
- **Loop annotations**: 🚨 FORBIDDEN - Never annotate for...of loop variables
  - ✅ CORRECT: `for await (const chunk of stream)`
  - ❌ FORBIDDEN: `for await (const chunk: Buffer of stream)`

#### Object & Array Patterns
- **Object literals with __proto__**: 🚨 MANDATORY - `__proto__: null` ALWAYS comes first in object literals
  - ✅ CORRECT: `const MAP = { __proto__: null, foo: 'bar', baz: 'qux' }`
  - ✅ CORRECT: `{ __proto__: null, ...options }`
  - ❌ FORBIDDEN: `{ foo: 'bar', __proto__: null }` (wrong order)
  - ❌ FORBIDDEN: `{ ...options, __proto__: null }` (wrong order)
  - Use `Map` for dynamic collections
- **Array destructuring**: Use object notation for tuple access
  - ✅ CORRECT: `{ 0: key, 1: data }`
  - ❌ AVOID: `[key, data]`
- **Array destructuring performance**: For `Object.entries()` loops, use object destructuring for better V8 performance
  - ❌ SLOWER: `for (const [key, value] of Object.entries(obj))`
  - ✅ FASTER: `for (const { 0: key, 1: value } of Object.entries(obj))`
  - **Rationale**: Array destructuring requires iterator protocol (per ECMAScript spec), while object destructuring directly accesses indexed properties
  - **Reference**: https://stackoverflow.com/a/66321410 (V8 developer explanation)
  - **Trade-off**: This is a microbenchmark optimization - prioritize readability unless profiling shows this is a bottleneck
- **Array checks**: Use `!array.length` instead of `array.length === 0`
- **Destructuring**: Sort properties alphabetically in const declarations

#### Function Patterns
- **Ordering**: Alphabetical order; private functions first, then exported
- **Options parameter**: 🚨 MANDATORY pattern for all functions with options:
  ```typescript
  function foo(a: SomeA, options?: SomeOptions | undefined): Result {
    const opts = { __proto__: null, ...options } as SomeOptions
    // OR with destructuring:
    const { retries = 3 } = { __proto__: null, ...options } as SomeOptions
  }
  ```
  - Must be optional (`?`) and typed `| undefined`
  - Must use `{ __proto__: null, ...options }` pattern
  - Must include `as SomeOptions` type assertion
- **Dynamic imports**: 🚨 FORBIDDEN - Use static imports only (except test mocking)
- **Process spawning**: 🚨 FORBIDDEN - Don't use `child_process.spawn`; use `@socketsecurity/registry/lib/spawn`

### 📝 Comments & Documentation

#### Comment Style
- **Preference**: Single-line (`//`) over multiline (`/* */`) except for headers
- **Periods**: 🚨 MANDATORY - All comments end with periods (except directives and URLs)
- **Placement**: Own line above code, never trailing
- **Sentence structure**: Complete sentences with proper capitalization
- **Style**: Use commas/colons/semicolons instead of excessive hyphens
- **Examples**:
  - ✅ CORRECT: `// This validates user input.`
  - ✅ CORRECT: `// eslint-disable-next-line no-await-in-loop` (directive, no period)
  - ✅ CORRECT: `// See https://example.com` (URL, no period)
  - ✅ CORRECT: `// c8 ignore start - Not exported.` (reason has period)
  - ❌ WRONG: `// this validates input` (no period, not capitalized)
  - ❌ WRONG: `const x = 5 // some value` (trailing)

#### JSDoc Documentation
- **Function docs**: Description only with optional `@throws`
  - ✅ CORRECT:
    ```javascript
    /**
     * Parse configuration and validate contents.
     * @throws {Error} When file cannot be read.
     */
    ```
  - ❌ FORBIDDEN: `@param`, `@returns`, `@author`, `@since`, `@example` tags
  - ❌ FORBIDDEN: Empty lines between tags
- **Test coverage**: All `c8 ignore` comments MUST include reason ending with period
  - Format: `// c8 ignore start - Reason for ignoring.`

### 🔧 Code Organization

#### Control Flow
- **If statements**: Never single-line returns; always use braces
- **Await in loops**: Add `// eslint-disable-next-line no-await-in-loop` when intentional
- **Existence checks**: Perform simple checks before complex operations

#### Data & Collections
- **Mapping constants**: Move outside functions as module-level `UPPER_SNAKE_CASE` constants
- **Sorting**: 🚨 MANDATORY - Sort lists, exports, and items alphabetically
- **Catch parameters**: Use `catch (e)` not `catch (error)`
- **Number formatting**: Use underscore separators for large numbers (e.g., `20_000`)
  - 🚨 FORBIDDEN - Don't modify numbers inside strings

#### Formatting Standards
- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Single quotes preferred
- **Semicolons**: Omit semicolons
- **Line length**: Target 80 characters where practical
- **List formatting**: Use `-` for bullets, not `•`
- **Linting**: Uses ESLint, Oxlint, and Biome

### ⚠️ Error Handling

#### Error Types
- **Input validation**: Use `InputError` from `src/utils/errors.mts` for user input failures
- **Authentication**: Use `AuthError` from `src/utils/errors.mts` for API auth issues
- **Result pattern**: Use `CResult<T>` type for functions that can fail
- **Process exit**: Avoid `process.exit(1)`; prefer throwing error types
- **Error messages**: Write clear, actionable messages
- **Examples**:
  - ✅ CORRECT: `throw new InputError('No .socket directory found')`
  - ✅ CORRECT: `throw new AuthError('Invalid API token')`
  - ❌ WRONG: `logger.error('Error occurred'); return`
  - ❌ WRONG: `process.exit(1)`

#### Error Message Format & Style (Socket Standard)
- **Catch parameters**: 🚨 MANDATORY - Use `catch (e)` not `catch (error)`
- **JSDoc documentation**: Include `@throws {ErrorType} When condition occurs.` in function documentation
- **Component references**: Use double quotes around component/field names in error messages
  - ✅ CORRECT: `"config" field is required`
  - ❌ WRONG: `'config' field is required`
- **Quote characters**: Consistently use double quotes for literal values in error messages
- **Descriptive messages**: Error messages must clearly state what's wrong and which component failed

#### Error Message Patterns (Socket Standard)
Use these standardized patterns for consistency across all Socket projects:
- **Required fields**: `"{field}" is required` or `"{field}" is a required {type}`
- **Invalid types**: `"{field}" must be a {type}`
- **Validation failures**: `{context} "{field}" {violation}`
  - Example: `config "apiKey" cannot be empty`
- **Parse failures**: `failed to parse {format}` or `unable to {action} "{component}"`
- **Character restrictions**: Use specific descriptions: `cannot start with`, `cannot contain`, `must start with`

#### Error Handling Requirements (Socket Standard)
- **Descriptive and actionable**: Errors must clearly state what's wrong and provide context
- **Input validation**: Validate inputs thoroughly before processing
- **Edge cases**: Handle edge cases gracefully with clear error messages
- **Error context**: Include `{ cause: e }` when wrapping underlying errors
- **No process.exit()**: Never use `process.exit(1)` - throw errors instead (except CLI entry points where appropriate)
- **No silent failures**: Never use `logger.error()` or `console.error()` followed by `return` - throw proper errors
- **Test error paths**: Test both success and error paths for comprehensive coverage

### 🗑️ File Operations (SECURITY CRITICAL)

#### Safe Deletion Patterns
- **Scripts/Build**: Use `trash` package ONLY in scripts and build files
  - Import: `import { trash } from 'trash'`
  - Usage: `await trash([paths])`
  - Arrays accepted: Collect paths and pass as array
- **Source code**: In `/src/`, use `fs.rm()` with proper error handling
- **🚨 ABSOLUTELY FORBIDDEN**: Never use `fs.rmSync()` or `rm -rf`
- **Examples**:
  - ❌ CATASTROPHIC: `rm -rf directory`
  - ❌ REPOSITORY DESTROYER: `rm -rf "$(pwd)"`
  - ❌ FORBIDDEN: `fs.rmSync(tmpDir, { recursive: true })`
  - ✅ SCRIPTS: `await trash([tmpDir])`
  - ✅ SOURCE: `await fs.rm(tmpDir, { recursive: true, force: true })`
- **Rationale**: Scripts use trash for recovery; source code avoids bundling complications

### 🔍 Debugging & Troubleshooting
- **CI vs Local**: CI uses published packages, not local versions; be defensive with @socketsecurity/registry
- **Package detection**: Use `existsSync()` not `fs.access()` for consistency

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

## 📋 Recurring Patterns & Instructions

These are patterns and instructions that should be consistently applied across all Socket projects:

### 🏗️ Mandatory Code Patterns
1. **__proto__ Ordering**: 🚨 MANDATORY - `__proto__: null` ALWAYS comes first in object literals (e.g., `{ __proto__: null, ...options }`, never `{ ...options, __proto__: null }`)
2. **Options Parameter Pattern**: Use `{ __proto__: null, ...options } as SomeOptions` for all functions accepting options
3. **Reflect.apply Pattern**: Use `const { apply: ReflectApply } = Reflect` and `ReflectApply(fn, thisArg, [])` instead of `.call()` for method invocation
4. **Object Mappings**: Use `{ __proto__: null, ...mapping }` for static string-to-string mappings to prevent prototype pollution
5. **Import Separation**: ALWAYS separate type imports (`import type`) from runtime imports
6. **Node.js Imports**: ALWAYS use `node:` prefix for Node.js built-in modules
7. **🚨 TSGO PRESERVATION**: NEVER replace tsgo with tsc - tsgo provides enhanced performance and should be maintained across all Socket projects

### 🧪 Test Patterns & Cleanup
1. **Remove Duplicate Tests**: Eliminate tests that verify the same functionality across multiple files
2. **Centralize Test Data**: Use shared test fixtures instead of hardcoded values repeated across projects
3. **Focus Test Scope**: Each project should test its specific functionality, not dependencies' core features

### 🔄 Cross-Project Consistency
These patterns should be enforced across all Socket repositories:
- `socket-cli`
- `socket-packageurl-js`
- `socket-registry`
- `socket-sdk-js`

When working in any Socket repository, check CLAUDE.md files in other Socket projects for consistency and apply these patterns universally.

## 📦 Dependency Alignment Standards (CRITICAL)

### 🚨 MANDATORY Dependency Versions
All Socket projects MUST maintain alignment on these core dependencies. Use `taze` to manage version updates when needed:

#### Core Build Tools & TypeScript
- **@typescript/native-preview** (tsgo - NEVER use standard tsc)
- **@types/node** (latest LTS types)
- **typescript-eslint** (unified package - do NOT use separate @typescript-eslint/* packages)

#### Essential DevDependencies
- **@biomejs/biome**
- **@dotenvx/dotenvx**
- **@eslint/compat**
- **@eslint/js**
- **@vitest/coverage-v8**
- **eslint**
- **eslint-plugin-import-x**
- **eslint-plugin-n**
- **eslint-plugin-sort-destructure-keys**
- **eslint-plugin-unicorn**
- **globals**
- **husky**
- **knip**
- **lint-staged**
- **npm-run-all2**
- **oxlint**
- **taze**
- **trash**
- **type-coverage**
- **vitest**
- **yargs-parser**
- **yoctocolors-cjs**

### 🔧 TypeScript Compiler Standardization
- **🚨 MANDATORY**: ALL Socket projects MUST use `tsgo` instead of `tsc`
- **Package**: `@typescript/native-preview`
- **Scripts**: Replace `tsc` with `tsgo` in all package.json scripts
- **Benefits**: Enhanced performance, better memory management, faster compilation

#### Script Examples:
```json
{
  "build": "tsgo",
  "check:tsc": "tsgo --noEmit",
  "build:types": "tsgo --project tsconfig.dts.json"
}
```

### 🛠️ ESLint Configuration Standardization
- **🚨 FORBIDDEN**: Do NOT use separate `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` packages
- **✅ REQUIRED**: Use unified `typescript-eslint` package only
- **Migration**: Remove separate packages, add unified package

#### Migration Commands:
```bash
pnpm remove @typescript-eslint/eslint-plugin @typescript-eslint/parser
pnpm add -D typescript-eslint --save-exact
```

### 📋 Dependency Update Requirements
When updating dependencies across Socket projects:

1. **Use `taze`**: Use `taze` (or `pnpm dlx taze`) to manage version updates across projects
2. **Version Consistency**: All projects MUST use identical versions for shared dependencies
3. **Exact Versions**: Always use `--save-exact` flag to prevent version drift
4. **Batch Updates**: Update all Socket projects simultaneously to maintain alignment
5. **Testing**: Run full test suites after dependency updates to ensure compatibility
6. **Documentation**: Update CLAUDE.md files when standard versions change

### 🔄 Regular Maintenance
- **Monthly Audits**: Review dependency versions across all Socket projects
- **Security Updates**: Apply security patches immediately across all projects
- **Major Version Updates**: Coordinate across projects, test thoroughly
- **Legacy Cleanup**: Remove unused dependencies during regular maintenance

### 🚨 Enforcement Rules
- **Pre-commit Hooks**: Configure to prevent commits with misaligned dependencies
- **CI/CD Integration**: Fail builds on version mismatches
- **Code Reviews**: Always verify dependency alignment in PRs
- **Documentation**: Keep this section updated with current standard versions

This standardization ensures consistency, reduces maintenance overhead, and prevents dependency-related issues across the Socket ecosystem.
