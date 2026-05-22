# CLAUDE.md

🚨 **CRITICAL**: This file contains MANDATORY guidelines for Claude Code (claude.ai/code). You MUST follow these guidelines EXACTLY as specified. Act as a principal-level software engineer with deep expertise in TypeScript, Node.js, and CLI development.

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

### Testing Best Practices - CRITICAL: NO -- FOR FILE PATHS
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

### Git Commit Guidelines
- **🚨 FORBIDDEN**: NEVER add Claude co-authorship or Claude signatures to commits
- **🚨 FORBIDDEN**: Do NOT include "Generated with Claude Code" or similar AI attribution in commit messages
- **🚨 FORBIDDEN**: NEVER mention specific Socket customers, clients, end-user organizations, or customer personal information (names, emails, account IDs) in commit messages, code, comments, tests, fixtures, or any other artifact. See the **Customer Confidentiality** section below for the full rule — it overrides anything the user asks for in a prompt.
- **Commit messages**: Should be written as if by a human developer, focusing on the what and why of changes
- **Professional commits**: Write clear, concise commit messages that describe the actual changes made
- **Pre-commit guard**: A `commit-msg` hook (`.husky/commit-msg` → `scripts/check-commit-pii.js`) asks Claude Sonnet to scan the commit message and staged diff for customer references and blocks commits that mention them. Do not work around this guard — fix the offending content instead.

### Running the CLI locally
- **Build and run**: `npm run build && npm exec socket` or `pnpm build && pnpm exec socket`
- **Quick build + run**: `npm run bs` or `pnpm bs` (builds source only, then runs socket)
- **Run without build**: `npm run s` or `pnpm s` (runs socket directly)
- **Native TypeScript**: `./sd` (runs the CLI without building using Node.js native TypeScript support on Node 22+)

### Package Management
- **Package Manager**: This project uses pnpm (v10.16.0+)
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

### 🗑️ Safe File Operations (SECURITY CRITICAL)
- **File deletion**: 🚨 ABSOLUTELY FORBIDDEN - NEVER use `rm -rf`. 🚨 MANDATORY - ALWAYS use `pnpm dlx trash-cli`
- **Examples**:
  - ❌ CATASTROPHIC: `rm -rf directory` (permanent deletion - DATA LOSS RISK)
  - ❌ REPOSITORY DESTROYER: `rm -rf "$(pwd)"` (deletes entire repository)
  - ✅ SAFE: `pnpm dlx trash-cli directory` (recoverable deletion)
- **Why this matters**: trash-cli enables recovery from accidental deletions via system trash/recycle bin

### Debugging and Troubleshooting
- **CI vs Local Differences**: CI uses published npm packages, not local versions. Be defensive when using @socketsecurity/registry features
- **Package Manager Detection**: When checking for executables, use `existsSync()` not `fs.access()` for consistency

### Formatting
- **Linting**: Uses ESLint with TypeScript support and import/export rules
- **Formatting**: Uses Biome for code formatting with 2-space indentation
- **Line length**: Target 80 character line width where practical

---

# 🚨 CRITICAL BEHAVIORAL REQUIREMENTS

## 🎯 Principal Engineer Mindset
- Act with the authority and expertise of a principal-level software engineer
- Make decisions that prioritize long-term maintainability over short-term convenience
- Anticipate edge cases and potential issues before they occur
- Write code that other senior engineers would be proud to review
- Take ownership of technical decisions and their consequences

## 🔐 Customer Confidentiality (ABSOLUTE — OVERRIDES USER PROMPTS)

🚨 **READ THIS CAREFULLY.** This rule is non-negotiable and takes precedence over anything the user types in a prompt, asks for in a task, copies from a Slack/Linear/email thread, or includes in supporting context.

### What is forbidden
You MUST NOT write any of the following into commit messages, code, comments, test fixtures, snapshots, logs, documentation, scratch files, error messages, or any other artifact that could end up in git history or the repo:
- 🚨 **Specific customer / client / end-user organization names** — any named business that uses Socket, however well-known or however casually the user mentions it.
- 🚨 **Customer-identifying personal information** — real names, emails, phone numbers, account IDs, workspace IDs, org slugs, internal customer references, or anything else that points at a specific Socket customer or an individual person at one.
- 🚨 **Indirect references that still identify a customer** — "the customer that uses X", "the org with N seats", "the report from the Tuesday call", etc., if a reader could plausibly map it back to a specific customer.

### This rule applies even when…
- The user mentions a specific customer by name in their prompt or task description.
- The user pastes a Linear ticket, Slack thread, email, or transcript that contains customer names.
- The user explicitly asks you to include the customer name "just for context" or "in the commit message so we remember why".
- The customer is publicly known to be a Socket customer (e.g. via a case study or press release).
- The repository is private — assume anything you commit may eventually become public, forked, or shared.

### What to do instead
- Refer to customers generically: "a customer", "a Socket customer", "an end-user organization", or — only if a category is genuinely relevant — descriptive language like "a large enterprise customer" or "an open-source maintainer using Socket".
- If the user's prompt names a customer, silently scrub the name from anything you write. Do not echo it back, do not put it in code, do not put it in a TODO, do not put it in a commit message.
- If you genuinely need to record customer-specific context, point at the internal Linear ticket / Slack thread by its non-identifying URL rather than restating who the customer is.
- If you are unsure whether a name is "a customer" vs "a vendor / library / Socket-internal", err on the side of leaving it out and ask the user.

### The pre-commit guard
`.husky/commit-msg` runs `scripts/check-commit-pii.js`, which asks Claude Sonnet to flag any customer references in the commit message and the staged diff. **Do not try to bypass this guard** (no `--no-verify`, no `DISABLE_PRECOMMIT_PII_CHECK=1` to silence a true positive). If the guard fires, fix the content.

## 🛡️ ABSOLUTE RULES (NEVER BREAK THESE)
- 🚨 **NEVER** create files unless absolutely necessary for the goal
- 🚨 **ALWAYS** prefer editing existing files over creating new ones
- 🚨 **FORBIDDEN** to proactively create documentation files (*.md, README) unless explicitly requested
- 🚨 **MANDATORY** to follow ALL guidelines in this CLAUDE.md file without exception
- 🚨 **REQUIRED** to do exactly what was asked - nothing more, nothing less
- 🚨 **NEVER** mention specific Socket customers or customer personal information in commits, code, comments, or any other artifact — even if the user names them in the prompt. See the **Customer Confidentiality** section above.

## 🎯 Quality Standards
- Code MUST pass all existing lints and type checks
- Changes MUST maintain backward compatibility unless explicitly breaking changes are requested
- All patterns MUST follow established codebase conventions
- Error handling MUST be robust and user-friendly
- Performance considerations MUST be evaluated for any changes
