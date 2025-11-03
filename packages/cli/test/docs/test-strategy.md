# Socket CLI Test Strategy

## Current Test Architecture

```
packages/cli/
├── test/unit/                (188 files)  → Unit tests
│   ├── commands/              (95 files)  → Command handler functions
│   └── ...                                → Utils, types, etc.
├── test/integration/
│   ├── cli/                   (78 files)  → CLI command integration tests
│   ├── binary/                 (3 files)  → Distribution integration tests
│   └── api/                    (2 files)  → API integration tests
├── test/helpers/                          → Test utilities
├── test/fixtures/                         → Test data
├── test/utils/                            → Test helpers
├── test/docs/                             → Test documentation
└── test/e2e/                              → E2E workflow tests (future)
```

## Test Type Definitions

### Unit Tests (test/unit/**/*.test.mts)

**What they test**: Individual functions, modules, utilities

```typescript
// Example: test/unit/commands/scan/handle-scan.test.mts
describe('handleScan', () => {
  it('should process scan results', () => {
    const result = handleScan(mockData)
    expect(result.issues).toHaveLength(3)
  })
})
```

**Characteristics**:
- ✓ Fast (<10ms per test)
- ✓ Isolated (no external dependencies)
- ✓ Mocked I/O and network
- ✓ Tests pure functions
- → Tests implementation details

**Examples**: `handle-*.test.mts`, `fetch-*.test.mts`, `output-*.test.mts`

### CLI Command Integration Tests (test/integration/cli/)

**What they test**: CLI commands by spawning the actual binary

```typescript
// Example: test/integration/cli/cmd-scan.test.mts
describe('socket scan', () => {
  cmdit(['scan', '--help'], 'should display help', async (cmd) => {
    const { code, stdout } = await spawnSocketCli(binCliPath, cmd)

    expect(code).toBe(0)
    expect(stdout).toContain('Manage Socket scans')
  })
})
```

**Characteristics**:
- ✓ Tests CLI command interface
- ✓ Real process spawning
- ✓ Tests command parsing and flags
- ✓ Validates help text and errors
- → Tests command-line integration

**Examples**: `cmd-*.test.mts` (78 files)

### Distribution Integration Tests (test/integration/binary/)

**What they test**: Different distribution formats (npm, smol, SEA)

```
┌──────────────────────────────────────────┐
│ Test Process                              │
│ ┌──────────────────────────────────────┐ │
│ │ spawn()                               │ │
│ │   ↓                                   │ │
│ │ bin/cli.js --help                     │ │
│ │   ↓                                   │ │
│ │ dist/socket-smol-linux-x64 scan .     │ │
│ │   ↓                                   │ │
│ │ dist/socket-sea-darwin-arm64 --version│ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**Test files**:
- `binary-test-suite.test.mts` - Tests JS/smol/SEA binaries
- `critical-commands.test.mts` - Tests core commands
- `dlx-spawn.test.mts` - Tests dlx functionality

**Characteristics**:
- ✓ Tests public CLI interface
- ✓ Real process spawning
- ✓ Tests compiled artifacts (not source)
- ✓ Platform-specific (tests actual binaries)
- → Tests binary compatibility

### API Integration Tests (test/integration/api/)

**What they test**: Integration with Socket API (local depscan server)

```
┌────────────────────────────────────────────┐
│ Test → Socket SDK → Local API Server      │
│                     (localhost:8866)       │
└────────────────────────────────────────────┘
```

**Test files**:
- `patches-api.test.mts` - Tests patch API endpoints
- `bundle-validation.test.mts` - Tests bundle validation

**Characteristics**:
- ✓ Requires local depscan server
- ✓ Tests external service integration
- ✓ Auto-skips if server unavailable
- → Tests API contracts

### True E2E Tests (missing)

**What they would test**: Complete user workflows from start to finish

```
User Action
  ↓
socket npm install express
  ↓
Scan packages via API
  ↓
Apply Socket registry overrides
  ↓
Verify package.json modified
  ↓
npm install executes
  ↓
Final state validation
```

**Would include**:
- Full `socket optimize` workflow
- Full `socket patch` apply/revert cycle
- Full `socket fix` workflow with git integration
- Real API calls to production/staging
- Real file system modifications
- Real package manager operations

**Characteristics**:
- ✗ Slow (minutes per test)
- ✗ Requires auth/network
- ✗ Complex setup/teardown
- → Tests user stories

## Final Structure ✓

```
packages/cli/
├── test/unit/                     → Unit tests (266 files)
│   ├── commands/
│   ├── utils/
│   └── ...
├── test/integration/              → Integration tests
│   ├── binary/                    → CLI binary tests (3 files)
│   │   ├── binary-test-suite.test.mts
│   │   ├── critical-commands.test.mts
│   │   └── dlx-spawn.test.mts
│   └── api/                       → API integration tests (2 files)
│       ├── patches-api.test.mts
│       ├── bundle-validation.test.mts
│       └── README.md
├── test/helpers/                  → Test utilities
├── test/fixtures/                 → Test data
├── test/utils/                    → Test helpers
└── test/e2e/ (reserved)           → True E2E workflows (future)
```

**Benefits**:
- ✓ Clear separation of test types
- ✓ Industry-standard structure
- ✓ Unit tests no longer mixed with source
- ✓ Integration tests properly categorized
- ✓ Reserves e2e for true workflows

## Test Execution Matrix

| Test Type | Location | Speed | Requires | npm script |
|-----------|----------|-------|----------|------------|
| **Unit** | `test/unit/**/*.test.mts` | Fast (~48s) | Nothing | `pnpm test:unit test/unit` |
| **CLI Commands** | `test/integration/cli/` | Medium (~2min) | Built CLI | `pnpm test:unit test/integration/cli` |
| **Distributions** | `test/integration/binary/` | Medium (~2min) | Built distributions | `pnpm test:dist` or `pnpm test:dist:{js,smol,sea}` |
| **API Integration** | `test/integration/api/` | Medium (~30s) | Local depscan | `pnpm test:unit test/integration/api` |
| **E2E Workflows** | `test/e2e/` | Slow (~5min) | Auth + network | (future) |

## Binary Test Requirements

### Critical Requirement

**All three binary types MUST pass the same CLI integration test suite**:

```
✓ JS Binary (bin/cli.js)
  → Tests: dist/cli.js compiled with esbuild
  → Purpose: Development, npm package

✓ Smol Binary (socket-smol-{platform}-{arch})
  → Tests: Compressed Node.js + CLI bundle
  → Purpose: Fast download, embedded use
  → Size: ~18 MB

✓ SEA Binary (socket-sea-{platform}-{arch})
  → Tests: Single Executable Application
  → Purpose: Standalone distribution
  → Size: ~70 MB
```

### Binary Test Suite (`test/integration/binary/binary-test-suite.test.mts`)

**Tests all three binary types**:
- Environment variable support
- Configuration loading
- Command parsing
- Exit codes
- Output formatting
- Help/version display
- Error handling

**Execution**:
```bash
# Test JS distribution (always enabled, builds if needed)
pnpm test:dist:js

# Test smol binary (prompts to build if missing)
pnpm test:dist:smol

# Test SEA binary (prompts to build if missing)
pnpm test:dist:sea

# Test all distributions (prompts for missing ones)
pnpm test:dist
```

**How it works**:
1. **JS distribution** - Always runs, automatically builds dist if needed
2. **smol/SEA binaries** - Checks if distribution exists:
   - If exists: Runs tests
   - If missing (local): Prompts to build
   - If missing (CI): Skips (relies on cache)

**Build times**:
- JS: ~30s (esbuild)
- SEA: ~5min (Node.js SEA)
- smol: ~30-60min first time, ~5min cached (compressed Node.js)

## Migration Status

✓ **Completed** - Test reorganization finished!

### Changes Made

1. **Moved unit tests**: `src/**/*.test.mts` → `test/unit/**/*.test.mts`
2. **Moved CLI binary tests**: `test/e2e/*.e2e.test.mts` → `test/integration/binary/*.test.mts`
3. **Moved API tests**: `test/integration/*.test.mts` → `test/integration/api/*.test.mts`
4. **Updated imports**: Adjusted relative imports for new locations
5. **Removed .e2e suffix**: Simplified binary test filenames

### Next Steps

1. Update vitest configuration if needed
2. Update npm scripts to reflect new structure
3. Update CLAUDE.md test section
4. Fix any remaining import issues (unit tests may need manual fixes)
5. Create `test/e2e/` when true E2E workflow tests are needed

## Current Scripts Analysis

```json
{
  "e2e:js": "node scripts/e2e.mjs --js",      → Should be test:cli:js
  "e2e:smol": "node scripts/e2e.mjs --smol",  → Should be test:cli:smol
  "e2e:sea": "node scripts/e2e.mjs --sea",    → Should be test:cli:sea
  "e2e:all": "node scripts/e2e.mjs --all",    → Should be test:cli:all
  "test:unit": "vitest run"                   → Correct
}
```

## Best Practices

### Writing CLI Integration Tests

```typescript
import { executeCliCommand } from '../helpers/cli-execution.mts'

describe('CLI Binary Tests', () => {
  it('should display help', async () => {
    const result = await executeCliCommand(['--help'], {
      binPath: CLI_BIN_PATH,
      isolateConfig: true  // Use --config {} for isolation
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('socket')
  })
})
```

### Writing API Integration Tests

```typescript
import { setupLocalServer, cleanupLocalServer } from '../helpers/local-server.mts'

describe('API Integration Tests', () => {
  beforeEach(async () => {
    await setupLocalServer()
  })

  it('should fetch patches', async () => {
    // Test will auto-skip if server not running
    const sdk = await setupSdk({ apiToken: 'test' })
    const patches = await sdk.getPatches()
    expect(patches).toBeDefined()
  })
})
```

### Writing Unit Tests

```typescript
describe('formatPackageName', () => {
  it('should handle scoped packages', () => {
    expect(formatPackageName('@scope/pkg')).toBe('@scope/pkg')
  })
})
```

## Summary

### Current State
- ✓ 266 unit tests (well-organized)
- ✓ 3 CLI binary tests (misnamed as "e2e")
- ✓ 2 API integration tests (correctly named)
- ✗ No true E2E workflow tests

### Recommended Action
1. **Rename** `test/e2e/` → `test/cli/` (or `test/binary/`)
2. **Update** npm scripts to use `test:cli:*` instead of `e2e:*`
3. **Document** the distinction clearly
4. **Reserve** `test/e2e/` for true workflow tests (future)

### Key Insight
**CLI binary tests are integration tests**, not E2E tests. They test the compiled binary's public interface, which is the integration point between the build system and users.

```
Unit Test       → Test implementation (src/*.test.mts)
CLI Test        → Test interface (test/cli/*.test.mts) ⚡ YOU NEED THIS
API Test        → Test service (test/integration/*.test.mts)
E2E Test        → Test workflow (test/e2e/*.test.mts) (future)
```
