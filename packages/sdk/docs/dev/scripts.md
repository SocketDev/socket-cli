# Script Organization

Complex scripts are extracted to Node.js `.mjs` files in `scripts/` for better maintainability and cross-platform compatibility.

## Benefits

- **Customization**: Flags, conditional logic, complex workflows
- **Maintainability**: Easier to read, test, and modify
- **Cross-platform**: Consistent across Windows, macOS, Linux
- **Error handling**: Proper exit codes and messages
- **Reusability**: Shared utilities

## Directory Structure

```
scripts/
├── utils/
│   ├── run-command.mjs    # Command execution
│   └── path-helpers.mjs   # Path utilities
├── build.mjs              # Build orchestration
├── clean.mjs              # Clean artifacts
├── check.mjs              # Quality checks
├── lint-fix.mjs           # Auto-fix linting
├── coverage.mjs           # Coverage collection
└── test.mjs               # Test runner
```

## Core Utilities

### `run-command.mjs`

```javascript
import { runCommand, runSequence, runParallel } from './utils/run-command.mjs'

// Single command
await runCommand('rollup', ['-c', 'rollup.config.mjs'])

// Sequential
await runSequence([
  { command: 'pnpm', args: ['run', 'clean'] },
  { command: 'rollup', args: ['-c'] }
])

// Parallel
await runParallel([
  { command: 'pnpm', args: ['run', 'lint'] },
  { command: 'pnpm', args: ['run', 'check:tsc'] }
])
```

## Main Scripts

### `build.mjs`

Build with optional flags:
- `--src-only`: Build source only
- `--types-only`: Build types only
- `--watch`: Watch mode with incremental builds

```json
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:dist:src": "node scripts/build.mjs --src-only"
  }
}
```

### `clean.mjs`

Clean artifacts with granular control:
- `--cache`: Cache directories only
- `--coverage`: Coverage reports only
- `--dist`: Dist directory only
- `--all`: Everything (default)

```json
{
  "scripts": {
    "clean": "node scripts/clean.mjs",
    "clean:cache": "node scripts/clean.mjs --cache"
  }
}
```

### `check.mjs`

Run quality checks in parallel:
- TypeScript type checking
- ESLint linting

```json
{
  "scripts": {
    "check": "node scripts/check.mjs"
  }
}
```

### `lint-fix.mjs`

Run linters with auto-fix sequentially:
1. oxlint
2. biome
3. eslint

```json
{
  "scripts": {
    "fix": "node scripts/lint-fix.mjs"
  }
}
```

## Before vs After

### Before (Inline Scripts)
```json
{
  "scripts": {
    "build:dist": "pnpm run build:dist:src && pnpm run build:dist:types",
    "clean": "run-s -c clean:*",
    "lint:fix": "run-s -c lint:fix:oxlint lint:fix:biome lint:fix:eslint"
  }
}
```

**Issues:** Hard to customize, limited error handling, verbose, difficult to test

### After (Node.js Scripts)
```json
{
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:dist:src": "node scripts/build.mjs --src-only",
    "clean": "node scripts/clean.mjs",
    "fix": "node scripts/lint-fix.mjs"
  }
}
```

**Benefits:** Easy flags, proper error handling, cross-platform, testable

## Best Practices

1. **Meaningful flags**: `--src-only`, not `-s`
2. **JSDoc comments**: Document parameters
3. **Graceful errors**: Proper exit codes
4. **Log progress**: Use logger
5. **Focused scripts**: One responsibility
6. **Composability**: Scripts can call scripts
7. **Avoid shell: true**: Pass args as arrays
8. **Test edge cases**: Missing files, wrong flags

## Common Patterns

**Conditional execution:**
```javascript
if (condition) await runCommand('cmd', ['arg'])
```

**Sequential with early exit:**
```javascript
const exitCode = await runSequence([...])
if (exitCode !== 0) process.exitCode = exitCode
```

**Parallel execution:**
```javascript
const exitCodes = await runParallel([...])
const failed = exitCodes.some(code => code !== 0)
```

## Migration Steps

1. Copy `scripts/utils/` to your project
2. Identify complex scripts in `package.json`
3. Create `.mjs` files for each
4. Update `package.json` to reference new scripts
5. Test all scripts
6. Update CI/CD if needed
