# Socket Lib Complete Structure Analysis

## Project Overview

**Socket Lib** (`@socketsecurity/lib`) is a core infrastructure library for Socket.dev security tools. It provides utilities, constants, and helper functions used across Socket projects.

- **Package Name**: `@socketsecurity/lib`
- **Current Version**: 1.3.5
- **Node.js Requirement**: >=22
- **License**: MIT
- **Repository**: https://github.com/SocketDev/socket-lib

---

## 1. TOP-LEVEL DIRECTORY STRUCTURE

```
socket-lib/
├── .claude/               # Claude.com scratch documents (gitignored)
├── .config/              # Build & tooling configuration
├── .git/                 # Git repository
├── .git-hooks/           # Custom git hooks
├── .github/workflows/    # CI/CD workflows
├── .husky/               # Husky pre-commit hooks
├── .vscode/              # VS Code settings
├── biome.json            # Biome formatter/linter config
├── CHANGELOG.md          # Version history
├── CLAUDE.md             # Project instructions & standards
├── data/                 # Static data files
├── dist/                 # Build output (6.7M)
├── docs/                 # Documentation
├── LICENSE               # MIT license
├── node_modules/         # Dependencies
├── package.json          # NPM package metadata
├── pnpm-lock.yaml        # Dependency lockfile
├── plugins/              # Custom Babel plugins
├── README.md             # Project README
├── scripts/              # Build & development scripts
├── src/                  # TypeScript source (1.5M)
└── test/                 # Test files (748K, 36 test files)
```

**Key sizes**:
- Source code: 1.5MB (183 TypeScript files)
- Tests: 748KB (36 test files)
- Build output: 6.7MB

---

## 2. DOCUMENTATION

### Existing Documentation

| File | Purpose | Status |
|------|---------|--------|
| `README.md` | Project overview & installation | Comprehensive |
| `CLAUDE.md` | Project standards & guidelines | Comprehensive |
| `CHANGELOG.md` | Version history & release notes | Current |
| `docs/getting-started.md` | Quick start guide for contributors | Comprehensive |
| `docs/build.md` | Build architecture deep-dive | Comprehensive |
| `docs/themes.md` | Theme system documentation | Comprehensive |
| `LICENSE` | MIT license text | Present |

### Documentation Status

**What's COMPLETE**:
- Getting started guide for new contributors (5-min setup)
- Project standards and patterns (CLAUDE.md)
- Build architecture documentation
- Theme system guide
- Development workflow and commands
- Testing patterns and setup

**What could be ENHANCED**:
- Architecture overview diagram
- Expanded API reference documentation
- Video tutorials or screencasts

**Current state**: Comprehensive for both maintainers and new developers

---

## 3. AVAILABLE SCRIPTS

Located in `package.json` and `scripts/` directory (Node.js `.mjs` files):

### Main Commands

| Command | Script | Purpose |
|---------|--------|---------|
| `pnpm build` | `scripts/build.mjs` | Production build (esbuild + type generation) |
| `pnpm run build:watch` or `pnpm dev` | `scripts/build-js.mjs` | Watch mode for development |
| `pnpm test` | `scripts/test.mjs` | Run tests with vitest |
| `pnpm run test-ci` | vitest run | CI test execution |
| `pnpm run check` | `scripts/check.mjs` | TypeScript type checking |
| `pnpm lint` | `scripts/lint.mjs` | Biome linting |
| `pnpm run fix` | `scripts/lint.mjs --fix` | Auto-fix linting issues |
| `pnpm run lint-ci` | Same as lint | CI linting |
| `pnpm run type-ci` | `pnpm run check` | CI type checking |
| `pnpm run cover` | `scripts/cover.mjs` | Test coverage report |
| `pnpm run clean` | `scripts/clean.mjs` | Remove build artifacts |
| `pnpm run update` | `scripts/update.mjs` | Update dependencies |
| `pnpm run claude` | `scripts/claude.mjs` | Claude-related tooling |

### Support Scripts (in `scripts/` directory)

- `build-externals.mjs` - Bundle external/vendored dependencies
- `build-js.mjs` - JavaScript compilation wrapper
- `fix-build.mjs` - Post-build fixes
- `fix-commonjs-exports.mjs` - Fix CommonJS export format
- `fix-external-imports.mjs` - Fix external import paths
- `generate-package-exports.mjs` - Auto-generate package.json exports
- `utils/` - Shared script utilities

### Utility Directory (`scripts/utils/`)

Helper functions and utilities for scripts:
- `changed-test-mapper.mjs` - Map changed files to tests
- `flags.mjs` - Argument parsing
- `helpers.mjs` - Formatting & output
- `logger.mjs` - Script logging
- `parse-args.mjs` - CLI argument parsing
- `run-command.mjs` - Command execution
- `signal-exit.mjs` - Process exit handling
- `spinner.mjs` - Progress spinner

---

## 4. SOURCE CODE ORGANIZATION (`src/`)

### Directory Layout

```
src/
├── abort.ts                    # AbortController utilities
├── agent.ts                    # npm/yarn/pnpm package manager detection
├── ansi.ts                     # ANSI code utilities
├── argv/                       # Argument parsing
│   ├── flags.ts
│   └── parse.ts
├── arrays.ts                   # Array utilities
├── bin.ts                      # Binary/executable utilities
├── cacache.ts                  # Cache utilities
├── cache-with-ttl.ts           # TTL-based caching
├── constants/                  # 14 constant modules
│   ├── agents.ts
│   ├── core.ts
│   ├── encoding.ts
│   ├── github.ts
│   ├── licenses.ts
│   ├── node.ts
│   ├── packages.ts
│   ├── paths.ts
│   ├── platform.ts
│   ├── process.ts
│   ├── socket.ts
│   ├── testing.ts
│   ├── time.ts
│   └── typescript.ts
├── cover/                      # Type coverage utilities
├── debug.ts                    # Debug logging
├── dlx.ts                      # npm dlx-like execution
├── dlx-binary.ts              # Binary installation
├── dlx-package.ts             # Package downloading
├── download-lock.ts           # Download synchronization
├── effects/                    # CLI visual effects
│   ├── pulse-frames.ts
│   ├── text-shimmer.ts
│   ├── types.ts
│   └── ultra.ts
├── env/                       # 68 typed env variable getters
│   ├── ci.ts
│   ├── getters.ts
│   ├── helpers.ts
│   ├── appdata.ts
│   ├── github-*.ts (multiple)
│   ├── home.ts
│   ├── node-env.ts
│   ├── npm-*.ts (multiple)
│   ├── path.ts
│   ├── socket-*.ts (multiple Socket-specific vars)
│   ├── temp.ts
│   ├── tmp.ts
│   ├── xdg-*.ts (multiple)
│   └── ...
├── env.ts                     # Main env module
├── external/                  # Vendored/bundled dependencies
│   ├── @npmcli/
│   ├── @socketregistry/
│   ├── @yarnpkg/
│   ├── @inquirer/
│   ├── cacache.d.ts / .js
│   ├── debug.d.ts / .js
│   ├── fast-glob.js
│   ├── fast-sort.js
│   ├── make-fetch-happen.js
│   ├── pacote.d.ts / .js
│   ├── semver.d.ts / .js
│   ├── which.js
│   ├── yargs-parser.d.ts / .js
│   ├── yoctocolors-cjs.d.ts / .js
│   ├── zod.js
│   └── ...
├── fs.ts                      # File system utilities
├── functions.ts               # Function utilities
├── git.ts                     # Git operations
├── github.ts                  # GitHub API utilities
├── globs.ts                   # Glob pattern utilities
├── http-request.ts            # HTTP client
├── index.ts                   # Main barrel export
├── ipc.ts                     # Inter-process communication
├── json.ts                    # JSON utilities
├── logger.ts                  # Logging with colors/symbols
├── maintained-node-versions.ts # Node.js version info
├── memoization.ts             # Function memoization
├── objects.ts                 # Object utilities
├── packages/                  # Package-related utilities
│   ├── editable.ts
│   ├── exports.ts
│   ├── isolation.ts
│   ├── licenses.ts
│   ├── manifest.ts
│   ├── normalize.ts
│   ├── operations.ts
│   ├── paths.ts
│   ├── provenance.ts
│   ├── registry.ts
│   ├── specs.ts
│   └── validation.ts
├── packages.ts                # Main packages export
├── path.ts                    # Path utilities
├── paths.ts                   # Path constants
├── performance.ts             # Performance measurement
├── promise-queue.ts           # Promise queue utility
├── promises.ts                # Promise utilities
├── prompts.ts                 # CLI prompts
├── regexps.ts                 # Regular expression utilities
├── sea.ts                     # SEA (Single Executable Application) support
├── shadow.ts                  # Shadow executable support
├── signal-exit.ts             # Process exit handling
├── sorts.ts                   # Sorting utilities
├── spawn.ts                   # Child process spawning wrapper
├── spinner.ts                 # CLI spinner/progress
├── ssri.ts                    # Subresource Integrity utilities
├── stdio/                     # Standard I/O utilities
│   ├── clear.ts
│   ├── divider.ts
│   ├── footer.ts
│   ├── header.ts
│   ├── mask.ts
│   ├── progress.ts
│   ├── prompts.ts
│   ├── stderr.ts
│   └── stdout.ts
├── streams.ts                 # Stream utilities
├── strings.ts                 # String utilities
├── suppress-warnings.ts       # Warning suppression
├── tables.ts                  # Table formatting
├── temporary-executor.ts      # Temporary execution context
├── types/                     # TypeScript type definitions
├── types.ts                   # Type exports
├── url.ts                     # URL utilities
├── utils/                     # Shared utilities
│   └── get-ipc.ts
├── validation/                # Data validation
│   ├── json-parser.ts
│   └── types.ts
├── versions.ts                # Version utilities
├── words.ts                   # Word/text utilities
└── zod.ts                     # Zod validation re-export

**Total**: 64 top-level modules + subdirectories
```

### Key Module Categories

| Category | Modules | Purpose |
|----------|---------|---------|
| **Environment** | `env/*.ts` (68 files) | Typed access to environment variables |
| **Constants** | `constants/*.ts` (14 files) | System & npm constants |
| **Packages** | `packages/*.ts` (12 files) | NPM package utilities |
| **File System** | `fs.ts`, `path.ts`, `paths.ts` | File operations |
| **Utilities** | `strings.ts`, `arrays.ts`, `objects.ts`, etc. | Common helpers |
| **CLI** | `logger.ts`, `spinner.ts`, `stdio/*.ts` | Terminal output |
| **Process** | `spawn.ts`, `signal-exit.ts`, `agent.ts` | Process management |
| **External** | `external/` (40+ files) | Vendored dependencies |

---

## 5. TEST ORGANIZATION (`test/`)

### Test Structure

```
test/
├── agent.test.ts              # Package manager detection tests
├── argv/
│   ├── flags.test.ts
│   └── parse.test.ts
├── arrays.test.ts
├── bin.test.ts
├── build-externals.test.ts
├── cache-with-ttl.test.ts
├── debug.test.ts
├── dlx-binary.test.ts
├── dlx-package.test.ts
├── effects/
│   └── pulse-frames.test.ts
├── env.test.ts                # Environment variable tests
├── fs.test.ts                 # File system tests (large)
├── fs-additional.test.ts      # Additional FS tests
├── functions.test.ts
├── git.test.ts
├── git-extended.test.ts       # Extended git tests
├── github.test.ts
├── http-request.test.ts       # HTTP client tests
├── ipc.test.ts
├── json.test.ts
├── logger.test.ts
├── memoization.test.ts
├── objects.test.ts
├── path.test.ts               # Path utilities (large)
├── paths.test.ts
├── promises.test.ts
├── packages/
│   ├── exports.test.ts
│   ├── isolation.test.ts
│   ├── licenses.test.ts
│   ├── manifest.test.ts
│   ├── normalize.test.ts
│   ├── operations.test.ts
│   ├── registry.test.ts
│   ├── specs.test.ts
│   └── validation.test.ts
├── regexps.test.ts
├── signal-exit.test.ts
├── sorts.test.ts
├── spawn.test.ts
├── streams.test.ts
├── strings.test.ts
├── tables.test.ts
├── url.test.ts
├── validation/
│   └── json-parser.test.ts
├── versions.test.ts
└── words.test.ts

**Total**: 36 test files
```

### Test Coverage

- Tests cover all major modules
- Mix of unit tests and integration tests
- Large tests: `fs.test.ts`, `bin.test.ts`, `path.test.ts`, `http-request.test.ts`
- Comprehensive coverage for critical modules

---

## 6. CONFIGURATION FILES

### Root-Level Config Files

| File | Purpose | Type |
|------|---------|------|
| `package.json` | NPM metadata, scripts, dependencies | JSON |
| `pnpm-lock.yaml` | Dependency lockfile | YAML |
| `biome.json` | Formatter/linter configuration | JSON |
| `tsconfig.json` | TypeScript compilation settings | JSON |
| `tsconfig.dts.json` | Type declaration generation settings | JSON |
| `tsconfig.test.json` | Test-specific TypeScript settings | JSON |
| `.editorconfig` | Editor settings | INI |
| `.gitattributes` | Git file attributes | Text |
| `.gitignore` | Ignored files | Text |
| `.npmrc` | NPM configuration | INI |
| `.node-version` | Node.js version | Text |

### `.config/` Directory Configuration

```
.config/
├── esbuild.config.mjs         # esbuild build configuration
├── eslint.config.mjs          # ESLint rules (unified config)
├── isolated-tests.json        # Vitest isolated test config
├── knip.json                  # Dead code finder config
├── taze.config.mts            # Dependency updater config
├── tsconfig.check.json        # Type checking config
├── vitest-global-setup.mts    # Global test setup
├── vitest.config.mts          # Vitest test configuration
├── vitest.setup.mts           # Test setup hooks
└── vitest-plugins/            # Custom vitest plugins
    ├── import-transform.mts    # Import transformation
    ├── require-transform.mts   # Require transformation
    └── transform-utils.mts     # Transformation utilities
```

### `.github/` Workflows

```
.github/workflows/
├── ci.yml                     # Main CI/CD pipeline
├── claude-auto-review.yml     # Claude code review
├── claude.yml                 # Claude-related workflow
├── provenance.yml             # Build provenance
└── socket-auto-pr.yml         # Socket auto-PR workflow
```

### `.husky/` Git Hooks

```
.husky/
├── pre-commit                 # Pre-commit hook script
└── security-checks.sh         # Security checks script
```

Pre-commit hook runs:
1. `pnpm lint --staged` (Biome linting on staged files)
2. `dotenvx -q run -f .env.precommit -- pnpm test --staged` (Tests on changed files)

---

## 7. BUILD SYSTEM

### Architecture

The build system is sophisticated with multiple stages:

```
TypeScript Source (src/)
    ↓
[1] Compilation with esbuild → CommonJS (dist/)
    ↓
[2] Type Generation with tsgo → .d.ts files (dist/)
    ↓
[3] External Bundling → vendored code (dist/external/)
    ↓
[4] CommonJS Export Fixes → exports.default → module.exports
    ↓
[5] Import Path Fixes → relative vs external paths
    ↓
Final Distribution (dist/)
```

### Key Build Features

**esbuild Configuration** (`.config/esbuild.config.mjs`):
- Bundle name: `socket-lib`
- Format: CommonJS
- Target: ES2022
- Externalizes: Node.js built-ins, dependencies, `/external/` paths
- Bundled internally: Custom code

**TypeScript Compilation**:
- Tool: tsgo (TypeScript Native Preview, not tsc)
- Declarations: Generated to `dist/*.d.ts`
- Config: `tsconfig.dts.json`

**External Dependencies Architecture**:
- **Runtime dependencies**: Listed in `package.json` deps
  - Example: `@socketregistry/packageurl-js`
- **Vendored dependencies**: Code copied to `src/external/`
  - Examples: `@npmcli/*`, `@socketregistry/*`, `@inquirer/*`
  - NOT in package.json dependencies
  - Bundled during build
- **Validation**: `scripts/validate-external.mjs` checks for re-exports

### Build Output

**dist/** directory (6.7M):
- JavaScript files (CommonJS format)
- TypeScript declaration files (.d.ts)
- External bundled code
- Data files (extensions.json)
- Biome configuration (exported)

### Build Scripts

| Script | Purpose |
|--------|---------|
| `scripts/build.mjs` | Master build orchestrator |
| `scripts/build-js.mjs` | esbuild wrapper with watch mode |
| `scripts/build-externals.mjs` | Bundle external dependencies |
| `scripts/fix-commonjs-exports.mjs` | Post-build CommonJS fixes |
| `scripts/fix-external-imports.mjs` | Fix import paths |
| `scripts/clean.mjs` | Clean build artifacts |

### Build Configuration

**Development mode**: `pnpm run dev` or `pnpm run build:watch`
- Live rebuilding
- Fast feedback loop
- Useful for development

**Production mode**: `pnpm build`
- Full build with type generation
- All validations run
- Optimized output

---

## 8. DEPENDENCIES

### Dependency Statistics

**Runtime Dependencies**: 1
- `@socketregistry/packageurl-js@1.3.0`

**Development Dependencies**: 65+

### Key DevDependencies (by category)

#### Build & Compilation
- `esbuild@0.25.11` - Fast JavaScript bundler
- `@typescript/native-preview@7.0.0-dev.20250920.1` - tsgo (TypeScript Native Preview)
- `typescript@5.7.3` - TypeScript compiler
- `vite-tsconfig-paths@5.1.4` - Vite TypeScript path support

#### Linting & Formatting
- `@biomejs/biome@2.2.4` - Fast formatter/linter
- `eslint@9.35.0` - JavaScript linter
- `typescript-eslint@8.44.1` - TypeScript ESLint support
- `eslint-plugin-*@*` - ESLint plugins (import-x, n, unicorn, sort-destructure-keys)
- `eslint-import-resolver-typescript@4.4.4`

#### Testing
- `vitest@4.0.3` - Vitest test runner
- `@vitest/coverage-v8@4.0.3` - V8 coverage provider
- `@vitest/ui@4.0.3` - Vitest UI

#### Package Management & Tools
- `@npmcli/package-json@7.0.0` - npm package.json utilities
- `@npmcli/promise-spawn@8.0.3` - Promise-based spawning
- `npm-package-arg@13.0.0` - Parse npm package strings
- `pacote@21.0.1` - npm package extraction
- `libnpmpack@9.0.9` - npm pack utilities
- `normalize-package-data@8.0.0` - Normalize package.json
- `validate-npm-package-name@6.0.2` - Validate npm names
- `semver@7.7.2` - Semantic versioning

#### CLI & Utilities
- `yoctocolors-cjs@2.1.3` - Terminal colors (CommonJS)
- `yargs-parser@22.0.0` - Argument parsing
- `@inquirer/confirm@5.1.16` - Prompts
- `@inquirer/input@4.2.2`
- `@inquirer/password@4.0.18`
- `@inquirer/search@3.1.1`
- `@inquirer/select@4.3.2`
- `@socketregistry/yocto-spinner@1.0.19` - Progress spinner
- `@socketregistry/is-unicode-supported@1.0.5` - Unicode detection
- `@socketregistry/packageurl-js@1.3.0` - Package URL parsing

#### Development Tools
- `pnpm` (built-in) - Package manager
- `husky@9.1.7` - Git hooks
- `lint-staged@15.2.11` - Lint staged files
- `trash@10.0.0` - Safe file deletion
- `del@8.0.1` - Delete files/folders
- `taze@19.6.0` - Dependency updater
- `type-coverage@2.29.7` - Type coverage reporter
- `knip@19.6.0` - Dead code finder
- `npm-run-all2@8.0.4` - Run multiple npm scripts
- `dotenvx@1.49.0` - dotenv utility

#### Other
- `@babel/*@7.28.4` - Babel packages for plugins
- `magic-string@0.30.17` - String manipulation
- `make-fetch-happen@15.0.2` - Fetch implementation
- `fast-glob@3.3.3` - Fast globbing
- `fast-sort@3.4.1` - Fast sorting
- `get-east-asian-width@1.3.0` - Character width
- `debug@4.4.3` - Debugging
- `which@5.0.0` - Find executable paths
- `globals@16.4.0` - Global variable names
- `picomatch@2.3.1` - Pattern matching
- `spdx-*@*` - SPDX license utilities
- `streaming-iterables@8.0.1` - Async iterables
- `zod@4.1.12` - Schema validation
- `@yarnpkg/extensions@2.0.6` - Yarn extensions

### Dependency Notes

- **No backend dependencies**: Pure Node.js utilities
- **Tree-shakeable**: `sideEffects: false`
- **CommonJS focused**: Scripts use `.mjs` modules
- **Platform independent**: Works on Windows, macOS, Linux
- **Browser fallbacks**: Has extensive browser field mappings

---

## 9. PACKAGE EXPORTS

The package uses granular exports (from `package.json` exports):

**Export Categories**:

1. **Main entry**: `./`, `./index`
2. **Modules**: `./abort`, `./ansi`, `./agent`, `./arrays`, `./bin`, etc. (~120+ exports)
3. **Nested paths**:
   - `./argv/*` (flags, parse)
   - `./constants/*` (14 constant modules)
   - `./cover/*` (code, formatters, type, types)
   - `./effects/*` (pulse-frames, text-shimmer, types, ultra)
   - `./env/*` (68 specific env vars)
   - `./packages/*` (12 package utilities)
   - `./packages/licenses`, `./packages/paths`, etc.
   - `./stdio/*` (clear, divider, footer, header, mask, progress, prompts, stderr, stdout)
   - `./utils/*` (get-ipc)
   - `./validation/*` (json-parser, types)

4. **Plugins**: `./plugins/babel-plugin-inline-require-calls`
5. **Configuration**: `./biome.json`, `./data/extensions.json`, `./package.json`, `./tsconfig*.json`
6. **Import aliases**:
   - `#constants/*` → `dist/constants/*.js`
   - `#env/*` → `dist/env/*.js`
   - `#lib/*` → `dist/*.js`
   - `#packages/*` → `dist/packages/*.js`
   - `#types` → `dist/types.js`
   - `#utils/*` → `dist/utils/*.js`

---

## 10. PLUGINS

Located in `plugins/` directory:

### Babel Plugins

- `babel-plugin-inline-require-calls.js` - Inline require() calls
- `babel-plugin-inline-const-enum.mjs` - Inline const enums
- `babel-plugin-inline-process-env.mjs` - Inline process.env values
- `babel-plugin-strip-debug.mjs` - Strip debug statements
- `README.md` - Plugin documentation

### Vitest Plugins

Located in `.config/vitest-plugins/`:

- `import-transform.mts` - Transform imports in tests
- `require-transform.mts` - Transform requires in tests
- `transform-utils.mts` - Shared transformation utilities

---

## 11. STANDARDS & PRACTICES

### Code Organization

**Follows socket-registry CLAUDE.md standards**:
- ESM imports with `node:` prefix required
- Kebab-case file names
- Mandatory `@fileoverview` headers
- No `any` types (use `unknown`)
- Null-prototype objects with `{ __proto__: null, ...props }`
- Alphabetical sorting (imports, exports, properties)
- Semicolons omitted (trailing commas: all)

### Build Standards

- **No shell scripts**: Only Node.js `.mjs` files
- **CommonJS output**: esbuild compiles to CommonJS
- **Type-safe**: Full TypeScript with declarations
- **Cross-platform**: Works on Windows/Unix

### Testing Standards

- **Framework**: Vitest 4.0.3
- **Environment**: Node.js only
- **Pool**: Threads (faster than forks)
- **Coverage**: V8-based
- **Staged testing**: Pre-commit runs affected tests

### Performance Optimization

- **Fast build**: esbuild for speed
- **Minimal externals**: Only 1 runtime dependency
- **Tree-shaking**: Full support
- **Code splitting**: Granular exports

---

## 12. ENVIRONMENT

### Git

- **Repository**: SocketDev/socket-lib
- **Current branch**: main (from context)
- **Hooks**: Pre-commit lint + test validation

### Node.js

- **Required version**: >=22
- **Tested in CI**: Multiple versions
- **Platform support**: Windows, macOS, Linux

### Package Manager

- **Primary**: pnpm
- **Lockfile**: pnpm-lock.yaml
- **Install**: `pnpm install`

---

## 13. DEVELOPMENT WORKFLOW

### Quick Start

```bash
# Install dependencies
pnpm install

# Watch mode (auto-rebuild)
pnpm run dev

# Run tests
pnpm test

# Type checking
pnpm run check

# Linting
pnpm run lint

# Format + fix
pnpm run fix

# Production build
pnpm build

# Coverage report
pnpm run cover
```

### Pre-commit Flow

1. **Lint staged files**: `pnpm lint --staged`
2. **Test staged files**: `pnpm test --staged`
3. **Skip options**: Set env vars:
   - `DISABLE_PRECOMMIT_LINT=1` - Skip linting
   - `DISABLE_PRECOMMIT_TEST=1` - Skip testing

### CI/CD Pipeline

Located in `.github/workflows/`:
- **ci.yml**: Main CI with build, lint, test, coverage
- **provenance.yml**: Build provenance tracking
- **claude.yml**: Claude integration
- **socket-auto-pr.yml**: Socket auto-PR workflow

---

## 14. KEY INSIGHTS

### Strengths

1. **Comprehensive utility library** - 60+ modules covering common needs
2. **Well-documented standards** - CLAUDE.md provides clear guidelines
3. **Type-safe** - Full TypeScript with declarations
4. **Granular exports** - Consumers can import specific utilities
5. **Fast build** - esbuild compilation is quick
6. **No production dependencies** - Single optional peer dependency
7. **Cross-platform** - Windows/Unix support built-in
8. **Modern tooling** - Vitest, Biome, TypeScript modern setup

### Documentation Strengths

1. **Getting started guide** — Quick 5-minute setup for new contributors
2. **Development standards** — Comprehensive CLAUDE.md with patterns
3. **Build documentation** — Detailed build system architecture
4. **Theme system guide** — Visual effects and theming documentation
5. **Development workflow** — Commands, testing, and contribution flow
6. **Testing patterns** — Vitest setup and common patterns
7. **Code standards** — Clear formatting, naming, and organization rules

### Code Patterns

**Consistent patterns across modules**:
- Options objects with null-prototype
- Async/promise-based APIs
- Error handling with descriptive messages
- Cross-platform path handling
- Terminal color support (yoctocolors-cjs)
- Logging with symbols (✓ ✗ ⚠ ℹ)

---

## 15. STATISTICS

| Metric | Value |
|--------|-------|
| TypeScript files (src/) | 183 |
| Test files | 36 |
| Total src size | 1.5M |
| Total test size | 748K |
| Build output size | 6.7M |
| Package.json exports | 120+ |
| Environment vars (env/) | 68 |
| Constants modules | 14 |
| Package utilities (packages/) | 12 |
| Build scripts | 7 main scripts |
| Dev dependencies | 65+ |
| Runtime dependencies | 1 |

---

## Summary

Socket Lib is a mature, well-organized infrastructure library with:
- **Clear structure**: Source organized by functionality
- **Comprehensive features**: 180+ utility modules
- **Strong standards**: Adheres to socket-registry guidelines
- **Good automation**: Build system, testing, linting
- **Modern tooling**: esbuild, Vitest, TypeScript, Biome
- **Production-ready**: Used across Socket projects
- **Well-documented**: Getting started guide, build docs, and contributor resources

