# Configuration Migration Guide

This guide explains how to migrate packages in the socket-cli monorepo to use the shared configuration architecture.

## Overview

The monorepo now has shared configuration files in `.config/` at the root level. Packages should extend these base configurations instead of duplicating settings.

## Shared Configuration Files

### Location: `.config/`

- `tsconfig.base.json` - Base TypeScript settings
- `tsconfig.build.json` - For build outputs with declarations
- `tsconfig.test.json` - For test files
- `vitest.config.base.mts` - Base Vitest test configuration
- `eslint.config.mjs` - ESLint flat config (monorepo-wide)
- `esbuild-inject-import-meta.mjs` - Import.meta polyfill for esbuild

## Migration Steps by Configuration Type

### TypeScript Configuration

#### Before (Duplicated Config)

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "nodenext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    // ... 30+ more options
  },
  "include": ["src/**/*.mts"],
  "exclude": ["src/**/*.test.mts", "dist/**"]
}
```

#### After (Extended Config)

```json
{
  "extends": "../../.config/tsconfig.base.json",
  "include": ["src/**/*.mts"],
  "exclude": ["src/**/*.test.mts", "dist/**"]
}
```

#### With Custom Paths

For packages that need path mappings (like CLI with local dependencies):

```json
{
  "extends": "../../.config/tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@socketsecurity/lib": ["../../socket-lib/dist/index.d.ts"],
      "@socketsecurity/registry": ["../../socket-registry/registry/dist/index.d.ts"]
    }
  },
  "include": ["src/**/*.mts"],
  "exclude": ["src/**/*.test.mts", "dist/**"]
}
```

### Vitest Configuration

#### Before (Duplicated Config)

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.{mts,ts}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // ... many more patterns
    ],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 16,
        minThreads: 4,
        isolate: false,
        useAtomics: true,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'clover'],
      // ... many more options
    },
  },
})
```

#### After (Merged Config)

```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        'test/**/*.test.{mts,ts}',
        'src/**/*.test.{mts,ts}',
      ],
      setupFiles: ['./test/setup.mts'],
    },
  })
)
```

#### With Custom Settings

For packages with special needs (e.g., longer timeouts, custom coverage):

```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      testTimeout: 120_000, // 2 minutes for slow tests
      hookTimeout: 30_000,
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

### ESLint Configuration

#### Root Level Only

The ESLint configuration lives at the root and applies to the entire monorepo. Individual packages **do not** need their own ESLint configs.

#### Package-Specific Rules (Rare)

If a package truly needs custom ESLint rules, extend the root config:

```javascript
import rootConfig from '../../.config/eslint.config.mjs'

export default [
  ...rootConfig,
  {
    files: ['src/**/*.mts'],
    rules: {
      // Package-specific overrides
      'no-console': 'warn',
    },
  },
]
```

### esbuild Configuration

#### Before (Relative Paths)

```javascript
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default {
  // ... config
  inject: [path.join(__dirname, 'esbuild-inject-import-meta.mjs')],
}
```

#### After (Shared Utility)

```javascript
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

export default {
  // ... config
  inject: [path.join(rootPath, '..', '..', '.config', 'esbuild-inject-import-meta.mjs')],
}
```

## Package-by-Package Migration Plan

### Phase 1: Simple Packages (Low Risk)

Start with packages that have minimal custom configuration:

1. **packages/cli-with-sentry**
   - Simple vitest config (just timeout overrides)
   - Should extend base config easily

2. **packages/socketbin-custom-node-from-source**
   - Simple vitest config (just timeout overrides)
   - Should extend base config easily

3. **packages/socketbin-native-node-sea**
   - Simple vitest config (just timeout overrides)
   - Should extend base config easily

4. **packages/socket**
   - Simple vitest config with coverage overrides
   - Should extend base config easily

### Phase 2: Complex Package (Higher Risk)

5. **packages/cli**
   - Has complex .config/ subdirectory
   - Multiple TypeScript configs (base, check)
   - Custom esbuild configs
   - Should migrate carefully, keeping package-specific build configs

### Phase 3: Root Configs

6. **Root vitest configs**
   - `vitest.config.mts` - Already serves as template for base config
   - `vitest.config.isolated.mts` - Keep for isolated test runs
   - `vitest.e2e.config.mts` - Keep for E2E tests

## Migration Checklist

For each package:

- [ ] Read current tsconfig.json and identify custom settings
- [ ] Create new tsconfig.json that extends `../../.config/tsconfig.base.json`
- [ ] Move custom compilerOptions (paths, typeRoots, etc.) to new config
- [ ] Keep include/exclude patterns specific to the package
- [ ] Test: Run `pnpm tsc` to verify type checking still works

- [ ] Read current vitest.config.mts and identify custom settings
- [ ] Create new vitest.config.mts that merges with base config
- [ ] Move custom test settings (timeouts, includes, setupFiles) to new config
- [ ] Test: Run `pnpm test` to verify tests still pass

- [ ] Identify any package-specific eslint configs
- [ ] If none exist, no action needed (root config applies)
- [ ] If custom rules exist, evaluate if they should move to root or stay local

- [ ] Update esbuild configs to use shared import.meta inject helper
- [ ] Test: Run builds to verify output is correct

- [ ] Remove duplicate configuration files
- [ ] Update documentation if package has special config needs
- [ ] Commit changes with descriptive message

## Validation

After migration, verify:

1. **Type checking**: `pnpm tsc` passes
2. **Linting**: `pnpm check:lint` passes
3. **Tests**: `pnpm test` passes
4. **Build**: `pnpm build` produces expected output
5. **Coverage**: `pnpm run test:unit:coverage` works

## Rollback Plan

If migration causes issues:

1. Keep git history clean with one package per commit
2. Revert individual package commits if needed
3. Document any incompatibilities discovered
4. Update base configs to accommodate edge cases

## Benefits After Migration

1. **Reduced Lines of Code**: 50-100+ lines removed per package
2. **Single Source of Truth**: Update once, applies everywhere
3. **Consistency**: All packages use same base settings
4. **Easier Maintenance**: Less configuration to track
5. **Better Defaults**: Proven settings with documented rationale

## Questions or Issues?

If you encounter problems during migration:

1. Check `.config/README.md` for usage examples
2. Compare with already-migrated packages
3. Verify you're using mergeConfig for Vitest (not defineConfig alone)
4. Ensure extends paths are correct (../../.config/...)
5. Document any edge cases for future reference
