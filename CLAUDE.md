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
- Docs: Use `docs/` folder, lowercase-with-hyphens.md filenames, pithy writing with visuals
- Dependencies: After `package.json` edits, run `pnpm install` to update `pnpm-lock.yaml`

---

## 📝 EMOJI & OUTPUT STYLE

**Terminal Symbols** (based on `@socketsecurity/lib/logger` LOG_SYMBOLS):
- ✓ Success/checkmark - green (NOT ✅)
- ✗ Error/failure - red (NOT ❌)
- ⚠ Warning/caution - yellow (NOT ⚠️)
- ℹ Info - blue (NOT ℹ️)
- → Step/progress - cyan (NOT ➜ or ▶)

**Color Requirements** (apply to icon ONLY):
```javascript
import colors from 'yoctocolors-cjs'
`${colors.green('✓')} ${msg}`   // Success
`${colors.red('✗')} ${msg}`     // Error
`${colors.yellow('⚠')} ${msg}`  // Warning
```

**Color Package**: Use `yoctocolors-cjs` (CommonJS, pinned in all Socket projects)

**Allowed Emojis** (sparingly): 📦 Packages, 💡 Ideas/tips, 🚀 Launch/deploy, 🎉 Major success

---

## 🏗️ CLI-SPECIFIC

### Commands
- **Build**: `npm run build` (alias for `npm run build:dist`)
- **Test**: `npm run test` (check + all tests)
- **Test unit**: `npm run test:unit` or `pnpm test:unit`
- **Lint**: `npm run lint`, **Fix**: `npm run fix`
- **Type check**: `npm run type`
- **Commit without tests**: `git commit --no-verify`

### Testing Best Practices
- **🚨 NEVER USE `--` BEFORE TEST FILE PATHS** - Runs ALL tests!
- **Always build first**: `pnpm build:dist:src`
- **Single file**: `pnpm test:unit src/commands/file.test.mts`
- **With pattern**: `pnpm test:unit src/commands/file.test.mts -t "pattern"`
- **Update snapshots**: `pnpm testu` or `pnpm testu <file>`

### Running CLI Locally
- **Build + run**: `npm run build && npm exec socket`
- **Quick**: `npm run bs` (builds source only, then runs)
- **No build**: `npm run s`
- **Native TS**: `./sd` (Node 22+ with native TypeScript)

### Dry-Run Flag

Available in all commands via `commonFlags`, but usage varies:

**Pattern 1: Early Exit (~52 commands)** - Most commands:
```typescript
if (!!cli.flags['dryRun']) {
  logger.log('[DryRun]: Bailing now')
  return
}
```

**Pattern 2: Validation (~3 commands)** - `patch apply`, `fix`, `self-update`:
- Perform validation but skip persistence
- Use `[DryRun]: Not saving` message

**Pattern 3: No Implementation (~24 commands)** - Interactive/auth commands

### Smol Node.js Binary
- **Locations**: `.node-source/out/Release/node`, `build/out/Release/node`

### Socket Node.js Patches

**🚨 CRITICAL**: Patches are the ONLY way to modify Node.js source.

**Requirements**:
- Created using `git diff` against pristine source
- Must apply cleanly or build fails
- See `build/patches/socket/README.md` for process

## Architecture

CLI tool for Socket.dev security analysis, built with TypeScript (.mts extensions).

### Core Structure
- **Entry**: `src/cli.mts` - Main CLI with meow subcommands
- **Commands**: `src/commands/*/` - Each feature in own directory
- **Pattern**: `cmd-*.mts` (definition), `handle-*.mts` (logic), `output-*.mts` (formatting)
- **Utils**: `src/utils/` - Shared utilities
- **Constants**: `src/constants.mts`

### Key Categories
- **npm/npx wrapping**: Security scanning wrapper
- **Scanning**: Create/manage security scans
- **Organization**: Manage org settings/policies
- **Package analysis**: Analyze package scores
- **Optimization**: Apply Socket registry overrides

### Build System
- Rollup for distribution
- TypeScript with tsgo or tsc
- Individual file compilation
- Multiple environment configs
- Dual linting (oxlint + eslint), Biome formatting

### Build/Dist Structure

**MANDATORY**: All packages follow build/dist pattern.

**Philosophy**:
- **`build/`** (gitignored) = Workspace + historical builds archive
- **`dist/`** (tracked) = Blessed canonical releases

**Structure**:
```
packages/<package>/
├── build/                    # Gitignored
│   ├── tmp/                  # Current build intermediates
│   ├── cache/                # Downloads, source clones
│   └── archive/              # Historical builds
│       ├── YYYY-MM-DD-NNN-description/
│       └── latest/           # Symlink to most recent
└── dist/                     # Tracked releases
```

**@socketbin Conventions**:
- **Executables**: `packages/socketbin-cli-<platform>-<arch>/bin/socket` (tracked)
- **Libraries**: `packages/socketbin-cli-ai/dist/` (WASM + JS, gitignored)

### Documentation Hierarchy

**Tier 1**: `/docs/` - Monorepo-wide (architecture, build systems, guides)
**Tier 2**: `packages/<pkg>/docs/` - Package-specific technical docs
**Tier 3**: `packages/<pkg>/*/docs/` - Sub-package/language-specific details

**Naming**: lowercase-with-hyphens.md, maintain README.md indices

### Testing

Uses Vitest with comprehensive test helpers.

#### Test Helpers
1. **CLI Execution** (`test/helpers/cli-execution.mts`)
   - `executeCliCommand()`, `expectCliSuccess()`, `expectCliError()`, `executeCliJson()`
2. **Output Assertions** (`test/helpers/output-assertions.mts`)
   - `expectOutput()`, `expectStdoutContainsAll()`, `expectValidJson()`
3. **Result Assertions** (`test/helpers/result-assertions.mts`)
   - `expectResult()`, `expectSuccess()`, `expectFailure()`
4. **Workspace** (`test/helpers/workspace-helper.mts`)
   - `createTestWorkspace()`, `withTestWorkspace()`, `createMonorepoWorkspace()`

**Benefits**: 70% fewer lines, automatic config isolation, type-safe JSON parsing

#### Running Tests
- **All**: `pnpm test`
- **Unit only**: `pnpm test:unit`
- **Specific**: `pnpm test:unit src/commands/file.test.mts` (NO `--` before path!)
- **Pattern**: `pnpm test:unit src/commands/file.test.mts -t "pattern"`
- **Snapshots**: `pnpm testu` or `pnpm testu <file>`
- **Coverage**: `pnpm run test:unit:coverage`

#### Best Practices
- Use `setupTestEnvironment()` in beforeEach
- Use helper factories for CResult patterns
- Leverage fluent assertions
- Auto-cleanup with `withTestWorkspace()`
- All CLI commands get auto `--config {}` for isolation

## Environment & Configuration

### Env Files
`.env.local` (dev), `.env.test` (test), `.env.testu` (test update), `.env.dist` (build), `.env.external`

### Config Files
`biome.json`, `vitest.config.mts`, `eslint.config.js`, `tsconfig.json`, `knip.json`

### Package Structure
- **Binaries**: `socket`, `socket-npm`, `socket-npx` in `bin/`
- **Distribution**: Built files in `dist/`
- **External deps**: Bundled in `external/`
- **Fixtures**: `test/fixtures/`

## Changelog Management

Format: `## [version](https://github.com/SocketDev/socket-cli/releases/tag/vversion) - date`

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):
- Sections: Added, Changed, Fixed, Removed (Security if applicable)
- Chronological, latest first
- YYYY-MM-DD dates
- **User-facing changes only** - exclude deps, refactoring, tests, build system, CI

**Writing Style**: Marketing voice emphasizing user benefits, stay concise

## 🔧 Git & Workflow

### GitHub Actions
- **🚨 MANDATORY**: Reference commit SHAs, not version tags
- **Standard SHAs** (with version comments):
  - `actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0`
  - `pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda # v4.1.0`
  - `actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0`
- **Reusable workflows**: MUST be in `socket-registry/.github/workflows/`, not project repos

### CI Strategy
- **🚨 MANDATORY**: Use centralized `ci.yml` from socket-registry
- **Location**: `SocketDev/socket-registry/.github/workflows/ci.yml@main`
- **Configuration**: Customize via inputs (scripts, node/OS versions, timeouts)
- **Orchestration**: Runs lint, type-check, test, coverage in parallel

### Long-Running Builds
- **🚨 CRITICAL**: Don't push commits during long builds (>30min) without authorization
- `cancel-in-progress: true` terminates running builds on new commits

## 🔧 Code Style (MANDATORY)

### File Organization
- **Extensions**: `.mts` for TypeScript modules
- **Import order**: Node.js built-ins, third-party, local
- **Node path**: 🚨 `import path from 'node:path'` (NEVER cherry-pick functions)
- **Type imports**: 🚨 Separate `import type` statements (NEVER mix with runtime imports)

### Naming
- **Constants**: `UPPER_SNAKE_CASE`
- **Files**: kebab-case (`cmd-scan-create.mts`)
- **Variables/functions**: camelCase

### Code Structure (CRITICAL)
- **Command pattern**: 🚨 MANDATORY `cmd-*.mts`, `handle-*.mts`, `output-*.mts`
- **Dynamic imports**: 🚨 FORBIDDEN - use static imports only
- **Sorting**: 🚨 MANDATORY - always sort lists/exports alphabetically
- **Comment formatting**: 🚨 MANDATORY:
  - Must end with period (except ESLint directives and URLs)
  - Complete sentences with capitalization
  - Own line above code, not trailing
  - ✅ `// This function validates user input.`
  - ❌ `const x = 5 // some value`
- **Array destructuring**: Use object notation `{ 0: key, 1: data }`
- **If returns**: Never single-line; always use braces
- **List formatting**: Use `-` not `•` for bullets
- **GitHub API**: Use Octokit from `src/utils/github.mts`
- **Object mappings**: `__proto__: null` for static; `Map` for dynamic
- **Array length**: `!array.length` for empty; `!!array.length` or `array.length` for conditional
- **Catch params**: `catch (e)` not `catch (error)`
- **Node fs**: `import { someSyncThing, promises as fs } from 'node:fs'`
- **Process spawn**: 🚨 Use `{ spawn }` from `@socketsecurity/lib/spawn` (NOT built-in)
- **Shell execution**: 🚨 Use `shell: WIN32` from `@socketsecurity/lib/constants/platform` (NOT `shell: true`)
- **Logging**: 🚨 Use `logger` from `@socketsecurity/lib/logger` (NOT `console.log`)
- **Working directory**: 🚨 ABSOLUTELY FORBIDDEN - NEVER `process.chdir()`
  - ✅ Use `{ cwd: '/absolute/path' }` in spawn/exec/fs
  - ✅ Always absolute paths with `path.resolve()`
  - ❌ FORBIDDEN: `process.chdir()` - breaks tests, creates race conditions
- **Number formatting**: Use underscores for large numbers (`20_000`)

### Error Handling
- **Input validation**: `InputError` from `src/utils/errors.mts`
- **Authentication**: `AuthError` from `src/utils/errors.mts`
- **CResult pattern**: Use for functions that can fail
- **Process exit**: Avoid unless necessary; prefer throwing errors
- **Clear messages**: Actionable errors that help users fix issues

### Safe File Operations (SECURITY CRITICAL)
- **Use safeDelete**: Import from `@socketsecurity/lib/fs`
- **Source code**: Use `safeDelete()` or `safeDeleteSync()` with error handling
- **Scripts**: Use `safeDelete()` or `safeDeleteSync()` from `@socketsecurity/lib/fs`
- **package.json scripts**: Use `del-cli` for inline script situations
- **NO fs.rm/rmSync**: 🚨 ABSOLUTELY FORBIDDEN - NEVER `fs.rm()`, `fs.rmSync()`, or `rm -rf`
- **Examples**:
  - ✅ Source/Scripts: `import { safeDelete } from '@socketsecurity/lib/fs'` then `await safeDelete(tmpDir)`
  - ✅ Sync version: `import { safeDeleteSync } from '@socketsecurity/lib/fs'` then `safeDeleteSync(tmpDir)`
  - ✅ package.json: `"clean": "del-cli dist/**"`
  - ❌ FORBIDDEN: `fs.rm()`, `fs.rmSync()`, `rm -rf`, `trash` package

### Formatting
- ESLint with TypeScript support
- Biome for formatting (2-space indentation)
- Target 80 character lines

### Test Coverage
- All `c8 ignore` comments MUST include reason ending with period
- Format: `// c8 ignore start - Reason.`

## 📝 SCRATCH DOCUMENTS

- **Location**: `.claude/` (gitignored)
- **Purpose**: Scratch docs, planning, analysis, temp documentation
- **🚨 CRITICAL**: NEVER commit `.claude/` files

---

# 🚨 CRITICAL BEHAVIORAL REQUIREMENTS

## 🔍 Pre-Action Protocol
- **🚨 MANDATORY**: Before ANY action, review and verify CLAUDE.md compliance
- **Check before you act**: Read relevant sections first
- **No exceptions**: Applies to all tasks
- **When in doubt**: Consult CLAUDE.md first

## 🎯 Principal Engineer Mindset
- Act with principal-level authority and expertise
- Prioritize long-term maintainability
- Anticipate edge cases
- Write reviewable code
- Own technical decisions

## 🛡️ ABSOLUTE RULES
- 🚨 **NEVER** create files unless absolutely necessary
- 🚨 **ALWAYS** prefer editing over creating
- 🚨 **FORBIDDEN** to proactively create docs unless explicitly requested
- 🚨 **MANDATORY** to follow ALL CLAUDE.md guidelines
- 🚨 **REQUIRED** to do exactly what was asked - nothing more, nothing less

## 🎯 Quality Standards
- Code MUST pass lints and type checks
- MUST maintain backward compatibility unless explicitly breaking
- Follow established codebase conventions
- Robust and user-friendly error handling
- Evaluate performance considerations
