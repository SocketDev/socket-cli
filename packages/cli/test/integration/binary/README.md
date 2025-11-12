# CLI Distribution Integration Tests

Tests all Socket CLI distribution formats (JS distribution, smol binary, SEA binary) to ensure they work correctly.

## Quick Start

```bash
# Test JS distribution (fast, always runs)
pnpm test:dist:js

# Test smol binary (prompts to build if needed)
pnpm test:dist:smol

# Test SEA binary (prompts to build if missing)
pnpm test:dist:sea

# Test all three distributions
pnpm test:dist
```

## Distribution Types

| Distribution | Path | Size | Build Time | Purpose |
|--------------|------|------|------------|---------|
| **js** | `dist/index.js` | ~5 MB | 30s | JS distribution, development |
| **smol** | `packages/node-smol-builder/dist/socket-smol-{platform}-{arch}` | ~18 MB | 30-60min (first), 5min (cached) | Fast download, embedded use |
| **SEA** | `packages/node-sea-builder/dist/socket-sea-{platform}-{arch}` | ~70 MB | 5min | Standalone distribution |

## How Tests Work

### Distribution Detection

1. **Check if distribution exists** at expected path
2. **Local environment**:
   - If missing: Prompt user to build
   - If declined: Skip tests
3. **CI environment**:
   - If missing: Skip (relies on GitHub Actions cache)
   - No build prompts in CI

### Test Execution

Each distribution runs the same test suite:
- ✓ Basic commands (help, version)
- ✓ Command parsing
- ✓ Configuration loading
- ✓ Environment variables
- ✓ Exit codes
- ✓ Output formatting
- ✓ Auth-required commands (with credentials)
- ✓ Performance validation

### Environment Variables

```bash
# Enable specific distribution tests
TEST_SMOL_BINARY=1            # Enable smol binary tests
TEST_SEA_BINARY=1             # Enable SEA binary tests

# Enable integration tests (requires Socket API token)
RUN_INTEGRATION_TESTS=1       # Enable auth-required tests
```

## Building Distributions

### npm Package (Always Available)

```bash
pnpm --filter @socketsecurity/cli run build
```

### smol Binary

```bash
# First time (30-60 minutes)
pnpm --filter @socketbin/node-smol-builder run build

# Subsequent builds (5 minutes with cache)
pnpm --filter @socketbin/node-smol-builder run build
```

### SEA Binary

```bash
# ~5 minutes
pnpm --filter @socketbin/node-sea-builder run build
```

## Test Files

- `js.test.mts` - JS distribution tests (144 tests)
- `sea.test.mts` - SEA binary tests (144 tests)
- `smol.test.mts` - Smol binary tests (144 tests)
- `helpers.mts` - Shared test utilities
- `critical-commands.test.mts` - Core CLI commands
- `dlx-spawn.test.mts` - DLX functionality

## CI/CD Integration

GitHub Actions workflow (`.github/workflows/build-smol.yml`, `build-sea.yml`):
1. Builds distributions with aggressive caching
2. Caches built distributions by content hash
3. Tests restore from cache
4. Skip if cache miss (avoid 30-60min smol builds on every PR)

## Common Issues

### "Binary not found"

**Solution**: Build the distribution first

```bash
# For npm
pnpm build

# For smol
pnpm --filter @socketbin/node-smol-builder run build

# For SEA
pnpm --filter @socketbin/node-sea-builder run build
```

### "Tests skipped"

This is normal if:
- Distribution doesn't exist locally (and you declined to build)
- Running in CI without cached distribution
- Auth token missing (for auth-required tests)

### Slow First Build (smol)

The smol binary compiles Node.js from source, which takes 30-60 minutes on first build. Subsequent builds use ccache and complete in ~5 minutes.

**Tip**: Run `pnpm test:dist:smol` once to build and cache, then subsequent test runs are fast.

## Integration with Main Test Suite

Distribution tests are **integration tests** - they verify the compiled output works correctly.

```
pnpm test              → Runs all tests (unit + integration)
pnpm test:unit         → Unit tests only (test/unit)
pnpm test:dist         → Distribution integration tests (all distributions)
pnpm test:dist:js     → JS distribution only
```

## Authentication

Some tests require Socket API authentication:

```bash
# Option 1: Login
socket login

# Option 2: API key
export SOCKET_SECURITY_API_KEY=your_token_here

# Tests without auth will be skipped (expected)
```

## Platform Support

Tests automatically detect platform and architecture:
- Linux (x64, arm64, alpine-x64, alpine-arm64)
- macOS (x64, arm64)
- Windows (x64, arm64)

Distribution paths adjust automatically based on platform.
