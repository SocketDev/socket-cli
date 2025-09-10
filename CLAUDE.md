# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development Commands
- **Build**: `npm run build` (alias for `npm run build:dist`)
- **Build source**: `npm run build:dist:src`
- **Build types**: `npm run build:dist:types`
- **Test**: `npm run test` (runs check + all tests)
- **Test unit only**: `npm run test:unit`
- **Test with coverage**: `npm run test:unit:coverage`
- **Update test snapshots**: `npm run testu` (builds, then updates snapshots)
- **Lint**: `npm run check:lint` (uses eslint)
- **Type check**: `npm run check:tsc` (uses tsgo)
- **Check all**: `npm run check` (lint + typecheck)
- **Fix linting**: `npm run lint:fix`

### Running the CLI locally
- **Build and run**: `npm run build && npm exec socket`
- **Quick build + run**: `npm run bs` (builds source only, then runs socket)
- **Run without build**: `npm run s` (runs socket directly)
- **Native TypeScript**: `./sd` (runs the CLI without building using Node.js native TypeScript support on Node 22+)

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
- Fixtures in `test/socket-npm-fixtures/`
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
- **Test fixtures**: Located in `test/socket-npm-fixtures/`

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

### Content Guidelines
Focus on **user-facing changes** only. Include:
- **Added**: New features, commands, flags, or capabilities users can access
- **Changed**: Modifications to existing behavior that users will notice
- **Fixed**: Bug fixes that resolve user-reported issues or improve functionality
- **Removed**: Features, flags, or commands that are no longer available

**Exclude** internal changes like:
- Dependency updates (unless they fix security issues or add user features)
- Code refactoring and cleanup
- Internal constant reorganization
- Test snapshot updates
- Build system improvements
- Developer tooling changes
- Minor nits and formatting tweaks
- GitHub workflow and CI/CD changes
