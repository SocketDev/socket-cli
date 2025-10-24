# Smart Test Selection

## Overview

Smart test selection automatically determines which tests to run based on file changes, dramatically improving development iteration speed.

**Performance impact**: 40-60% faster test runs by executing only affected tests instead of the entire suite.

**When full suite runs**:
- CI environment (`CI=true`)
- Explicit `--all` or `--force` flag
- Config file changes (`vitest.config`, `tsconfig`)
- Core utility file changes
- First-time build or no changes detected

## How It Works

### Git Integration

The test mapper uses git utilities from `@socketsecurity/lib/git` to detect changes:

```typescript
import { getChangedFilesSync, getStagedFilesSync } from '@socketsecurity/lib/git'

// Detects files with uncommitted changes
const changed = getChangedFilesSync()

// Detects files staged for commit
const staged = getStagedFilesSync()
```

### File Mapping Rules

Source files map to test files using pattern matching:

**Direct mapping** (basename match):
```
src/commands.mts → test/commands.test.mts
src/flags.mts → test/flags.test.mts
```

**Test files run themselves**:
```
test/utils.mts → test/utils.mts
```

**Special mappings** (multi-test impact):
```
src/package-url.ts → test/package-url.test.mts
                   → test/integration.test.mts

src/package-url-builder.ts → test/package-url-builder.test.mts
                            → test/integration.test.mts
```

**Data changes** (integration tests):
```
data/*.json → test/integration.test.mts
            → test/purl-types.test.mts
```

### Core Files Detection

Core utilities trigger full suite execution (affect all code):

```typescript
const CORE_FILES = [
  'src/helpers.ts',
  'src/strings.ts',
  'src/constants.ts',
  'src/lang.ts',
  'src/error.ts',
  'src/validate.ts',
  'src/normalize.ts',
  'src/encode.ts',
  'src/decode.ts',
  'src/objects.ts',
]
```

**Why**: These files provide foundational utilities used throughout the codebase. Changes here require comprehensive validation.

### Fallback Behavior

**No test mapping found**: Runs all tests (safer default)
**No changes detected**: Skips tests entirely
**Deleted test files**: Automatically excluded from execution

## Usage

### Basic Commands

```bash
# Run only affected tests (default behavior)
pnpm test

# Run tests for staged changes only
pnpm test --staged

# Force full suite execution
pnpm test --all

# Skip checks for faster iteration
pnpm test --fast

# Combine flags for staged + fast mode
pnpm test --staged --fast
```

### Advanced Usage

```bash
# Run with coverage for changed tests
pnpm test --coverage

# Update snapshots for affected tests
pnpm test --update

# Pass additional vitest arguments
pnpm test -- --reporter=dot

# Fast mode with coverage
pnpm test --fast --coverage
```

### Environment Variables

```bash
# Force all tests to run
FORCE_TEST=1 pnpm test

# Simulates CI behavior (always runs full suite)
CI=true pnpm test
```

### Example Workflows

**Feature development**:
```bash
# Edit source file
vi packages/cli/src/commands.mts

# Run affected tests only
pnpm test --fast

# Runs: test/commands.test.mts
```

**Core utility changes**:
```bash
# Edit core utility
vi packages/cli/src/helpers.ts

# Automatically runs full suite
pnpm test --fast

# Reason: Core file changes
```

**Testing staged commits**:
```bash
# Stage changes
git add packages/cli/src/flags.mts

# Test only staged changes
pnpm test --staged --fast

# Runs: test/flags.test.mts
```

## Mapping Rules Reference

### Source to Test Patterns

| Source Pattern | Test Pattern | Behavior |
|---------------|--------------|----------|
| `src/*.mts` | `test/*.test.mts` | Direct basename match |
| `src/commands/*.mts` | `test/commands/*.test.mts` | Subdirectory preserved |
| `src/helpers.ts` | All tests | Core file triggers full suite |
| `test/*.test.mts` | Self | Test files run themselves |
| `data/*.json` | `test/integration.test.mts` | Data changes run integration |
| `*.config.*` | All tests | Config changes run full suite |

### File Type Filtering

Smart selection only processes code files:

```typescript
const codeExtensions = ['.js', '.mjs', '.cjs', '.ts', '.cts', '.mts', '.json']
```

**Ignored files**: `.md`, `.txt`, `.log`, images, etc.

## Customization

### Adding New Mappings

Edit `/packages/cli/scripts/utils/changed-test-mapper.mjs`:

```typescript
function mapSourceToTests(filepath) {
  // Add custom mapping
  if (normalized.includes('src/custom-feature.ts')) {
    return ['test/custom-feature.test.mts', 'test/integration.test.mts']
  }

  // Existing mappings...
}
```

### Defining Core Files

Update the `CORE_FILES` array:

```typescript
const CORE_FILES = [
  'src/helpers.ts',
  'src/strings.ts',
  // Add new core file
  'src/new-core-utility.ts',
]
```

### Debugging Mappings

Add logging to see which tests are selected:

```typescript
export function getTestsToRun(options = {}) {
  const testInfo = /* ... */

  // Debug output
  console.log('Mode:', testInfo.mode)
  console.log('Reason:', testInfo.reason)
  console.log('Tests:', testInfo.tests)

  return testInfo
}
```

Or use verbose vitest output:

```bash
pnpm test -- --reporter=verbose
```

## Architecture

### Implementation Files

**Test runner** (`packages/cli/scripts/test.mjs`):
- Orchestrates check → build → test workflow
- Parses command-line flags
- Invokes test mapper

**Test mapper** (`packages/cli/scripts/utils/changed-test-mapper.mjs`):
- Detects changed/staged files via git
- Maps source files to test files
- Determines full vs. selective execution

**Interactive runner** (`packages/cli/scripts/utils/interactive-runner.mjs`):
- Provides TTY-aware test execution
- Handles Ctrl+O for options menu

### Data Flow

```
User runs: pnpm test --staged
                ↓
scripts/test.mjs parses flags
                ↓
getTestsToRun({ staged: true })
                ↓
getStagedFilesSync() via git
                ↓
mapSourceToTests() for each file
                ↓
Returns: { tests: ['test/flags.test.mts'], mode: 'staged' }
                ↓
vitest runs: test/flags.test.mts
```

### Exit Codes

- `0` - All tests passed
- `1` - Tests failed or error occurred
- `128+` - Signal termination (SIGINT, SIGTERM)

## Best Practices

**During development**:
```bash
# Quick iteration loop
pnpm test --fast           # Run checks + affected tests
git add .                  # Stage changes
pnpm test --staged --fast  # Verify staged changes
git commit                 # Commit with confidence
```

**Before push**:
```bash
# Full validation
pnpm test --all            # Run entire suite
```

**In CI**:
```bash
# Automatic full suite execution (CI=true)
pnpm test
```

**Debugging test selection**:
```bash
# See which tests would run without executing
git status                 # Check changed files
git diff --name-only       # List changed file names
```

## Troubleshooting

**Tests not running when expected**:
- Check if file has corresponding test file
- Verify file extension matches code extensions
- Ensure test file exists and isn't deleted

**Too many tests running**:
- Check if you modified a core file
- Verify config files aren't changed
- Use `--staged` to test only staged changes

**No tests running**:
- Verify you have uncommitted changes
- Check git status shows modified files
- Use `--all` to force full suite execution

**Test mapper issues**:
- Review `/packages/cli/scripts/utils/changed-test-mapper.mjs`
- Add console.log statements for debugging
- Check git utilities are working correctly
