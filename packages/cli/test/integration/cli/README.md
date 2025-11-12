# CLI Command Integration Tests

Tests CLI commands by spawning the actual CLI binary and verifying command-line interface behavior.

## What These Tests Do

These tests verify that CLI commands work correctly when invoked through the binary:
- Command parsing and validation
- Help text and usage information
- Flag handling
- Exit codes
- Error messages
- Dry-run behavior

## Difference from Unit Tests

| Aspect | Unit Tests (`test/unit/`) | CLI Integration Tests (here) |
|--------|---------------------------|------------------------------|
| **What** | Individual functions | Complete CLI commands |
| **How** | Direct function calls | Spawn CLI binary |
| **Speed** | Fast (~ms per test) | Medium (~100ms per test) |
| **Isolation** | Mocked dependencies | Real process execution |
| **Examples** | `handleScan()`, `fetchData()` | `socket scan --help` |

## Test Pattern

```typescript
import { cmdit, spawnSocketCli } from '../../utils.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket scan', () => {
  cmdit(
    ['scan', '--help'],
    'should display help',
    async (cmd) => {
      const { code, stdout, stderr } = await spawnSocketCli(binCliPath, cmd)

      expect(code).toBe(0)
      expect(stdout).toContain('Manage Socket scans')
    }
  )
})
```

## Running Tests

```bash
# Run all CLI integration tests
pnpm test:unit test/integration/cli

# Run specific command tests
pnpm test:unit test/integration/cli/cmd-scan.test.mts

# Run with pattern
pnpm test:unit test/integration/cli -t "should display help"
```

## Test Files (78 total)

All `cmd-*.test.mts` files that spawn the CLI binary:

- `cmd-analytics.test.mts` - Analytics commands
- `cmd-audit-log.test.mts` - Audit log commands
- `cmd-ci.test.mts` - CI integration
- `cmd-config-*.test.mts` - Configuration commands
- `cmd-fix.test.mts` - Fix command
- `cmd-install*.test.mts` - Install commands
- `cmd-json.test.mts` - JSON output
- `cmd-login.test.mts` - Login/auth
- `cmd-logout.test.mts` - Logout
- `cmd-manifest-*.test.mts` - Manifest generation
- `cmd-npm*.test.mts` - npm wrapper
- `cmd-npx*.test.mts` - npx wrapper
- `cmd-optimize*.test.mts` - Optimize command
- `cmd-organization-*.test.mts` - Organization commands
- `cmd-package-*.test.mts` - Package info
- `cmd-patch-*.test.mts` - Patch commands
- `cmd-pip.test.mts` - pip wrapper
- `cmd-pnpm*.test.mts` - pnpm wrapper
- `cmd-raw-npm.test.mts` - Raw npm
- `cmd-raw-npx.test.mts` - Raw npx
- `cmd-repository-*.test.mts` - Repository commands
- `cmd-scan-*.test.mts` - Scan commands
- `cmd-threat-feed.test.mts` - Threat feed
- `cmd-uninstall*.test.mts` - Uninstall commands
- `cmd-whoami.test.mts` - Whoami
- `cmd-wrapper-*.test.mts` - Package manager wrappers
- `cmd-yarn*.test.mts` - yarn wrapper
- `cli.test.mts` - Main CLI

## Test Utilities

### `spawnSocketCli(binPath, args)`

Spawns the CLI binary with given arguments and returns:
- `code` - Exit code
- `stdout` - Standard output
- `stderr` - Standard error

### `cmdit(args, description, testFn)`

Convenience wrapper for common CLI test pattern:
- Automatically handles `--config {}` for isolation
- Provides consistent test structure
- Snapshot-friendly output

### `expectDryRunOutput(output)`

Validates dry-run output format to prevent flipped snapshots.

## Related Test Types

```
test/
├── unit/commands/               → Pure unit tests (95 files)
│   ├── handle-*.test.mts       → Handler functions
│   ├── fetch-*.test.mts        → Data fetching
│   └── output-*.test.mts       → Output formatting
├── integration/
│   ├── cli/                    → CLI integration tests (78 files) ← YOU ARE HERE
│   ├── binary/                 → Distribution tests (JS/smol/SEA)
│   └── api/                    → API integration tests
```

## Key Insights

**Why separate from unit tests?**

1. **Different concerns**:
   - Unit: Does the function work?
   - CLI Integration: Does the command work?

2. **Different speed**:
   - Unit: ~48s for 266 tests
   - CLI Integration: ~2min for 78 tests (process spawning overhead)

3. **Different failures**:
   - Unit: Function logic bugs
   - CLI Integration: CLI parsing, command wiring, integration issues

**What should be unit tested vs CLI tested?**

✓ **Unit test** (`test/unit/`):
- `handleScan(options)` - handler logic
- `fetchScanData(id)` - data fetching
- `outputScanResults(data)` - formatting
- Business logic, transformations, validations

✓ **CLI integration test** (`test/integration/cli/`):
- `socket scan --help` - help text
- `socket scan create --dry-run` - dry-run behavior
- `socket scan list --json` - JSON output format
- Command interface, flags, error messages

## Migration Notes

These tests were moved from `test/unit/commands/` to properly categorize them as integration tests. They spawn real CLI processes rather than calling functions directly, making them integration tests by definition.

**Moved**: 78 `cmd-*.test.mts` files that use `spawnSocketCli()` or `executeCliCommand()`
**Kept**: 95 `handle-*.test.mts`, `fetch-*.test.mts`, `output-*.test.mts` files in `test/unit/commands/`
