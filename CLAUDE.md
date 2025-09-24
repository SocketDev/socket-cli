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
- **Build**: `npm run build` (alias for `npm run build:dist`)
- **Build source**: `npm run build:dist:src` or `pnpm build:dist:src`
- **Build types**: `npm run build:dist:types`
- **Test**: `npm run test` (runs check + all tests)
- **Test unit only**: `npm run test:unit` or `pnpm test:unit`
- **Lint**: `npm run check:lint` (uses eslint)
- **Type check**: `npm run check:tsc` (uses tsgo)
- **Check all**: `npm run check` (lint + typecheck)
- **Fix linting**: `npm run lint:fix`
- **Commit without tests**: `git commit --no-verify` (skips pre-commit hooks including tests)

### Cross-Platform Compatibility - CRITICAL: Windows and POSIX
- **🚨 MANDATORY**: Tests and functionality MUST work on both POSIX (macOS/Linux) and Windows systems
- **Path handling**: ALWAYS use `path.join()`, `path.resolve()`, `path.sep` for file paths
  - ❌ WRONG: `'/usr/local/bin/npm'` (hard-coded POSIX path)
  - ✅ CORRECT: `path.join(path.sep, 'usr', 'local', 'bin', 'npm')` (cross-platform)
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
- **Line endings**: Be aware of CRLF (Windows) vs LF (Unix) differences when processing text files
- **Shell commands**: Consider platform differences in shell commands and utilities

### Testing Best Practices - CRITICAL: NO -- FOR FILE PATHS
- **🚨 NEVER USE `--` BEFORE TEST FILE PATHS** - This runs ALL tests, not just your specified files!
- **Always build before testing**: Run `pnpm build:dist:src` before running tests to ensure dist files are up to date
- **Test single file**: ✅ CORRECT: `pnpm test:unit src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm test:unit -- src/commands/specific/cmd-file.test.mts` (runs ALL tests!)
- **Test multiple files**: ✅ CORRECT: `pnpm test:unit file1.test.mts file2.test.mts`
- **Test with pattern**: ✅ CORRECT: `pnpm test:unit src/commands/specific/cmd-file.test.mts -t "pattern"`
  - ❌ WRONG: `pnpm test:unit -- src/commands/specific/cmd-file.test.mts -t "pattern"`
- **Update snapshots**:
  - All tests: `pnpm testu` (builds first, then updates all snapshots)
  - Single file: ✅ CORRECT: `pnpm testu src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm testu -- src/commands/specific/cmd-file.test.mts` (updates ALL snapshots!)
- **Update with --update flag**: `pnpm test:unit src/commands/specific/cmd-file.test.mts --update`
- **Timeout for long tests**: Use `timeout` command or specify in test file

#### Vitest Memory Optimization (CRITICAL)
- **Pool configuration**: Use `pool: 'forks'` with `singleFork: true`, `maxForks: 1`, `isolate: true`
- **Memory limits**: Set `NODE_OPTIONS="--max-old-space-size=4096 --max-semi-space-size=512"` in `.env.test`
- **Timeout settings**: Use `testTimeout: 60000, hookTimeout: 60000` for stability
- **Thread limits**: Use `singleThread: true, maxThreads: 1` to prevent RegExp compiler exhaustion
- **Test cleanup**: 🚨 MANDATORY - Import and use `trash` package: `import { trash } from 'trash'` then `await trash([paths])`

### Git Commit Guidelines
- **🚨 FORBIDDEN**: NEVER add Claude co-authorship or Claude signatures to commits
- **🚨 FORBIDDEN**: Do NOT include "Generated with Claude Code" or similar AI attribution in commit messages
- **Commit messages**: Should be written as if by a human developer, focusing on the what and why of changes
- **Professional commits**: Write clear, concise commit messages that describe the actual changes made

### Running the CLI locally
- **Build and run**: `npm run build && npm exec socket` or `pnpm build && pnpm exec socket`
- **Quick build + run**: `npm run bs` or `pnpm bs` (builds source only, then runs socket)
- **Run without build**: `npm run s` or `pnpm s` (runs socket directly)
- **Native TypeScript**: `./sd` (runs the CLI without building using Node.js native TypeScript support on Node 22+)

### Package Management
- **Package Manager**: This project uses pnpm (v10.16.0+)
- **Install dependencies**: `pnpm install`
- **Add dependency**: `pnpm add <package> --save-exact`
- **Add dev dependency**: `pnpm add -D <package> --save-exact`
- **Update dependencies**: `pnpm update`
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

## 🔧 Code Style (MANDATORY)

### 📁 File Organization
- **File extensions**: Use `.mts` for TypeScript module files
- **Import order**: Node.js built-ins first, then third-party packages, then local imports
- **Import grouping**: Group imports by source (Node.js, external packages, local modules)
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

---

# 🚨 CRITICAL BEHAVIORAL REQUIREMENTS

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
