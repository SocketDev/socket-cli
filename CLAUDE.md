# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## CANONICAL REFERENCE

This is a reference to shared Socket standards. See `../socket-registry/CLAUDE.md` for canonical source.

## 👤 USER CONTEXT

- **Identify users by git credentials**: Extract name from git commit author, GitHub account, or context
- 🚨 **When identity is verified**: ALWAYS use their actual name - NEVER use "the user" or "user"
- **Direct communication**: Use "you/your" when speaking directly to the verified user
- **Discussing their work**: Use their actual name when referencing their commits/contributions
- **Example**: If git shows "John-David Dalton <jdalton@example.com>", refer to them as "John-David"
- **Other contributors**: Use their actual names from commit history/context

## PRE-ACTION PROTOCOL

**MANDATORY**: Review CLAUDE.md before any action. No exceptions.

## VERIFICATION PROTOCOL

**MANDATORY**: Before claiming any task is complete:
1. Test the solution end-to-end
2. Verify all changes work as expected
3. Run the actual commands to confirm functionality
4. Never claim "Done" without verification

## ABSOLUTE RULES

- Never create files unless necessary
- Always prefer editing existing files
- Forbidden to create docs unless requested
- Required to do exactly what was asked

## ROLE

Principal Software Engineer: production code, architecture, reliability, ownership.

## EVOLUTION

If user repeats instruction 2+ times, ask: "Should I add this to CLAUDE.md?"

## 📚 SHARED STANDARDS

**Canonical reference**: `../socket-registry/CLAUDE.md`

All shared standards (git, testing, code style, cross-platform, CI) defined in socket-registry/CLAUDE.md.

**Quick references**:
- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `<type>(<scope>): <description>` - NO AI attribution
- Scripts: Prefer `pnpm run foo --flag` over `foo:bar` scripts
- Docs: Use `docs/` folder, lowercase-with-hyphens.md filenames, pithy writing with visuals
- Dependencies: After `package.json` edits, run `pnpm install` to update `pnpm-lock.yaml`
- Backward Compatibility: NO backward compat - we're our only consumers, make clean breaks
- Work Safeguards: MANDATORY commit + backup branch before bulk changes
- Safe Deletion: Use `safeDelete()` from `@socketsecurity/lib/fs` (NEVER `fs.rm/rmSync` or `rm -rf`)

---

## CLI-SPECIFIC

## Commands

### Development Commands
- **Build**: `npm run build` (alias for `npm run build:dist`)
- **Build source**: `npm run build:dist:src` or `pnpm build:dist:src`
- **Build types**: `npm run build:dist:types`
- **Test**: `pnpm test` (runs check + all tests from monorepo root)
- **Test unit only**: `pnpm --filter @socketsecurity/cli run test:unit`
- **Lint**: `npm run check:lint` (uses eslint)
- **Type check**: `npm run check:tsc` (uses tsgo)
- **Check all**: `npm run check` (lint + typecheck)
- **Fix linting**: `npm run lint:fix`
- **Commit without tests**: `git commit --no-verify` (skips pre-commit hooks including tests)

### Testing Best Practices - CRITICAL: NO -- FOR FILE PATHS
- **🚨 NEVER USE `--` BEFORE TEST FILE PATHS** - This runs ALL tests, not just your specified files!
- **Always build before testing**: Run `pnpm build:dist:src` before running tests to ensure dist files are up to date.
- **Test all**: ✅ CORRECT: `pnpm test` (from monorepo root)
- **Test single file**: ✅ CORRECT: `pnpm --filter @socketsecurity/cli run test:unit src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm test:unit src/commands/specific/cmd-file.test.mts` (command not found at root!)
  - ❌ WRONG: `pnpm --filter @socketsecurity/cli run test:unit -- src/commands/specific/cmd-file.test.mts` (runs ALL tests!)
- **Test multiple files**: ✅ CORRECT: `pnpm --filter @socketsecurity/cli run test:unit file1.test.mts file2.test.mts`
- **Test with pattern**: ✅ CORRECT: `pnpm --filter @socketsecurity/cli run test:unit src/commands/specific/cmd-file.test.mts -t "pattern"`
  - ❌ WRONG: `pnpm --filter @socketsecurity/cli run test:unit -- src/commands/specific/cmd-file.test.mts -t "pattern"`
- **Update snapshots**:
  - All tests: `pnpm testu` (builds first, then updates all snapshots)
  - Single file: ✅ CORRECT: `pnpm testu src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm testu -- src/commands/specific/cmd-file.test.mts` (updates ALL snapshots!)
- **Update with --update flag**: `pnpm --filter @socketsecurity/cli run test:unit src/commands/specific/cmd-file.test.mts --update`
- **Timeout for long tests**: Use `timeout` command or specify in test file.

### Git Commit Guidelines
- Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) style
- **🚨 FORBIDDEN**: NO AI attribution in commits (see SHARED STANDARDS)

### Running the CLI locally
- **Watch mode**: `pnpm dev` (auto-rebuilds on file changes)
- **Build and run**: `pnpm build && pnpm exec socket`
- **Run built version**: `pnpm exec socket <args>` (requires prior build)

### Package Management
- **Package Manager**: This project uses pnpm (v10.22+)
- **Install dependencies**: `pnpm install`
- **Add dependency**: `pnpm add <package>`
- **Add dev dependency**: `pnpm add -D <package>`
- **Update dependencies**: `pnpm update`
- **Override behavior**: pnpm.overrides in package.json controls dependency versions across the entire project
- **Using $ syntax**: `"$package-name"` in overrides means "use the version specified in dependencies"

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
- TypeScript compilation with tsgo
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

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Include user-facing changes only: Added, Changed, Fixed, Removed. Exclude: dependency updates, refactoring, tests, CI/CD, formatting. Marketing voice, stay concise.

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
- **Comment periods**: 🚨 MANDATORY - ALL comments MUST end with periods. This includes single-line comments, multi-line comments, and inline comments. No exceptions
- **Comment placement**: Place comments on their own line, not to the right of code
- **Comment formatting**: Use fewer hyphens/dashes and prefer commas, colons, or semicolons for better readability
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

### Safe File Operations (SECURITY CRITICAL)
- **File deletion**: See SHARED STANDARDS section
- 🚨 Use `safeDelete()` from `@socketsecurity/lib/fs` (NEVER `fs.rm/rmSync` or `rm -rf`)

### Debugging and Troubleshooting
- **CI vs Local Differences**: CI uses published npm packages, not local versions. Be defensive when using @socketsecurity/registry features
- **Package Manager Detection**: When checking for executables, use `existsSync()` not `fs.access()` for consistency

### Formatting
- **Linting**: Uses ESLint with TypeScript support and import/export rules
- **Formatting**: Uses Biome for code formatting with 2-space indentation
- **Line length**: Target 80 character line width where practical

---

## Quality Standards

- Code MUST pass all existing lints and type checks
- All patterns MUST follow established codebase conventions
- Error handling MUST be robust and user-friendly
- Performance considerations MUST be evaluated for any changes
