# CI Testing

This project uses socket-registry's centralized CI testing infrastructure.

## Critical Requirements

**🚨 MANDATORY:** Use full commit SHA, NOT `@main`

```yaml
uses: SocketDev/socket-registry/.github/workflows/ci.yml@662bbcab1b7533e24ba8e3446cffd8a7e5f7617e # main
```

Get SHA: `cd /path/to/socket-registry && git rev-parse main`

## Workflow Configuration

Located at `.github/workflows/test.yml`:

```yaml
jobs:
  test:
    uses: SocketDev/socket-registry/.github/workflows/ci.yml@<FULL-SHA> # main
    with:
      setup-script: 'pnpm run build'
      node-versions: '[20, 22, 24]'
      os-versions: '["ubuntu-latest", "windows-latest"]'
      test-script: 'pnpm run test-ci'
      lint-script: 'pnpm run check:lint'
      type-check-script: 'pnpm run check:tsc'
      timeout-minutes: 10
```

## Key Features

- Matrix testing across Node.js versions and OSes
- Parallel execution (lint, type-check, test, coverage)
- Configurable scripts, timeouts, and artifacts
- Memory optimization (8GB CI, 4GB local)
- Cross-platform compatibility

## Configuration Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| `node-versions` | Node.js versions array | `[20, 22, 24]` |
| `os-versions` | Operating systems | `["ubuntu-latest", "windows-latest"]` |
| `test-script` | Test command | `pnpm run test-ci` |
| `setup-script` | Pre-test setup | `''` |
| `timeout-minutes` | Job timeout | `10` |
| `upload-artifacts` | Upload test artifacts | `false` |
| `fail-fast` | Cancel on failure | `true` |

## Test Scripts

**Custom test runner** (`scripts/test.mjs`):
- Glob pattern expansion
- Force flag support
- Memory optimization (auto heap size)
- Cross-platform support (Windows `.cmd` handling)

**Usage:**
```bash
# Run all tests
pnpm run test:run

# Run with force flag
node scripts/test.mjs --force

# Run specific pattern
node scripts/test.mjs test/unit/*.test.mts
```

## Memory Configuration

Auto-configured by test runner:
- CI: 8GB heap (`--max-old-space-size=8192`)
- Local: 4GB heap (`--max-old-space-size=4096`)
- Semi-space: 512MB for GC

Defined in:
1. `scripts/test.mjs` (custom runner)
2. `.env.test` (vitest direct)
3. `vitest.config.mts` (pool config)

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CI` | Detect CI environment |
| `FORCE_TEST` | Force all tests |
| `PRE_COMMIT` | Detect pre-commit hook |
| `NODE_OPTIONS` | Node.js runtime options |

## Local Testing

```bash
# Full suite
pnpm test

# With coverage
pnpm run test:unit:coverage

# Coverage percentage
pnpm run coverage:percent

# Custom runner
pnpm run test:run
```

## Troubleshooting

**Out of memory:**
1. Check `NODE_OPTIONS` in `.env.test`
2. Verify vitest pool configuration
3. Reduce `max-parallel` in workflow

**Windows issues:**
1. Ensure paths use `path.join()`
2. Check `.cmd` file handling
3. Verify `shell: true` for Windows spawns

**Timeouts:**
1. Increase `timeout-minutes`
2. Check `testTimeout` in `vitest.config.mts`
3. Review individual test timeouts

## Best Practices

1. **Use centralized CI workflow** with full SHA
2. **Set appropriate timeouts** for test suite size
3. **Optimize memory** for large suites (sequential execution, single fork)
4. **Enable debug mode** for troubleshooting: `debug: '1'`

## See Also

- [Testing Utilities](./testing.md) - Test helpers documentation
- socket-registry CI workflow: `SocketDev/socket-registry/.github/workflows/ci.yml`
