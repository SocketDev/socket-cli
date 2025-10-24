# Shared Configuration Architecture

This document describes the shared configuration architecture for the socket-cli monorepo.

## Design Principles

1. **Single Source of Truth** - All shared configuration lives in `.config/` at the root
2. **Minimal Duplication** - Packages extend base configs, not copy them
3. **Easy Maintenance** - Update configuration in one place
4. **Progressive Enhancement** - Packages can override when needed
5. **Explicit Overrides** - Clear separation between base and custom settings

## Directory Structure

```
socket-cli/
├── .config/                          # Shared configuration (NEW)
│   ├── README.md                     # Usage documentation
│   ├── tsconfig.base.json            # Base TypeScript config
│   ├── tsconfig.build.json           # Build-specific TS config
│   ├── tsconfig.test.json            # Test-specific TS config
│   ├── vitest.config.base.mts        # Base Vitest config
│   ├── eslint.config.mjs             # ESLint flat config
│   └── esbuild-inject-import-meta.mjs # esbuild helper
├── biome.json                        # Biome formatter (root-only)
├── tsconfig.json                     # Root TS config (extends .config)
├── vitest.config.mts                 # Root Vitest config (already uses patterns from base)
├── vitest.config.isolated.mts        # Isolated test config (special purpose)
├── vitest.e2e.config.mts             # E2E test config (special purpose)
└── packages/
    ├── cli/
    │   ├── tsconfig.json             # Extends ../../.config/tsconfig.base.json
    │   ├── vitest.config.mts         # Merges ../../.config/vitest.config.base.mts
    │   └── .config/                  # Package-specific build configs
    │       ├── tsconfig.check.json   # Type checking with custom paths
    │       ├── esbuild.cli.build.mjs # CLI build config
    │       └── babel.config.js       # Babel for React components
    ├── cli-with-sentry/
    │   ├── tsconfig.json             # Extends ../../.config/tsconfig.base.json
    │   └── vitest.config.mts         # Merges ../../.config/vitest.config.base.mts
    ├── socket/
    │   ├── tsconfig.json             # Extends ../../.config/tsconfig.base.json
    │   └── vitest.config.mts         # Merges ../../.config/vitest.config.base.mts
    └── socketbin-*/
        ├── tsconfig.json             # Extends ../../.config/tsconfig.base.json
        └── vitest.config.mts         # Merges ../../.config/vitest.config.base.mts
```

## Configuration Files

### TypeScript Configurations

#### `.config/tsconfig.base.json`

Base TypeScript configuration with strict settings:

- **Target**: ES2024
- **Module**: nodenext (Node.js ESM + CJS)
- **Strict Mode**: Full TypeScript strict mode
- **Extra Safety**:
  - `exactOptionalPropertyTypes: true`
  - `noUncheckedIndexedAccess: true`
  - `noPropertyAccessFromIndexSignature: true`
- **Compatibility**: Designed for @typescript/native-preview

**When to use**: All TypeScript projects should extend this.

#### `.config/tsconfig.build.json`

Extends base config for build outputs:

- Enables `declaration: true` (generate .d.ts files)
- Enables `declarationMap: true` (source maps for declarations)
- Enables `composite: true` (project references)
- Enables `incremental: true` (faster rebuilds)

**When to use**: Packages that need to emit type declarations.

#### `.config/tsconfig.test.json`

Extends base config for test files:

- Relaxes `noUnusedLocals: false`
- Relaxes `noUnusedParameters: false`

**When to use**: Test-specific type checking configs.

### Vitest Configuration

#### `.config/vitest.config.base.mts`

Base Vitest test runner configuration:

- **Environment**: Node.js
- **Pool**: Threads with optimal settings
  - `isolate: false` for performance and mocking compatibility
  - `maxThreads: 16` (or 1 for coverage)
  - `minThreads: 4` (or 1 for coverage)
- **Timeouts**: 30 seconds for tests and hooks
- **Coverage**: v8 provider with comprehensive settings
- **Exclusions**: Standard patterns (node_modules, dist, etc.)

**When to use**: All packages should merge this config.

### ESLint Configuration

#### `.config/eslint.config.mjs`

Flat config ESLint setup for the entire monorepo:

- **TypeScript Support**: @typescript-eslint with type checking disabled (performance)
- **Import Rules**: eslint-plugin-import-x with auto-fix ordering
- **Node.js Rules**: eslint-plugin-n for Node.js compatibility
- **Custom Rules**:
  - Sort destructured keys
  - Prefer const
  - No await in loop (warning)
  - Unicorn rules for best practices
- **Integration**: Imports patterns from biome.json and .gitignore

**When to use**: Applies automatically to entire monorepo. Packages rarely need custom configs.

### Build Utilities

#### `.config/esbuild-inject-import-meta.mjs`

Polyfill for import.meta.url in CommonJS bundles:

```javascript
export const __importMetaUrl =
  typeof __filename !== 'undefined'
    ? `file://${__filename.replace(/\\/g, '/')}`
    : 'file:///unknown'
```

**When to use**: esbuild configs that bundle to CommonJS but need import.meta.url support.

## Configuration Patterns

### Pattern 1: Simple Package

Minimal custom configuration:

**tsconfig.json**:
```json
{
  "extends": "../../.config/tsconfig.base.json",
  "include": ["src/**/*.mts"],
  "exclude": ["src/**/*.test.mts", "dist/**"]
}
```

**vitest.config.mts**:
```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.test.{mts,ts}'],
    },
  })
)
```

### Pattern 2: Package with Custom Paths

TypeScript path mappings for local dependencies:

**tsconfig.json**:
```json
{
  "extends": "../../.config/tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@socketsecurity/lib": ["../../socket-lib/dist/index.d.ts"]
    }
  },
  "include": ["src/**/*.mts"],
  "exclude": ["src/**/*.test.mts", "dist/**"]
}
```

### Pattern 3: Package with Custom Coverage

Override coverage thresholds:

**vitest.config.mts**:
```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.test.{mts,ts}'],
      coverage: {
        thresholds: {
          lines: 0,
          functions: 0,
          branches: 0,
          statements: 0,
        },
      },
    },
  })
)
```

### Pattern 4: Package with Build-Specific Configs

Separate configs for different purposes:

```
packages/cli/.config/
├── tsconfig.base.json        # Base settings (can extend root)
├── tsconfig.check.json       # Type checking with custom paths
├── esbuild.cli.build.mjs     # CLI build config
└── babel.config.js           # React component transpilation
```

## Rationale for Key Decisions

### TypeScript: noUncheckedIndexedAccess

**Decision**: Enabled by default

**Rationale**:
- Prevents common runtime errors from undefined array/object access
- Enforces defensive programming
- TypeScript best practice for modern codebases

**Trade-off**: More verbose code with optional chaining and checks

### Vitest: isolate: false

**Decision**: Disabled by default

**Rationale**:
- Significant performance improvement (2-3x faster)
- Required for nock HTTP mocking to work
- Required for vi.mock() module mocking
- Test pollution prevented by proper beforeEach/afterEach
- Socket projects have well-designed tests with cleanup

**Trade-off**: Shared worker context across tests (acceptable with good practices)

### ESLint: Type-Aware Linting Disabled

**Decision**: project: null in parserOptions

**Rationale**:
- Type-aware linting causes performance issues on large codebases
- Can hang for minutes on full monorepo checks
- Most type errors caught by TypeScript compiler anyway
- Linting should be fast, type checking should be separate

**Trade-off**: Some rules like @typescript-eslint/return-await won't work

### Single ESLint Config

**Decision**: One root config, not per-package

**Rationale**:
- ESLint flat config works across entire monorepo naturally
- Reduces duplication significantly
- Easier to maintain consistency
- Packages rarely need custom rules

**Trade-off**: Packages can't easily override rules (but this is rarely needed)

## Benefits

1. **Reduced Duplication**: 100+ lines of config per package → 5-10 lines
2. **Easier Onboarding**: New packages start with proven configs
3. **Consistency**: All packages use same base settings
4. **Faster Updates**: Change config once, applies everywhere
5. **Better Defaults**: Settings chosen based on Socket experience
6. **Documentation**: Centralized documentation for all configs

## Future Enhancements

Potential improvements to the architecture:

1. **Shared Scripts**: Extract common build scripts to `.config/scripts/`
2. **TypeScript Project References**: Enable composite builds for faster incremental compilation
3. **Shared Test Utilities**: Move test helpers to a shared package
4. **Shared Constants**: Extract build constants used across packages
5. **Config Validation**: Script to verify all packages extend base configs correctly

## Related Documentation

- [Configuration Migration Guide](./configuration-migration.md) - How to migrate packages
- [.config/README.md](../.config/README.md) - Usage examples and reference
- [CI Testing](./ci-testing.md) - CI/CD integration
- [Testing Best Practices](./testing-best-practices.md) - Test writing guidelines
