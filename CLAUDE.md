# CLAUDE.md

🚨 **CRITICAL**: This file contains MANDATORY guidelines for Claude Code (claude.ai/code). You MUST follow these guidelines EXACTLY as specified. Act as a principal-level software engineer with deep expertise in TypeScript, Node.js, and CLI development.

## 📚 SHARED STANDARDS

**This project follows Socket's unified development standards.** For comprehensive guidelines on:
- Code style (imports, sorting, __proto__ patterns, comments)
- Git workflow (GitHub Actions, CI, commit messages)
- Error handling standards and message patterns
- Cross-platform compatibility
- Testing best practices (Vitest memory optimization)
- Dependency alignment
- Changelog management

**See the canonical reference:** `socket-registry/CLAUDE.md` (in sibling repository)

This file contains **Socket CLI-specific** rules and patterns. When in doubt, consult socket-registry/CLAUDE.md first.

## 🎯 YOUR ROLE

You are a **Principal Software Engineer** responsible for production-quality code, architectural decisions, and system reliability.

## 🔍 PRE-ACTION PROTOCOL

- **🚨 MANDATORY**: Before ANY action, review both this file AND socket-registry/CLAUDE.md
- Check before you act - ensure approach follows established patterns
- No exceptions for code changes, commits, documentation, testing, file operations

## 🛡️ ABSOLUTE RULES

- 🚨 **NEVER** create files unless absolutely necessary
- 🚨 **ALWAYS** prefer editing existing files
- 🚨 **FORBIDDEN** to proactively create documentation files unless explicitly requested
- 🚨 **REQUIRED** to do exactly what was asked - nothing more, nothing less

## 🏗️ ARCHITECTURE

### CLI Tool for Socket.dev Security Analysis
Built with TypeScript using .mts extensions.

### Core Structure
- **Entry point**: `src/cli.mts` - Main CLI entry with meow subcommands
- **Commands**: `src/commands.mts` - Exports all command definitions
- **Command modules**: `src/commands/*/` - Each feature has cmd-*, handle-*, output-* files
- **Utilities**: `src/utils/` - Shared utilities
- **Constants**: `src/constants.mts` - Application constants
- **Types**: `src/types.mts` - TypeScript type definitions

### Command Architecture Pattern
Each command follows consistent pattern:
- `cmd-*.mts` - Command definition and CLI interface
- `handle-*.mts` - Business logic and processing
- `output-*.mts` - Output formatting (JSON, markdown, etc.)
- `fetch-*.mts` - API calls (where applicable)

### Key Command Categories
- **npm/npx wrapping**: `socket npm`, `socket npx` - Wraps with security scanning
- **Scanning**: `socket scan` - Create and manage security scans
- **Organization management**: `socket organization` - Manage org settings
- **Package analysis**: `socket package` - Analyze package scores
- **Optimization**: `socket optimize` - Apply Socket registry overrides
- **Configuration**: `socket config` - Manage CLI configuration

### Build System
- Uses Rollup for building distribution files
- TypeScript compilation with tsgo (preferred) or tsc
- Individual file compilation for better maintainability
- Multiple environment configs (.env.local, .env.test, .env.dist)

### Shadow Binaries
- **`shadow-bin/`** - Contains wrapper scripts for npm/npx commands
  - `shadow-bin/npm` - Wraps npm with Socket security scanning
  - `shadow-bin/npx` - Wraps npx with Socket security scanning
  - Enables `socket npm` and `socket npx` functionality

## ⚡ COMMANDS

### Development Commands
- **Build**: `pnpm run build` (alias for `pnpm run build:dist`)
- **Build source**: `pnpm run build:dist:src`
- **Build types**: `pnpm run build:dist:types`
- **Test**: `pnpm run test`
- **Test unit**: `pnpm run test:unit`
- **Lint**: `pnpm run check:lint`
- **Type check**: `pnpm run check:tsc` (uses tsgo)
- **Check all**: `pnpm run check`
- **Commit without tests**: `git commit --no-verify`

### Running CLI Locally
- **Build and run**: `pnpm run build && pnpm exec socket`
- **Quick build + run**: `pnpm run bs` (builds source only, then runs socket)
- **Run without build**: `pnpm run s` (runs socket directly)
- **Native TypeScript**: `./sd` (Node.js native TypeScript support on Node 22+)

### Testing Best Practices
- **🚨 NEVER USE `--` BEFORE TEST FILE PATHS** - Runs ALL tests!
- **Always build before testing**: Run `pnpm run build:dist:src` first
- **Test single file**: ✅ CORRECT: `pnpm run test:unit src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm run test:unit -- src/commands/specific/cmd-file.test.mts`
- **Update snapshots**:
  - All tests: `pnpm run testu`
  - Single file: ✅ CORRECT: `pnpm run testu src/commands/specific/cmd-file.test.mts`
  - ❌ WRONG: `pnpm run testu -- src/commands/specific/cmd-file.test.mts`
- **🚨 MANDATORY Coverage Requirements**: Before pushing commits, ensure test coverage is maintained or improved
  - **Never decrease coverage**: All changes MUST maintain or increase existing coverage percentages
  - **Check before push**: Run `pnpm run test` to verify coverage thresholds are met
  - **Fix coverage drops**: If coverage decreases, add tests to restore or improve coverage before pushing
  - **Rationale**: Declining coverage indicates untested code paths, which increases risk of bugs and regressions

### CI Testing Infrastructure
- **🚨 MANDATORY**: Use `SocketDev/socket-registry/.github/workflows/ci.yml@<SHA>` with full commit SHA (not @main)
- **🚨 CRITICAL**: GitHub Actions require full-length commit SHAs. Format: `@662bbcab1b7533e24ba8e3446cffd8a7e5f7617e # main`
- **Reusable workflows**: Socket-registry provides centralized, reusable workflows for lint/type-check/test/coverage
- **Benefits**: Parallel execution, consistent configuration, cross-platform testing
- **Documentation**: See `docs/CI_TESTING.md` and `socket-registry/docs/CI_TESTING_TOOLS.md`

## 🎨 CLI-SPECIFIC CODE PATTERNS

### File Structure
- **File extensions**: `.mts` for TypeScript module files
- **Naming**: kebab-case (e.g., `cmd-scan-create.mts`, `handle-create-new-scan.mts`)
- **Module headers**: 🚨 MANDATORY - All modules MUST have `@fileoverview` headers

### CLI-Specific Patterns
- **Command structure**: 🚨 MANDATORY - Each command MUST have `cmd-*.mts`, `handle-*.mts`, `output-*.mts`
- **Flags**: Use `MeowFlags` type with descriptive help text
- **GitHub API**: Use Octokit instances from `src/utils/github.mts` instead of raw fetch
- **Null-prototype objects**:
  - ✅ CORRECT: `{ __proto__: null, key: 'value' }` (object literal with properties)
  - ✅ CORRECT: `{ __proto__: null, ...options }` (spread pattern)
  - ✅ CORRECT: `const obj = Object.create(null)` (empty object, populate separately)
  - ❌ WRONG: `const obj = { __proto__: null }` (empty object literal - use `Object.create(null)` instead)
  - **Rationale**: Use `Object.create(null)` only for empty null-prototype objects; object literals with `__proto__: null` are fine when they have properties

### Error Handling
- **Input validation**: Use `InputError` from `src/utils/errors.mts`
- **Authentication**: Use `AuthError` from `src/utils/errors.mts`
- **Result pattern**: Use `CResult<T>` type for functions that can fail
- **Examples**:
  - ✅ CORRECT: `throw new InputError('No .socket directory found')`
  - ✅ CORRECT: `throw new AuthError('Invalid API token')`
  - ❌ WRONG: `logger.error('Error occurred'); return`

### File Operations (SECURITY CRITICAL)
- **Scripts/Build**: Use `trash` package ONLY in scripts and build files
- **Source code**: In `/src/`, use `fs.rm()` with proper error handling
- **NO rmSync**: 🚨 ABSOLUTELY FORBIDDEN - NEVER use `fs.rmSync()` or `rm -rf`

## 📦 PACKAGE STRUCTURE

### Distribution
- **Binary entries**: `socket`, `socket-npm`, `socket-npx` (in `bin/` directory)
- **Distribution**: Built files go to `dist/` directory
- **External dependencies**: Bundled in `dist/external/` directory
- **Test fixtures**: Located in `test/fixtures/`

### External Dependencies
- Bundles external dependencies in `dist/external/` directory
- Uses Socket registry overrides for security
- Custom patches applied to dependencies in `patches/`

## 🧪 TESTING

### Test Organization
- **Modular test files**: Split large test files by functionality
- **Test file naming**: Use descriptive names reflecting module being tested
- **Test directory structure**: 🚨 MANDATORY
  ```
  test/
  ├── unit/                   # Unit tests
  ├── integration/           # Integration tests
  ├── fixtures/              # Test fixtures
  └── utils/                 # Test utilities
      ├── environment.mts    # Test environment setup
      ├── fixtures.mts       # Test data configurations
      ├── mock-helpers.mts   # Mock setup utilities
      └── constants.mts      # Test constants
  ```

### Test Utilities Organization
- ✅ CORRECT: `import { setupTestEnvironment } from './utils/environment.mts'`
- ✅ CORRECT: `import { TEST_PACKAGE_CONFIGS } from './utils/fixtures.mts'`
- ❌ OLD PATTERN: `import { setupTestEnvironment } from './test-utils.mts'`

## 📝 CHANGELOG MANAGEMENT

### Content Guidelines
Focus on **user-facing changes** only:
- **Added**: New features, commands, flags users can access
- **Changed**: Modifications to existing behavior users will notice
- **Fixed**: Bug fixes that resolve user-reported issues
- **Removed**: Features, flags, commands no longer available

### Writing Style
Use **marketing voice** emphasizing user benefits while staying **concise**:
- Focus on what users can accomplish vs technical implementation
- Highlight improvements in UX and productivity
- Use active, positive language showcasing value
- Keep entries brief

### Exclude Internal Changes
- Dependency updates (unless security fixes or user features)
- Code refactoring and cleanup
- Internal constant reorganization
- Test snapshot updates
- Build system improvements
- Developer tooling changes
- GitHub workflow and CI/CD changes
- Third-party integration updates (unless user-visible features)

### Third-Party Integrations
Socket CLI integrates with:
- **@coana-tech/cli**: Static analysis for reachability
- **cdxgen**: CycloneDX BOM generator
- **synp**: Convert between yarn.lock and package-lock.json

## 🔧 GIT WORKFLOW

### Commit Messages
- **🚨 ABSOLUTELY FORBIDDEN**: NEVER add Claude Code attribution to commit messages
  - ❌ WRONG: Adding "🤖 Generated with [Claude Code]..." or "Co-Authored-By: Claude"
  - ✅ CORRECT: Write commit messages without any AI attribution or signatures
  - **Rationale**: This is a professional project and commit messages should not contain AI tool attributions

### Pre-Commit Quality Checks
- **🚨 MANDATORY**: Always run these commands before committing:
  - `pnpm run fix` - Fix linting and formatting issues
  - `pnpm run check` - Run all checks (lint, type-check, tests)
  - **Rationale**: Ensures code quality regardless of whether hooks run

### Commit Strategy with --no-verify
- **--no-verify usage**: Use `--no-verify` flag for commits that don't require pre-commit hooks
  - ✅ **Safe to skip hooks**: Scripts (scripts/), GitHub Actions workflows (.github/workflows/), tests (test/), documentation (*.md), configuration files
  - ❌ **Always run hooks**: Source code (src/), published package code, CLI command implementations
  - **Important**: Even when using `--no-verify`, you MUST still run `pnpm run fix` and `pnpm run check` manually first
  - **Rationale**: Pre-commit hooks run linting and type-checking which are critical for CLI source code but less critical for non-published files

### Batch Commits Strategy
- **When making many changes**: Break large changesets into small, logical commits
- **First commit with tests**: Run full test suite (hooks) for the first commit only
- **Subsequent commits with --no-verify**: Use `--no-verify` for follow-up commits
- **Example workflow**:
  1. Make all changes and ensure `pnpm run fix && pnpm run check` passes
  2. Stage and commit core changes with hooks: `git commit -m "message"`
  3. Stage and commit related changes: `git commit --no-verify -m "message"`
  4. Stage and commit cleanup: `git commit --no-verify -m "message"`
  5. Stage and commit docs: `git commit --no-verify -m "message"`
- **Rationale**: Reduces commit time while maintaining code quality through initial validation

### Git SHA Management (CRITICAL)
- **🚨 NEVER GUESS OR MAKE UP GIT SHAs**: Always retrieve the exact full SHA using `git rev-parse`
  - ✅ CORRECT: `cd /path/to/repo && git rev-parse HEAD` or `git rev-parse main`
  - ❌ WRONG: Guessing the rest of a SHA after seeing only the short version (e.g., `43a668e1`)
  - **Why this matters**: GitHub Actions workflow references require exact, full 40-character SHAs
  - **Consequences of wrong SHA**: Workflow failures with "workflow was not found" errors
- **Updating workflow SHA references**: When updating SHA references in workflow files:
  1. Get the exact full SHA: `cd repo && git rev-parse HEAD`
  2. Use the FULL 40-character SHA in sed commands
  3. Verify the SHA exists: `git show <sha> --stat`
- **Rationale**: Using incorrect SHAs breaks CI/CD pipelines and wastes debugging time

## 🔍 DEBUGGING

### CI vs Local
- CI uses published packages, not local versions
- Be defensive with @socketsecurity/registry

### Package Detection
- Use `existsSync()` not `fs.access()` for consistency

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

---

**For all other standards not covered here, refer to `socket-registry/CLAUDE.md` (in sibling repository)**
