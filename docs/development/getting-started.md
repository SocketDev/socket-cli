# Getting Started with Socket CLI Development

Complete end-to-end guide for new contributors to Socket CLI.

## Prerequisites

Before starting, ensure you have:

| Requirement | Minimum Version | Check Command |
|-------------|----------------|---------------|
| Node.js | 18.0.0+ | `node --version` |
| pnpm | 10.16.0+ | `pnpm --version` |
| Git | 2.0+ | `git --version` |
| Disk Space | ~5 GB | `df -h .` |

### Installing Prerequisites

**Node.js 18+:**
```bash
# macOS (using Homebrew)
brew install node@20

# Linux (using nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20

# Windows (using Chocolatey)
choco install nodejs-lts
```

**pnpm 10.16+:**
```bash
# Using npm (comes with Node.js)
npm install -g pnpm

# Or using Homebrew (macOS)
brew install pnpm

# Or use corepack (built into Node.js 16+)
corepack enable
corepack prepare pnpm@latest --activate

# Verify installation
pnpm --version  # Should be 10.16.0 or higher
```

## Quick Start (5 Minutes)

Get Socket CLI running locally in 5 steps:

```bash
# 1. Clone the repository
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli

# 2. Install dependencies
pnpm install

# 3. Build the CLI
pnpm run build

# 4. Test the CLI
pnpm exec socket --version

# 5. Run tests
pnpm run test:unit
```

**Expected output:**
```
$ pnpm exec socket --version
CLI: v1.2.0
```

If you see the version number, congratulations! Your setup is working.

## Detailed Setup

### Step 1: Clone the Repository

```bash
# Clone from GitHub
git clone https://github.com/SocketDev/socket-cli.git
cd socket-cli

# Or if you have SSH keys configured
git clone git@github.com:SocketDev/socket-cli.git
cd socket-cli
```

**Verification:**
```bash
ls -la
# Should see: package.json, packages/, docs/, etc.
```

### Step 2: Install Dependencies

```bash
pnpm install
```

**What this does:**
- Installs all npm dependencies
- Sets up pnpm workspace for the monorepo
- Links internal packages together
- Downloads Socket registry overrides

**Expected output:**
```
Packages: +500
++++++++++++++++++++++++++++++++
Progress: resolved 500, reused 500, downloaded 0, added 500, done
```

**Verification:**
```bash
ls -la node_modules
# Should see many packages installed
```

### Step 3: Build the CLI

```bash
pnpm run build
```

**What this does:**
- Compiles TypeScript source files to JavaScript
- Generates type definitions
- Creates the `dist/` directory with built files
- Takes ~30 seconds

**Expected output:**
```
> socket-cli@1.0.80 build
> pnpm run build:dist

✓ TypeScript compilation complete
✓ Type definitions generated
✓ Build artifacts created in dist/
```

**Verification:**
```bash
ls -la packages/cli/dist
# Should see: cli.js and other compiled files
```

### Step 4: Run the CLI Locally

```bash
# Run using pnpm exec
pnpm exec socket --version

# Or run directly
./bin/cli.js --version

# Or use the convenience script
pnpm run s -- --version
```

**Try some commands:**
```bash
# Show help
pnpm exec socket --help

# Test package analysis (requires API token)
pnpm exec socket package lodash --view

# Or configure without token for basic commands
pnpm exec socket --version
```

### Step 5: Run Tests

```bash
# Run all tests (lint, type-check, unit tests)
pnpm run test

# Or run just unit tests
pnpm run test:unit

# Or run specific test file
pnpm run test:unit packages/cli/src/commands/scan/cmd-scan.test.mts
```

**Expected output:**
```
✓ packages/cli/src/commands/scan/cmd-scan.test.mts (10 tests) 234ms
✓ packages/cli/src/utils/config.test.mts (15 tests) 156ms

Test Files  2 passed (2)
Tests  25 passed (25)
```

**Verification:**
```bash
echo $?
# Should output: 0 (success)
```

## Development Workflow

### Making Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/my-awesome-feature
   ```

2. **Make your changes:**
   - Edit files in `packages/cli/src/`
   - Follow the code style in `CLAUDE.md`
   - Use `.mts` extension for TypeScript files

3. **Build and test:**
   ```bash
   pnpm run build
   pnpm run test:unit
   ```

4. **Test your changes:**
   ```bash
   # Run the CLI with your changes
   pnpm exec socket <your-command>

   # Or use the quick build + run script
   pnpm run bs <your-command>
   ```

### Common Development Tasks

**Run CLI after building:**
```bash
# Build first
pnpm run build

# Then run the CLI
pnpm exec socket <command>
pnpm exec socket --help
```

**Native TypeScript (Node 22+):**
```bash
# Runs TypeScript directly without building
./sd <command>
./sd --help
```

**Fix linting issues:**
```bash
pnpm run fix
```

**Type checking:**
```bash
pnpm run type
```

**Quick scripts (packages/cli only):**
```bash
cd packages/cli

# Build + run (requires .env.local)
pnpm run bs scan --help

# Run without build (requires .env.local)
pnpm run s --version
```

**Update test snapshots:**
```bash
# Update all snapshots
pnpm run testu

# Update specific test file
pnpm run testu packages/cli/src/commands/scan/cmd-scan.test.mts
```

### Testing Strategies

**Test a single file (fast):**
```bash
pnpm test:unit packages/cli/src/utils/config.test.mts
```

**Test with pattern matching:**
```bash
pnpm test:unit packages/cli/src/commands/scan/cmd-scan.test.mts -t "should handle errors"
```

**Test with coverage:**
```bash
pnpm run test:unit:coverage
pnpm run coverage:percent
```

**Watch mode (auto-rerun on changes):**
```bash
pnpm test:unit --watch
```

## Project Structure

Understanding the codebase organization:

```
socket-cli/
├── packages/cli/                 # Main CLI package
│   ├── src/
│   │   ├── cli.mts              # Entry point
│   │   ├── commands/            # Command implementations
│   │   │   ├── scan/            # Scan command
│   │   │   │   ├── cmd-scan.mts      # Command definition
│   │   │   │   ├── handle-scan.mts   # Business logic
│   │   │   │   └── output-scan.mts   # Output formatting
│   │   │   ├── optimize/        # Optimize command
│   │   │   └── ...              # Other commands
│   │   ├── utils/               # Shared utilities
│   │   ├── types.mts            # Type definitions
│   │   └── constants.mts        # Constants
│   ├── dist/                    # Build output (gitignored)
│   └── test/                    # Test files
├── packages/yoga-layout/        # WASM builder for Yoga
├── packages/onnx-runtime-builder/ # ONNX Runtime WASM
├── packages/minilm-builder/     # ML model builder
├── packages/node-smol-builder/  # Custom Node.js builder
├── packages/node-sea-builder/   # SEA binary builder
├── docs/                        # Documentation
│   ├── architecture/            # System design
│   ├── build/                   # Build guides
│   ├── development/             # Developer guides
│   └── testing/                 # Testing strategies
└── scripts/                     # Build and utility scripts
```

### Command Architecture Pattern

Each command follows this pattern:
- `cmd-*.mts` - Command definition and CLI interface (meow flags, help text)
- `handle-*.mts` - Business logic and processing
- `output-*.mts` - Output formatting (JSON, markdown, etc.)
- `fetch-*.mts` - API calls (when applicable)

**Example: Scan command**
```
commands/scan/
├── cmd-scan.mts           # CLI interface, flags
├── handle-scan.mts        # Processing logic
├── output-scan.mts        # Format results
└── fetch-scan.mts         # API interactions
```

## Building Advanced Components

Socket CLI includes several advanced build components. You typically don't need to build these for CLI development, but here's how:

### Building WASM Components

```bash
# Build all WASM components
node scripts/build-all-binaries.mjs --wasm-only

# Or build individually
cd packages/yoga-layout
pnpm run build
```

**Requirements:**
- Emscripten SDK (for yoga-layout)
- Rust + wasm-pack (for ONNX, models)

See: [Build Toolchain Setup](../build/build-toolchain-setup.md)

### Building Custom Node.js

```bash
# Build custom Node.js for current platform
node scripts/build-all-binaries.mjs --smol-only
```

**Requirements:**
- Python 3.8+
- C++ compiler (GCC, Clang, or MSVC)
- ~10 GB disk space
- ~30 minutes build time

See: [Build Quick Start](../build/build-quick-start.md)

## Linking to Local Dependencies

For developing with local versions of Socket dependencies:

```bash
# Link to local socket-registry and socket-sdk-js
node scripts/setup-links.mjs

# This enables hot-reloading from sibling repositories
```

See: [Development Linking](./linking.md)

## Troubleshooting

### Issue: "pnpm: command not found"

```bash
# Install pnpm globally
npm install -g pnpm

# Or use corepack (built into Node.js 16+)
corepack enable
corepack prepare pnpm@latest --activate
```

### Issue: "Cannot find module" errors

```bash
# Clean and reinstall dependencies
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm run build
```

### Issue: Tests failing

```bash
# Ensure you built first
pnpm run build

# Run specific failing test for debugging
pnpm test:unit <path-to-test> -t "test name"

# Check if snapshots need updating
pnpm run testu
```

### Issue: "Out of memory" during build

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
pnpm run build
```

### Issue: TypeScript errors

```bash
# Rebuild the project
pnpm run build

# Run type checker
pnpm run type
```

### Issue: Build is very slow

```bash
# Use native TypeScript (Node 22+)
./sd --version  # No build needed!

# Or clean and rebuild
pnpm run clean
pnpm run build
```

### Issue: Can't run CLI after build

```bash
# Check that build succeeded
ls -la packages/cli/dist/cli.js

# Try running directly
node packages/cli/dist/cli.js --version

# Check Node version
node --version  # Should be 20+
```

### Issue: Git hooks failing on commit

```bash
# Fix linting issues first
pnpm run fix

# Or bypass hooks temporarily (not recommended)
git commit --no-verify
```

## Next Steps

Now that you have Socket CLI running locally:

1. **Read the architecture docs:**
   - [Repository Structure](../architecture/repository.md)
   - [Bootstrap/Stub Architecture](../architecture/bootstrap-stub.md)

2. **Learn the coding standards:**
   - Read `CLAUDE.md` in the repository root
   - Review existing commands for patterns

3. **Pick an issue to work on:**
   - Browse [GitHub Issues](https://github.com/SocketDev/socket-cli/issues)
   - Look for "good first issue" labels

4. **Make your first contribution:**
   - Create a feature branch
   - Make your changes
   - Write tests
   - Submit a pull request

## Getting Help

If you encounter issues not covered here:

1. Check existing documentation:
   - [Build Quick Start](../build/build-quick-start.md)
   - [Build Toolchain Setup](../build/build-toolchain-setup.md)
   - [Testing Guide](../testing/local-testing.md)

2. Search [GitHub Issues](https://github.com/SocketDev/socket-cli/issues)

3. Ask in [Socket Community Discord](https://socket.dev/discord)

4. File a [Bug Report](https://github.com/SocketDev/socket-cli/issues/new)

## Quick Command Reference

| Task | Command |
|------|---------|
| Install dependencies | `pnpm install` |
| Build CLI | `pnpm run build` |
| Run CLI | `pnpm exec socket <command>` |
| Run with native TS | `./sd <command>` (Node 22+) |
| Run tests | `pnpm run test:unit` |
| Fix linting | `pnpm run fix` |
| Type check | `pnpm run type` |
| Update snapshots | `pnpm run testu` (CLI package) |
| Clean build artifacts | `pnpm run clean` |

## Verification Checklist

Before submitting your first PR, verify:

- [ ] `pnpm install` completes successfully
- [ ] `pnpm run build` completes without errors
- [ ] `pnpm exec socket --version` shows version number
- [ ] `pnpm run test:unit` passes all tests
- [ ] `pnpm run type` passes without errors
- [ ] `pnpm run fix` fixes any linting issues
- [ ] Your code follows patterns in `CLAUDE.md`
- [ ] You've tested your changes locally

Welcome to Socket CLI development!
