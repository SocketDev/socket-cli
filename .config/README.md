# Shared Configuration

This directory contains shared configuration files for the socket-cli monorepo. All packages should extend these base configurations to ensure consistency and reduce duplication.

## Files

### TypeScript Configurations

- **`tsconfig.base.json`** - Base TypeScript configuration with strict type checking
  - ES2024 target
  - Strict mode with exactOptionalPropertyTypes
  - noUncheckedIndexedAccess for safer array/object access
  - Designed for @typescript/native-preview compatibility

- **`tsconfig.build.json`** - Extends base config for build outputs
  - Enables declaration generation
  - Enables composite/incremental builds
  - Use for packages that need to emit .d.ts files

- **`tsconfig.test.json`** - Extends base config for test files
  - Relaxes noUnusedLocals/noUnusedParameters for test code
  - Use in test-specific tsconfig files

### Vitest Configuration

- **`vitest.config.base.mts`** - Base Vitest test configuration
  - Node environment
  - Thread pool with optimal settings
  - Coverage configuration with v8 provider
  - isolate: false for performance (see comments for rationale)
  - Packages should extend and merge with this config

### ESLint Configuration

- **`eslint.config.mjs`** - Flat config ESLint setup
  - TypeScript support with @typescript-eslint
  - Import ordering with eslint-plugin-import-x
  - Node.js plugin rules
  - Biome and .gitignore pattern integration
  - Sort destructured keys enforcement

### Build Utilities

- **`esbuild-inject-import-meta.mjs`** - Polyfill for import.meta.url in CommonJS
  - Used with esbuild's inject option
  - Converts __filename to file:// URL format

## Usage

### TypeScript - Package Config

Packages should extend the base config and specify their own include/exclude:

```json
{
  "extends": "../../.config/tsconfig.base.json",
  "include": ["src/**/*.mts", "src/**/*.d.ts"],
  "exclude": [
    "src/**/*.test.mts",
    "dist/**",
    "node_modules/**"
  ]
}
```

### Vitest - Package Config

Packages should merge the base config with their specific settings:

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
      // Override coverage thresholds if needed
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

### Vitest - Simple Package Config

For packages with minimal test config needs:

```typescript
import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/vitest.config.base.mts'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      testTimeout: 120000, // Override for long-running tests
    },
  })
)
```

### ESLint

The root ESLint config is already set up to work across the entire monorepo. No per-package ESLint configs are needed unless you have package-specific rules.

### esbuild

Use the import.meta polyfill in esbuild configs:

```javascript
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default {
  // ... other config
  inject: [path.join(__dirname, '../../.config/esbuild-inject-import-meta.mjs')],
}
```

## Benefits

1. **Single source of truth** - All shared settings in one place
2. **Consistency** - All packages use the same base configuration
3. **Easy maintenance** - Update once, applies everywhere
4. **Reduced duplication** - Packages only specify what's unique
5. **Better defaults** - Proven settings with documented rationale

## Migration

To migrate a package to use shared configs:

1. Update tsconfig.json to extend from `../../.config/tsconfig.base.json`
2. Update vitest.config.mts to merge with `../../.config/vitest.config.base.mts`
3. Remove duplicate configuration options
4. Keep only package-specific overrides
5. Test that builds and tests still work

See the documentation in docs/ for detailed migration guides.
