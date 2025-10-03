# CI Testing Guide

## Overview

This project uses socket-registry's centralized CI testing infrastructure. The solution provides:

- **🚨 MANDATORY**: Use `SocketDev/socket-registry/.github/workflows/ci.yml@main` for consistent CI
- **Multi-platform testing**: Linux, Windows, and macOS support
- **Multi-version Node.js matrix**: Test across Node.js 20, 22, and 24
- **Flexible configuration**: Customizable test scripts, timeouts, and artifact uploads
- **Memory optimization**: Configured heap sizes for CI and local environments
- **Cross-platform compatibility**: Handles Windows and POSIX path differences

**For socket-registry-specific package testing tools**, see `socket-registry/docs/CI_TESTING_TOOLS.md` and `socket-registry/docs/PACKAGE_TESTING_GUIDE.md`. These tools (`validate:packages`, `validate:ci`) are specific to socket-registry's package override structure.

## Workflow Structure

### Centralized CI Workflow

**🚨 MANDATORY**: Use `SocketDev/socket-registry/.github/workflows/ci.yml@main` for consistent CI across all Socket projects.

**Key Features:**
- Matrix testing across Node.js versions and operating systems
- Parallel execution of lint, type-check, test, and coverage
- Configurable scripts for project-specific requirements
- Artifact upload support for coverage reports
- Debug mode for verbose logging
- Timeout protection for long-running tests

### Main Test Workflow

Located at `.github/workflows/test.yml`, this workflow calls socket-registry's reusable CI workflow:

```yaml
jobs:
  test:
    uses: SocketDev/socket-registry/.github/workflows/ci.yml@main
    with:
      setup-script: 'pnpm run build:dist:src'
      node-versions: '[20, 22, 24]'
      os-versions: '["ubuntu-latest", "windows-latest", "macos-latest"]'
      test-script: 'pnpm run test:unit'
      lint-script: 'pnpm run check:lint'
      type-check-script: 'pnpm run check:tsc'
      timeout-minutes: 15
```

**Note**: For projects still using local reusable workflows (`.github/workflows/_reusable-test.yml`), migrate to socket-registry's centralized workflow.

## Configuration Options

### Input Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `node-versions` | Array of Node.js versions to test | `[20, 22, 24]` |
| `os-versions` | Array of operating systems | `["ubuntu-latest", "windows-latest"]` |
| `test-script` | Test command to execute | `pnpm run test:unit` |
| `setup-script` | Pre-test setup command | `pnpm run build:dist:src` |
| `lint-script` | Lint command to execute | `pnpm run check:lint` |
| `type-check-script` | Type check command to execute | `pnpm run check:tsc` |
| `timeout-minutes` | Job timeout in minutes | `15` |
| `upload-artifacts` | Upload test artifacts | `false` |
| `fail-fast` | Cancel all jobs if one fails | `true` |
| `max-parallel` | Maximum parallel jobs | `4` |
| `continue-on-error` | Continue on job failure | `false` |

## CLI-Specific Testing Requirements

### Build Before Tests

**🚨 CRITICAL**: Always build before running tests:
```bash
pnpm run build:dist:src
```

The CLI relies on compiled TypeScript outputs in `dist/` directory. Tests will fail if build artifacts are missing or stale.

### Test File Patterns

- **Source tests**: `src/**/*.test.mts`
- **Test naming**: Match source file (e.g., `cmd-scan.test.mts` for `cmd-scan.mts`)
- **Update snapshots**: Use `pnpm run testu` (not `pnpm test -u`)

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CI` | Detect CI environment |
| `NODE_OPTIONS` | Node.js runtime options |
| `DEBUG` | Enable debug logging |

## Best Practices

### 1. Use Centralized Workflow

Always use socket-registry's centralized CI workflow for consistency:
```yaml
uses: SocketDev/socket-registry/.github/workflows/ci.yml@main
```

### 2. Configure Timeouts

Set appropriate timeouts for your test suite:
```yaml
timeout-minutes: 15  # CLI tests may take longer
```

### 3. Platform-Specific Tests

CLI tools need thorough cross-platform testing:
- Linux: Primary development platform
- Windows: Different path handling, shell behavior
- macOS: Apple Silicon and Intel compatibility

### 4. Build Artifacts

Include `setup-script` to ensure fresh builds:
```yaml
setup-script: 'pnpm run build:dist:src'
```

### 5. Debug Mode

Enable debug mode for troubleshooting:
```yaml
debug: '1'
```

## Local Testing

### Full Test Flow
```bash
# Build source files
pnpm run build:dist:src

# Run all tests
pnpm run test:unit

# Run with coverage
pnpm run coverage
```

### Run Specific Tests
```bash
# Test single file (after build)
pnpm run test:unit src/commands/scan/cmd-scan.test.mts
```

### Update Snapshots
```bash
# Update all snapshots
pnpm run testu

# Update specific file
pnpm run testu src/commands/scan/cmd-scan.test.mts
```

### Run Linting and Type Checking
```bash
# Lint
pnpm run check:lint

# Type check (uses tsgo)
pnpm run check:tsc

# Run all checks
pnpm run check
```

### Run CLI Locally
```bash
# Build and run
pnpm run build && pnpm exec socket

# Quick build (source only) and run
pnpm run bs

# Run without rebuild
pnpm run s
```

## Troubleshooting

### Build Artifacts Missing

**Problem**: Tests fail with module resolution errors

**Solution**: Run `pnpm run build:dist:src` before testing

---

### Test Timeouts

**Problem**: Tests timeout in CI

**Solution**:
1. Increase `timeout-minutes` in workflow
2. Check for slow operations or hanging promises
3. Review snapshot update times

---

### Windows Path Issues

**Problem**: Tests fail on Windows only

**Solution**:
1. Use `path.join()` instead of string concatenation
2. Use `path.sep` instead of hard-coded `/` or `\`
3. Check for POSIX-specific assumptions

---

### Coverage Gaps

**Problem**: Coverage reports show gaps

**Solution**:
1. Run `pnpm coverage` locally
2. Review untested code paths
3. Add tests for edge cases

## Integration with socket-registry

This project uses socket-registry's centralized CI infrastructure:
- **CI Workflow**: `SocketDev/socket-registry/.github/workflows/ci.yml@main`
- **Cross-platform compatibility**: Follows socket-registry guidelines
- **Memory optimization**: Aligned with socket-registry patterns
- **Build requirements**: Pre-test builds are CLI-specific

**Socket-registry-specific tools**: The `validate:packages` and `validate:ci` scripts in socket-registry are specific to its package override structure and not applicable to CLI projects. See `socket-registry/docs/CI_TESTING_TOOLS.md` and `socket-registry/docs/PACKAGE_TESTING_GUIDE.md` for details.

For consistency across Socket projects, follow the patterns established in socket-registry/CLAUDE.md and documented here.

## CLI-Specific Notes

### Shadow Binaries

The `shadow-bin/` directory contains npm/npx wrapper scripts. These are not TypeScript files and don't require compilation.

### TypeScript Native Support

The `./sd` script uses Node.js 22+ native TypeScript support for faster local development iterations.

### Build Output

- **Source**: `dist/esm/` - Compiled TypeScript
- **Types**: `dist/types/` - Type definitions
- Both directories are required for tests to pass
