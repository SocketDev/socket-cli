# Socket CLI Build Guide

This document explains the Socket CLI build system and how to create various build artifacts.

## Overview

The Socket CLI has two main build outputs:

| Build Type | Description | Output Location |
|------------|-------------|-----------------|
| **CLI Bundle** | JavaScript bundle for npm distribution | `packages/cli/dist/` |
| **SEA Binaries** | Standalone executables (no Node.js required) | `packages/cli/dist/sea/` |

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 25.5.0 | Development/building |
| Node.js | >= 24.10.0 | Running published package |
| pnpm | >= 10.22.0 | Package manager |

## Quick Reference

```bash
# Standard development build
pnpm build

# Force full rebuild + SEA for current platform
pnpm build --force

# Build SEA binaries for all platforms
pnpm build:sea

# Build SEA for specific platform (two equivalent forms)
pnpm build --target darwin-arm64
pnpm build --platform=darwin --arch=arm64

# Watch mode (auto-rebuild on changes)
pnpm dev
```

---

## Build Architecture

### Directory Structure

```
socket-cli/
├── packages/
│   ├── cli/                      # Main CLI package
│   │   ├── src/                  # TypeScript source
│   │   ├── build/                # Intermediate build files
│   │   │   ├── cli.js            # Bundled CLI (esbuild output)
│   │   │   └── yoga-sync.mjs     # Downloaded WASM module
│   │   └── dist/                 # Distribution files
│   │       ├── index.js          # Entry point loader
│   │       ├── cli.js            # CLI bundle (copied from build/)
│   │       └── sea/              # SEA binaries
│   │           ├── socket-darwin-arm64
│   │           ├── socket-darwin-x64
│   │           ├── socket-linux-arm64
│   │           ├── socket-linux-x64
│   │           ├── socket-win32-arm64.exe
│   │           └── socket-win32-x64.exe
│   ├── build-infra/              # Build infrastructure
│   │   └── build/
│   │       └── downloaded/       # Cached downloads
│   │           ├── node-smol/    # Node.js binaries
│   │           ├── binject/      # Binary injection tool
│   │           ├── yoga-layout/  # Yoga WASM
│   │           └── models/       # AI models
│   └── package-builder/          # Package generation templates
└── scripts/                      # Monorepo build scripts
```

### Build Phases

The CLI build executes in four phases:

```
Phase 1: Clean (optional, with --force)
    └── Removes dist/ directory

Phase 2: Prepare (parallel)
    ├── Generate CLI packages from templates
    └── Download assets from socket-btm releases
        ├── yoga-layout (WASM for terminal rendering)
        ├── node-smol (minimal Node.js binaries)
        ├── binject (binary injection tool)
        └── models (AI models for analysis)

Phase 3: Build variants (parallel)
    ├── CLI bundle (esbuild → build/cli.js)
    └── Index loader (esbuild → dist/index.js)

Phase 4: Post-processing (parallel)
    ├── Copy cli.js to dist/
    ├── Fix node-gyp strings
    └── Copy assets (logos, LICENSE, CHANGELOG)
```

---

## Build Types

### 1. CLI Bundle (npm Distribution)

The standard build creates a JavaScript bundle for npm distribution.

```bash
# From monorepo root
pnpm build

# Or target CLI specifically
pnpm build:cli

# Force rebuild (ignores cache)
pnpm build --force
```

**Output**: `packages/cli/dist/index.js` (entry point)

**What it includes**:
- Bundled CLI code (all dependencies inlined)
- Shadow npm/npx wrappers
- Terminal rendering (Ink/Yoga)

### 2. SEA Binaries (Standalone Executables)

Single Executable Applications bundle Node.js + CLI into one binary.

```bash
# Build for all platforms
pnpm build:sea

# Build for current platform only
pnpm build --force   # Includes SEA for current platform

# Build specific platform
pnpm build --target darwin-arm64
pnpm build --platform darwin --arch arm64
```

**Output**: `packages/cli/dist/sea/socket-<platform>-<arch>`

#### Supported Platforms

| Target | Platform | Architecture | Notes |
|--------|----------|--------------|-------|
| `darwin-arm64` | macOS | Apple Silicon | Native ARM64 |
| `darwin-x64` | macOS | Intel | Native x86_64 |
| `linux-arm64` | Linux | ARM64 | glibc |
| `linux-arm64-musl` | Linux | ARM64 | musl (Alpine) |
| `linux-x64` | Linux | x86_64 | glibc |
| `linux-x64-musl` | Linux | x86_64 | musl (Alpine) |
| `win32-arm64` | Windows | ARM64 | Native |
| `win32-x64` | Windows | x86_64 | Native |

#### SEA Build Process

```
1. Download node-smol binary (minimal Node.js)
   └── From socket-btm GitHub releases

2. Download security tools (optional)
   ├── Python runtime
   ├── Trivy (vulnerability scanner)
   ├── TruffleHog (secret detection)
   └── OpenGrep (SAST engine)

3. Generate SEA configuration
   └── sea-config.json with blob settings

4. Inject using binject
   ├── CLI blob (JavaScript bundle)
   └── VFS (Virtual File System with tools)
```

### 3. Watch Mode (Development)

Automatically rebuilds on source changes.

```bash
pnpm dev
# or
pnpm build:watch
```

**What it does**:
1. Downloads yoga WASM (first time only)
2. Starts esbuild in watch mode
3. Rebuilds `build/cli.js` on changes

**Note**: Watch mode only rebuilds the CLI bundle, not SEA binaries.

---

## Build Commands Reference

### Monorepo Root Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Smart build (skips unchanged) |
| `pnpm build --force` | Force rebuild + SEA for current platform |
| `pnpm build:cli` | Build CLI package only |
| `pnpm build:sea` | Build SEA for all platforms |
| `pnpm dev` | Watch mode |

### Targeted SEA Builds

```bash
# Build SEA for specific platform using --target
pnpm build --target darwin-arm64
pnpm build --target linux-x64
pnpm build --target linux-x64-musl    # Linux with musl libc (Alpine)
pnpm build --target win32-x64

# Build SEA for specific platform using --platform and --arch
pnpm build --platform=darwin --arch=arm64
pnpm build --platform=linux --arch=x64 --libc=musl

# Build SEA for all platforms
pnpm build:sea
```

### CLI Package Commands

Run from `packages/cli/`:

| Command | Description |
|---------|-------------|
| `pnpm run build` | Build CLI |
| `pnpm run build:force` | Force rebuild |
| `pnpm run build:watch` | Watch mode |
| `pnpm run build:sea` | Build SEA binaries |
| `pnpm run build:sea --platform=darwin --arch=arm64` | Specific platform |

---

## Downloaded Assets

Assets are downloaded from [socket-btm](https://github.com/SocketDev/socket-btm) releases and cached in `packages/build-infra/build/downloaded/`.

| Asset | Purpose | Cache Location |
|-------|---------|----------------|
| `node-smol` | Minimal Node.js for SEA | `node-smol/<platform>-<arch>/node` |
| `binject` | Binary injection tool | `binject/<platform>-<arch>/binject` |
| `yoga-layout` | Terminal layout WASM | `yoga-layout/assets/yoga-sync-*.mjs` |
| `models` | AI models for analysis | `models/` |

### Cache Management

```bash
# Clear download cache
rm -rf packages/build-infra/build/downloaded/

# Clear CLI build cache
pnpm --filter @socketsecurity/cli run clean

# Clear all caches
pnpm clean
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GH_TOKEN` | GitHub token for higher API rate limits |
| `GITHUB_TOKEN` | Alternative to GH_TOKEN |
| `SOCKET_CLI_LOCAL_NODE_SMOL` | Use local node-smol binary |
| `SOCKET_CLI_FORCE_BUILD` | Force rebuild (set by --force) |

---

## Build Configurations

### esbuild Configurations

Located in `packages/cli/.config/`:

| Config | Output | Description |
|--------|--------|-------------|
| `esbuild.cli.build.mjs` | `build/cli.js` | Main CLI bundle |
| `esbuild.index.config.mjs` | `dist/index.js` | Entry point loader |

### Build Variants

The unified esbuild config (`esbuild.config.mjs`) orchestrates all variants:

```bash
# Build all variants
node .config/esbuild.config.mjs all

# Build specific variant
node .config/esbuild.config.mjs cli
node .config/esbuild.config.mjs index
node .config/esbuild.config.mjs inject
```

---

## Troubleshooting

### Build Fails: "CLI bundle not found"

```bash
# Build CLI first
pnpm build:cli

# Then build SEA
pnpm build:sea
```

### Download Fails: Rate Limited

```bash
# Set GitHub token for higher rate limits
export GH_TOKEN=your_github_token
pnpm build
```

### SEA Binary Too Large

SEA binaries include security tools (~140 MB compressed). For smaller binaries without tools:

```bash
# Build without security tools (modify orchestration.mjs)
# Or use the npm-distributed version instead
```

### Stale Cache Issues

```bash
# Clear all caches and rebuild
pnpm clean
pnpm build --force
```

### Platform-Specific Issues

**macOS**: Binaries may need code signing for distribution.

**Linux musl**: Use `--libc=musl` for Alpine/musl-based systems.

**Windows**: Output has `.exe` extension automatically.

---

## CI/CD Integration

### GitHub Actions Example

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '25'
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm build
      - run: pnpm test

  build-sea:
    needs: build
    strategy:
      matrix:
        target: [darwin-arm64, darwin-x64, linux-arm64, linux-arm64-musl, linux-x64, linux-x64-musl, win32-arm64, win32-x64]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '25'
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm build:cli
      - run: pnpm build --target ${{ matrix.target }}
```

---

## Summary

| Goal | Command |
|------|---------|
| Development build | `pnpm build` |
| Full rebuild | `pnpm build --force` |
| Watch mode | `pnpm dev` |
| All SEA binaries | `pnpm build:sea` |
| Specific platform SEA | `pnpm build --target darwin-arm64` |
| Run tests | `pnpm test` |
| Clean rebuild | `pnpm clean && pnpm build --force` |
