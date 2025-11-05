# CLAUDE.md

🚨 **MANDATORY**: Act as principal-level engineer with deep expertise in TypeScript, Node.js, and SDK development.

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
- ✓ Success/checkmark - MUST be green (NOT ✅)
- ✗ Error/failure - MUST be red (NOT ❌)
- ⚠ Warning/caution - MUST be yellow (NOT ⚠️)
- ℹ Info - MUST be blue (NOT ℹ️)
- → Step/progress - MUST be cyan (NOT ➜ or ▶)

**Color Requirements** (apply color to icon ONLY, not entire message):
```javascript
import colors from 'yoctocolors-cjs'

`${colors.green('✓')} ${msg}`   // Success
`${colors.red('✗')} ${msg}`     // Error
`${colors.yellow('⚠')} ${msg}`  // Warning
`${colors.blue('ℹ')} ${msg}`    // Info
`${colors.cyan('→')} ${msg}`    // Step/Progress
```

**Color Package**:
- Use `yoctocolors-cjs` (NOT `yoctocolors` ESM package)
- Pinned dev dependency in all Socket projects
- CommonJS compatibility for scripts and tooling

**Allowed Emojis** (use sparingly):
- 📦 Packages
- 💡 Ideas/tips
- 🚀 Launch/deploy/excitement
- 🎉 Major success/celebration

**General Philosophy**:
- Prefer colored text-based symbols (✓✗⚠ℹ→) for maximum terminal compatibility
- Always color-code symbols: green=success, red=error, yellow=warning, blue=info, cyan=step
- Use emojis sparingly for emphasis and delight
- Avoid emoji overload - less is more
- When in doubt, use plain text

---

## 🏗️ SDK-SPECIFIC

### Architecture
Socket SDK for JavaScript/TypeScript - Programmatic access to Socket.dev security analysis

**Core Structure**:
- **Entry**: `src/index.ts`
- **SDK Class**: `src/socket-sdk-class.ts` - All API methods
- **HTTP Client**: `src/http-client.ts` - Request/response handling
- **Types**: `src/types.ts` - TypeScript definitions
- **Utils**: `src/utils.ts` - Shared utilities
- **Constants**: `src/constants.ts`

**Features**: Full TypeScript support, API client, package analysis, security scanning, org/repo management, SBOM support, batch operations, file uploads

### Commands
- **Build**: `pnpm build` (production build)
- **Watch**: `pnpm build --watch` (dev mode with 68% faster incremental builds)
- **Test**: `pnpm test`
- **Test runner**: `pnpm run test:run` (glob support)
- **Type check**: `pnpm tsc`
- **Lint**: `pnpm check:lint`
- **Check all**: `pnpm check`
- **Coverage**: `pnpm run test:unit:coverage`, `pnpm run coverage:percent`

**Development tip:** Use `pnpm build --watch` for 68% faster rebuilds (9ms vs 27ms). See `docs/incremental-builds.md` for details.

### Configuration Files

All configuration files are organized in `.config/` directory for cleanliness:

| File | Purpose | When to Modify |
|------|---------|----------------|
| **tsconfig.json** | Main TS config (extends tsconfig.base.json) | Rarely - only for project-wide TS changes |
| **.config/tsconfig.base.json** | Base TS settings (strict mode, targets) | Rarely - shared TS configuration |
| **.config/tsconfig.check.json** | Type checking for ESLint resolver | Never - auto-used by ESLint |
| **.config/tsconfig.dts.json** | Declaration file generation settings | Rarely - only for type output changes |
| **.config/esbuild.config.mjs** | Build orchestration (ESM output, node18+ target) | When adding new entry points or build steps |
| **.config/eslint.config.mjs** | Linting rules (flat config format) | When adding new lint rules |
| **.config/vitest.config.mts** | Main test config (default runner) | When changing test setup or plugins |
| **.config/vitest.config.isolated.mts** | Isolated test config (for vi.doMock() tests) | Never - only for isolated test mode |
| **.config/vitest.coverage.config.mts** | Shared coverage thresholds (≥99%) | When adjusting coverage requirements |
| **.config/isolated-tests.json** | List of tests requiring isolation | When adding tests that use vi.doMock() |
| **.config/taze.config.mts** | Dependency update tool settings | When changing update policies |
| **biome.json** | Code formatting + linting (replaces Prettier/ESLint) | When adding format/lint rules |

**Why multiple TypeScript configs?**
- `tsconfig.json` - Main config for building the SDK
- `tsconfig.check.json` - ESLint needs separate config for type checking imports
- `tsconfig.dts.json` - Declaration file generation has different output requirements

**Why multiple Vitest configs?**
- `vitest.config.mts` - Standard test mode (default, fastest)
- `vitest.config.isolated.mts` - Process isolation for tests using `vi.doMock()` (slower)
- `vitest.coverage.config.mts` - Shared coverage settings to avoid duplication

### SDK-Specific Patterns

#### Logger Standardization
All `logger.error()` and `logger.log()` calls include empty string:
- ✅ `logger.error('')`, `logger.log('')`
- ❌ `logger.error()`, `logger.log()`

#### File Structure
- **Extensions**: `.mts` for TypeScript modules
- **Module headers**: 🚨 MANDATORY `@fileoverview` headers
- **"use strict"**: ❌ FORBIDDEN in .mjs/.mts (ES modules are strict)

#### TypeScript Patterns
- **Semicolons**: Use semicolons (unlike other Socket projects)
- **Type safety**: ❌ FORBIDDEN `any`; use `unknown` or specific
- **Type imports**: Always `import type`

#### Working Directory
- **🚨 NEVER use `process.chdir()`** - use `{ cwd }` options and absolute paths instead
  - Breaks tests, worker threads, and causes race conditions
  - Always pass `{ cwd: absolutePath }` to spawn/exec/fs operations

#### API Method Organization
Documentation organized alphabetically within functional categories

#### Comprehensive Sorting (MANDATORY)
- **Type properties**: Required first, then optional; alphabetical within groups
- **Class members**: 1) Private properties, 2) Private methods, 3) Public methods (all alphabetical)
- **Object properties**: Alphabetical in literals (except semantic ordering)
- **Destructuring**: Alphabetical (`const { apiKey, baseUrl, timeout }`)

### Testing

**Vitest Configuration**: This repo uses the shared vitest configuration patterns documented in `../socket-registry/CLAUDE.md` (see "Vitest Configuration Variants" section). Two configs available:
- `.config/vitest.config.mts` - Main config (default)
- `.config/vitest.config.isolated.mts` - Full process isolation for vi.doMock()

#### Test Structure
- **Directories**: `test/` - Test files, `test/utils/` - Shared utilities
- **Naming**: Descriptive names
  - ✅ `socket-sdk-upload-manifest.test.mts`, `describe('SocketSdk - Upload Manifest')`
  - ❌ `test1.test.mts`, `describe('tests')`
- **Consolidated files**: `socket-sdk-api-methods.coverage.test.mts` - Comprehensive API method tests

#### Test Helpers (`test/utils/environment.mts`)

**setupTestClient(token?, options?)** - Combined nock setup + client creation (RECOMMENDED)
```typescript
import { setupTestClient } from './utils/environment.mts'

describe('My tests', () => {
  const getClient = setupTestClient('test-api-token', { retries: 0 })

  it('should work', async () => {
    const client = getClient()
    // ... test code
  })
})
```

**setupTestEnvironment()** - Just nock setup (for custom client creation)
```typescript
import { setupTestEnvironment, createTestClient } from './utils/environment.mts'

describe('My tests', () => {
  setupTestEnvironment()

  it('should work', async () => {
    const client = createTestClient('custom-token')
    // ... test code
  })
})
```

**createTestClient(token?, options?)** - Just client creation (no nock setup)
```typescript
const client = createTestClient('test-token', { retries: 0 })
```

**isCoverageMode** - Flag for coverage detection
```typescript
if (isCoverageMode) {
  // Skip tests that don't work well in coverage mode
}
```

#### Running Tests
- **All tests**: `pnpm test`
- **Specific file**: `pnpm run test:run <file>` (glob support)
- **Coverage**: `pnpm run cover` or `pnpm run test:unit:coverage`
- **Coverage percentage**: `pnpm run coverage:percent`

#### Best Practices
- **Use setupTestClient()**: Combines nock setup and client creation in one call
- **Use getClient() pattern**: Access client instance returned by setupTestClient()
- **Mock HTTP with nock**: All HTTP requests must be mocked
- **Auto cleanup**: Nock mocks cleaned automatically in beforeEach/afterEach
- **Test both paths**: Success + error paths for all methods
- **Cross-platform**: Test path handling on Windows and Unix
- **Follow patterns**: See `test/getapi-sendapi-methods.test.mts` for examples

### CI Testing
- **🚨 MANDATORY**: `SocketDev/socket-registry/.github/workflows/ci.yml@<SHA>` with full SHA
- **Format**: `@662bbcab1b7533e24ba8e3446cffd8a7e5f7617e # main`
- **Custom runner**: `scripts/test.mjs` with glob expansion
- **Memory**: Auto heap size (CI: 8GB, local: 4GB)
- **Docs**: `docs/CI_TESTING.md`, `socket-registry/docs/CI_TESTING_TOOLS.md`

### Changelog Management
**🚨 MANDATORY**: When creating changelog entries for version bumps:
- **Check OpenAPI updates**: Analyze `types/api.d.ts` changes
  ```bash
  git diff v{prev}..HEAD -- types/
  ```
- **Document user-facing changes**:
  - New endpoints (e.g., `/openapi.json`)
  - Updated parameter descriptions/behavior
  - New type categories/enum values (e.g., 'dual' threat type)
  - Breaking changes to API contracts
- **Focus**: User impact only, not internal infrastructure
- **Rationale**: OpenAPI changes directly impact SDK users

### Debugging
- **CI vs Local**: CI uses published npm packages, not local
- **Package detection**: Use `existsSync()` not `fs.access()`
- **Test failures**: Check unused nock mocks, ensure cleanup

### SDK Notes
- Windows compatibility important - test path handling
- Use utilities from @socketsecurity/registry where available
- Maintain consistency with surrounding code
