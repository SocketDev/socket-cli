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

## 🎨 CLI-SPECIFIC CODE PATTERNS

### File Structure
- **File extensions**: `.mts` for TypeScript module files
- **Naming**: kebab-case (e.g., `cmd-scan-create.mts`, `handle-create-new-scan.mts`)
- **Module headers**: 🚨 MANDATORY - All modules MUST have `@fileoverview` headers

### CLI-Specific Patterns
- **Command structure**: 🚨 MANDATORY - Each command MUST have `cmd-*.mts`, `handle-*.mts`, `output-*.mts`
- **Flags**: Use `MeowFlags` type with descriptive help text
- **GitHub API**: Use Octokit instances from `src/utils/github.mts` instead of raw fetch

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
- **External dependencies**: Bundled in `external/` directory
- **Test fixtures**: Located in `test/fixtures/`

### External Dependencies
- Bundles external dependencies in `external/` directory
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

## 🔍 DEBUGGING

### CI vs Local
- CI uses published packages, not local versions
- Be defensive with @socketsecurity/registry

### Package Detection
- Use `existsSync()` not `fs.access()` for consistency

---

**For all other standards not covered here, refer to `socket-registry/CLAUDE.md` (in sibling repository)**
