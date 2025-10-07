# CLAUDE.md

🚨 **MANDATORY**: Act as principal-level engineer with deep expertise in TypeScript, Node.js, and CLI development.

## 📚 SHARED STANDARDS

**See canonical reference:** `../socket-registry/CLAUDE.md`

For all shared Socket standards (git workflow, testing, code style, imports, sorting, error handling, cross-platform, CI, etc.), refer to socket-registry/CLAUDE.md.

**Git Workflow Reminder**: When user says "commit changes" → create actual commits, use small atomic commits, follow all CLAUDE.md rules (NO AI attribution).

---

## 🏗️ CLI-SPECIFIC

### Architecture
CLI tool for Socket.dev security analysis - TypeScript with .mts extensions

**Core Structure**:
- **Entry**: `src/cli.mts` - Main CLI with meow subcommands
- **Commands**: `src/commands.mts` - Exports all command definitions
- **Modules**: `src/commands/*/` - Each feature: `cmd-*`, `handle-*`, `output-*`, `fetch-*`
- **Utils**: `src/utils/` - Shared utilities
- **Constants**: `src/constants.mts`
- **Types**: `src/types.mts`

**Command Pattern**: `cmd-*.mts` (CLI interface), `handle-*.mts` (business logic), `output-*.mts` (formatting), `fetch-*.mts` (API calls)

**Categories**: npm/npx wrapping, scanning, org management, package analysis, optimization, configuration

**Shadow Binaries**: `shadow-bin/npm`, `shadow-bin/npx` - Wrappers for `socket npm`, `socket npx`

### Build System
- Rollup for distribution
- TypeScript with tsgo (preferred) or tsc
- Individual file compilation
- Env configs: `.env.local`, `.env.test`, `.env.dist`

### Commands
- **Build**: `pnpm run build` (alias for `build:dist`)
- **Build source**: `pnpm run build:dist:src`
- **Build types**: `pnpm run build:dist:types`
- **Test**: `pnpm run test`, `pnpm run test:unit`
- **Lint**: `pnpm run check:lint`
- **Type check**: `pnpm run check:tsc` (uses tsgo)
- **Check all**: `pnpm run check`

**Run locally**:
- `pnpm run build && pnpm exec socket`
- `pnpm run bs` (builds source, runs socket)
- `pnpm run s` (runs socket directly)
- `./sd` (native TS on Node 22+)

### CLI-Specific Patterns

#### Command Structure
🚨 MANDATORY - Each command: `cmd-*.mts`, `handle-*.mts`, `output-*.mts`

#### File Structure
- **Extensions**: `.mts`
- **Naming**: kebab-case (`cmd-scan-create.mts`, `handle-create-new-scan.mts`)
- **Module headers**: 🚨 MANDATORY `@fileoverview` headers

#### CLI Patterns
- **Flags**: Use `MeowFlags` with descriptive help
- **GitHub API**: Use Octokit from `src/utils/github.mts`, not raw fetch
- **Null-prototype**: `{ __proto__: null, key: val }` or `Object.create(null)` for empty

#### Error Handling
- **Input validation**: Use `InputError` from `src/utils/errors.mts`
- **Authentication**: Use `AuthError` from `src/utils/errors.mts`
- **Result pattern**: Use `CResult<T>` for fallible functions
- **Messages**: NO periods at end (see canonical socket-registry/CLAUDE.md)
- Examples:
  - ✅ `throw new InputError('No .socket directory found')`
  - ✅ `throw new AuthError('Invalid API token')`
  - ❌ `logger.error('Error occurred'); return`

### Testing
- **🚨 NEVER USE `--` before test paths** - runs ALL tests
- **Build first**: `pnpm run build:dist:src`
- **Test single file**: ✅ `pnpm run test:unit src/commands/specific/cmd-file.test.mts`
- **Update snapshots**: ✅ `pnpm run testu src/commands/specific/cmd-file.test.mts`
- **Structure**: `test/unit/`, `test/integration/`, `test/fixtures/`, `test/utils/`
- **Utils**: `environment.mts`, `fixtures.mts`, `mock-helpers.mts`, `constants.mts`

### CI Testing
- **🚨 MANDATORY**: `SocketDev/socket-registry/.github/workflows/ci.yml@<SHA>` with full SHA
- **Format**: `@662bbcab1b7533e24ba8e3446cffd8a7e5f7617e # main`
- **Docs**: `docs/CI_TESTING.md`, `socket-registry/docs/CI_TESTING_TOOLS.md`

### Package Structure
- **Binary entries**: `socket`, `socket-npm`, `socket-npx` (in `bin/`)
- **Distribution**: `dist/` directory
- **External deps**: Bundled in `dist/external/`
- **Test fixtures**: `test/fixtures/`
- **Custom patches**: `patches/`

### Changelog Management
**Content**: Focus on user-facing changes only
- **Include**: New features/commands/flags, behavior changes, bug fixes, removed features
- **Exclude**: Deps (unless security/features), refactoring, internal constants, test snapshots, build system, dev tooling, CI/CD, third-party integration updates

**Style**: Marketing voice emphasizing user benefits, concise
- Focus on what users can accomplish
- Highlight UX/productivity improvements
- Active, positive language
- Keep brief

**Third-party integrations**: @coana-tech/cli, cdxgen, synp

### Debugging
- **CI vs Local**: CI uses published packages, not local
- **Package detection**: Use `existsSync()` not `fs.access()`
