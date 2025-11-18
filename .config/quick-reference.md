# Shared Configuration Quick Reference

Quick reference for using shared configurations in socket-cli monorepo packages.

## TypeScript

### Basic Package

```json
{
  "extends": "../../.config/tsconfig.base.json",
  "include": ["src/**/*.mts", "src/**/*.d.ts"],
  "exclude": ["src/**/*.test.mts", "dist/**", "node_modules/**"]
}
```

### For Build Output

```json
{
  "extends": "../../.config/tsconfig.build.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.mts"],
  "exclude": ["src/**/*.test.mts"]
}
```

## Vitest

### Basic Package

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
    },
  })
)
```

### With Setup Files

```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.test.{mts,ts}'],
      setupFiles: ['./test/setup.mts'],
    },
  })
)
```

### With Custom Timeouts

```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      testTimeout: 120_000, // 2 minutes
      hookTimeout: 30_000,
    },
  })
)
```

### With Custom Coverage

```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  })
)
```

### With Aliases

```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    test: {
      include: ['test/**/*.test.{mts,ts}'],
    },
  })
)
```

## ESLint

### Default (Root Config Applies)

No package-specific config needed. The root `.config/eslint.config.mjs` applies to all packages.

### With Package-Specific Rules (Rare)

```javascript
import rootConfig from '../../.config/eslint.config.mjs'

export default [
  ...rootConfig,
  {
    files: ['src/**/*.mts'],
    rules: {
      'no-console': 'warn',
    },
  },
]
```

## esbuild

### Using Import.meta Polyfill

```javascript
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configDir = path.join(__dirname, '..', '..', '.config')

export default {
  // ... other config
  inject: [path.join(configDir, 'esbuild-inject-import-meta.mjs')],
  define: {
    'import.meta.url': '__importMetaUrl',
  },
}
```

## Common Patterns

### Minimal Package Setup

For a new package with minimal custom configuration:

1. **tsconfig.json**: Extend base + specify include/exclude
2. **vitest.config.mts**: Merge base + specify include
3. **No ESLint config** (root config applies automatically)

### Package with Tests

Add setupFiles if you have test utilities:

```typescript
// vitest.config.mts
test: {
  setupFiles: ['./test/setup.mts'],
}
```

### Package with Special Coverage Needs

Override coverage thresholds in vitest config:

```typescript
test: {
  coverage: {
    thresholds: {
      lines: 0,      // Disable threshold
    },
  },
}
```

## Troubleshooting

### TypeScript: Module not found

Check that extends path is correct:
```json
"extends": "../../.config/tsconfig.base.json"  // ✓
"extends": "../.config/tsconfig.base.json"     // ✗ (wrong level)
```

### Vitest: Config not merged

Use `mergeConfig`, not just `defineConfig`:
```typescript
import { defineConfig, mergeConfig } from 'vitest/config'  // ✓
import { defineConfig } from 'vitest/config'                // ✗ (missing mergeConfig)
```

### ESLint: Rules not applying

The root config applies automatically. Check:
1. File is not in .gitignore or biome.json excludes
2. File extension matches ESLint config patterns
3. Run `pnpm check:lint` from root, not package

### esbuild: Import.meta.url undefined

Add inject and define:
```javascript
inject: [path.join(configDir, 'esbuild-inject-import-meta.mjs')],
define: {
  'import.meta.url': '__importMetaUrl',
}
```

## Commands

### Type Check
```bash
pnpm tsc                    # Check all files
pnpm tsc --noEmit          # Check without output
```

### Lint
```bash
pnpm check:lint            # Lint entire monorepo
pnpm check:lint --fix      # Auto-fix issues
```

### Test
```bash
pnpm test                  # Run all tests
pnpm run test:run <file>   # Run specific test
pnpm run cover             # Run with coverage
```

### Build
```bash
pnpm build                 # Build all packages
pnpm build --watch         # Watch mode
```

## Files Reference

- `.config/tsconfig.base.json` - Base TypeScript config
- `.config/tsconfig.build.json` - For build outputs
- `.config/tsconfig.test.json` - For test files
- `.config/vitest.config.base.mts` - Base Vitest config
- `.config/eslint.config.mjs` - ESLint flat config
- `.config/esbuild-inject-import-meta.mjs` - Import.meta polyfill

## Documentation

- [README.md](./README.md) - Full usage documentation
- [docs/shared-configuration-architecture.md](../docs/shared-configuration-architecture.md) - Design and rationale
- [docs/configuration-migration.md](../docs/configuration-migration.md) - Migration guide
- [docs/configuration-summary.md](../docs/configuration-summary.md) - Overview and roadmap
