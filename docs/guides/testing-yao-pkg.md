# Testing yao-pkg Binary Against Unit Tests

This guide explains how to build and test the yao-pkg binary locally.

## Prerequisites

- macOS (for building Mac binaries)
- Xcode Command Line Tools: `xcode-select --install`
- Build tools: gcc, g++, make, python3
- ~20GB free disk space for Node.js build
- 30-60 minutes for initial Node.js build

## Quick Start (If Node Binary Already Built)

If you already have `.custom-node-build/node-yao-pkg/out/Release/node`:

```bash
# 1. Install dependencies
pnpm install

# 2. Build CLI distribution
pnpm run build

# 3. Build yao-pkg binary
pnpm exec pkg .

# 4. Enable binary testing in .env.test
# Uncomment this line:
SOCKET_CLI_BIN_PATH="./pkg-binaries/socket-macos-arm64"

# 5. Run tests
pnpm test
```

## Full Build From Scratch

### Step 1: Install Dependencies

```bash
pnpm install
```

This installs `@yao-pkg/pkg@6.8.0` and all other dependencies.

### Step 2: Build CLI Distribution

```bash
pnpm run build
```

This creates `dist/cli.js` which yao-pkg will bundle.

**Output:**
- `dist/cli.js` - Main CLI entry (bundled, ~10-15MB)

### Step 3: Build Custom Node Binary (One-Time, ~30-60 min)

```bash
node scripts/build-yao-pkg-node.mjs
```

This downloads Node.js v24.9.0 source, applies yao-pkg patches, and builds the custom Node binary.

**Output:**
- `.custom-node-build/node-yao-pkg/out/Release/node` (~83MB)
- Total build artifacts: ~19-20GB

**Note:** This is a one-time build. Once built, you can reuse it for all future yao-pkg builds.

### Step 4: Build yao-pkg Binary

```bash
pnpm exec pkg .
```

This uses `pkg.json` configuration to:
1. Read `dist/cli.js` entry point
2. Use custom Node from `.custom-node-build/node-yao-pkg/out/Release/node`
3. Bundle as V8 bytecode
4. Embed assets in virtual filesystem
5. Create standalone executable

**Output:**
- `pkg-binaries/socket-macos-arm64` (~90-110MB)

**Time:** ~30 seconds

### Step 5: Configure Tests to Use Binary

Edit `.env.test` and uncomment the `SOCKET_CLI_BIN_PATH` line:

```bash
# Before:
# SOCKET_CLI_BIN_PATH="./pkg-binaries/socket-macos-arm64"

# After:
SOCKET_CLI_BIN_PATH="./pkg-binaries/socket-macos-arm64"
```

**What this does:**
- Tests will use `constants.binCliPath` which reads from `SOCKET_CLI_BIN_PATH`
- Instead of running `bin/cli.js`, tests run the yao-pkg binary
- The binary uses `SOCKET_CLI_JS_PATH="./dist/cli.js"` for local code (not downloading from npm)

### Step 6: Run Tests

```bash
pnpm test
```

Tests will now run against the yao-pkg binary instead of the Node.js script.

## Testing Workflow Summary

```bash
# One-time setup (if Node binary doesn't exist)
node scripts/build-yao-pkg-node.mjs  # 30-60 min

# Regular workflow
pnpm run build                        # Build dist/cli.js
pnpm exec pkg .                       # Build yao-pkg binary
# Uncomment SOCKET_CLI_BIN_PATH in .env.test
pnpm test                        # Run tests
```

## Environment Variables

### SOCKET_CLI_JS_PATH

**Purpose:** Points to local @socketsecurity/cli JS dist
**Default:** `./dist/cli.js`
**Used by:** Stub binaries (SEA, yao-pkg) to load local code instead of downloading from npm
**Location:** `.env.test` (always enabled)

### SOCKET_CLI_BIN_PATH

**Purpose:** Points to built binary to test
**Default:** Commented out (tests use `bin/cli.js`)
**Options:**
- `./pkg-binaries/socket-macos-arm64` - yao-pkg binary
- `./dist/sea/socket-macos-arm64` - SEA binary

**Used by:** `constants.binCliPath` getter, which is passed to `spawnSocketCli()` in tests
**Location:** `.env.test` (commented out by default)

**How it works:**
1. Tests call `spawnSocketCli(constants.binCliPath, args)`
2. `constants.binCliPath` reads from `SOCKET_CLI_BIN_PATH` env var (if set)
3. `spawnSocketCli()` detects if path is a JS file or binary:
   - **JS files** (`.js`, `.mjs`, `.cjs`): Runs `node <file> <args>`
   - **Binaries** (no extension): Executes `<binary> <args>` directly

## File Locations

```
socket-cli/
├── bin/cli.js                                    # Thin wrapper (development)
├── dist/cli.js                                   # Bundled CLI code (rollup output)
├── pkg-binaries/socket-macos-arm64               # yao-pkg binary (testing target)
├── .custom-node-build/
│   └── node-yao-pkg/out/Release/node            # Custom Node binary
├── .env.test                                     # Test configuration
│   ├── SOCKET_CLI_JS_PATH="./dist/cli.js"       # Always enabled
│   └── SOCKET_CLI_BIN_PATH=...                  # Commented out by default
└── test/**/*.test.mts                            # Unit tests
```

## Switching Between Test Modes

### Test Against Development CLI (Default)

```bash
# In .env.test, comment out SOCKET_CLI_BIN_PATH:
# SOCKET_CLI_BIN_PATH="./pkg-binaries/socket-macos-arm64"

pnpm test
```

Tests use `bin/cli.js` → `dist/cli.js`

### Test Against yao-pkg Binary

```bash
# In .env.test, uncomment SOCKET_CLI_BIN_PATH:
SOCKET_CLI_BIN_PATH="./pkg-binaries/socket-macos-arm64"

pnpm test
```

Tests use `pkg-binaries/socket-macos-arm64` directly

### Test Against SEA Binary

```bash
# In .env.test, use SEA path:
SOCKET_CLI_BIN_PATH="./dist/sea/socket-macos-arm64"

pnpm test
```

Tests use `dist/sea/socket-macos-arm64` directly

## Troubleshooting

### "Cannot find module 'dist/cli.js'"

**Solution:** Build the CLI first:
```bash
pnpm run build
```

### "Custom Node binary not found"

**Error:** `pkg.json` references `.custom-node-build/node-yao-pkg/out/Release/node` but it doesn't exist.

**Solution:** Build the custom Node binary:
```bash
node scripts/build-yao-pkg-node.mjs
```

### "pkg-binaries/socket-macos-arm64: No such file"

**Solution:** Build the yao-pkg binary:
```bash
pnpm exec pkg .
```

### Tests fail with yao-pkg binary

**Debug:**
```bash
# Test the binary directly
./pkg-binaries/socket-macos-arm64 --version

# Check if it's loading local dist
# Should NOT download from npm
./pkg-binaries/socket-macos-arm64 --help
```

### Binary is too large (>200MB)

**Expected size:** 90-110MB

**Possible cause:** Debug symbols included

**Solution:** Ensure custom Node was built with optimizations (build-yao-pkg-node.mjs handles this automatically)

## CI/CD Integration

For GitHub Actions, cache the custom Node binary to avoid rebuilding:

```yaml
- name: Cache custom Node binary
  uses: actions/cache@v4
  with:
    path: .custom-node-build/node-yao-pkg
    key: node-yao-pkg-v24.9.0-${{ runner.os }}-${{ runner.arch }}

- name: Build custom Node if not cached
  if: steps.cache-node.outputs.cache-hit != 'true'
  run: node scripts/build-yao-pkg-node.mjs

- name: Build yao-pkg binary
  run: |
    pnpm run build
    pnpm exec pkg .

- name: Test yao-pkg binary
  env:
    SOCKET_CLI_BIN_PATH: ./pkg-binaries/socket-macos-arm64
  run: pnpm test
```

## See Also

- [YAO_PKG_BUILD.md](./YAO_PKG_BUILD.md) - Complete yao-pkg build documentation
- [REPOSITORY_STRUCTURE.md](./REPOSITORY_STRUCTURE.md) - Directory structure and build artifacts
- [PKG_PLATFORM_SUPPORT.md](./PKG_PLATFORM_SUPPORT.md) - Platform-specific considerations
