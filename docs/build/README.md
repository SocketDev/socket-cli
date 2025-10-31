# Socket CLI Build System

Complete guide to building Socket CLI from source.

## Quick Start

```bash
# Build everything with smart caching (recommended)
pnpm build

# Force rebuild all packages
pnpm build --force

# Build CLI package only
pnpm build:cli

# Watch mode for development
pnpm build:watch
# or
pnpm dev
```

## What Gets Built

The Socket CLI build system builds packages in this order:

1. **ONNX Runtime WASM** (`@socketsecurity/onnxruntime`)
   - AI model execution runtime
   - Output: `packages/onnxruntime/dist/ort-wasm-simd.wasm`

2. **Yoga WASM** (`@socketsecurity/yoga`)
   - Terminal layout engine
   - Output: `packages/yoga/dist/yoga.wasm`

3. **CLI Package** (`@socketsecurity/cli`)
   - Main CLI application
   - Output: `packages/cli/dist/index.js`

4. **SEA Binary** (`@socketbin/node-sea-builder-builder`)
   - Single Executable Application (Node.js + CLI bundled)
   - Output: `packages/socketbin-node-sea-builder-builder/bin/socket`

## Build Commands

### Root Level Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Smart build with caching (skips unchanged packages) |
| `pnpm build --force` | Force rebuild everything |
| `pnpm build --target <name>` | Build specific target (see targets below) |
| `pnpm build --platform <p> --arch <a>` | Build specific platform/arch (matches node-sea-builder syntax) |
| `pnpm build --targets <t1,t2,...>` | Build multiple targets |
| `pnpm build --platforms` | Build all platform binaries (8 platforms) |
| `pnpm build --platforms --parallel` | Build platforms in parallel (faster) |
| `pnpm build:cli` | Build just the CLI package |
| `pnpm build:watch` | Watch mode for development |

### CLI Package Commands

```bash
cd packages/cli

# Build CLI
pnpm build

# Force rebuild with clean
pnpm build --force

# Watch mode
pnpm build --watch
```

## Build Targets

Available targets for `pnpm build --target <name>`:

### Primary Targets
- `cli` - CLI package only
- `sea` - SEA binary builder
- `node` - Node.js smol builder
- `socket` - Socket package (bootstrap wrapper)
- `bootstrap` - Bootstrap package

### Platform Binaries
- `darwin-arm64` - macOS Apple Silicon
- `darwin-x64` - macOS Intel
- `linux-arm64` - Linux ARM64
- `linux-x64` - Linux x64
- `alpine-arm64` - Alpine Linux ARM64
- `alpine-x64` - Alpine Linux x64
- `win32-arm64` - Windows ARM64
- `win32-x64` - Windows x64

### Examples

```bash
# Build just the CLI
pnpm build --target cli

# Build for specific platform (combined syntax)
pnpm build --target darwin-arm64

# Build for specific platform (separate flags - matches node-sea-builder)
pnpm build --platform darwin --arch arm64

# Build multiple targets
pnpm build --targets cli,sea

# Build all platform binaries sequentially
pnpm build --platforms

# Build all platform binaries in parallel (faster)
pnpm build --platforms --parallel
```

## Build Features

### Intelligent Caching

The build system automatically skips packages that are already built and haven't changed:

```bash
pnpm build
# First run: Builds all 4 packages (~2-5 minutes)

pnpm build
# Second run: Skips all unchanged packages (< 1 second)
```

To force rebuild:

```bash
pnpm build --force
```

### Watch Mode

For active development, use watch mode to automatically rebuild on changes:

```bash
pnpm build:watch
# or
pnpm dev
```

This watches for changes in the CLI package and automatically rebuilds.

## Build Output

### Directory Structure

```
packages/
├── cli/
│   ├── dist/
│   │   ├── index.js          # Main CLI bundle
│   │   ├── cli.js            # CLI core (compressed)
│   │   └── cli.js.bz         # Brotli compressed CLI
│   └── build/
│       ├── cli.js            # Pre-compression CLI bundle
│       ├── yoga-sync.mjs     # Yoga WASM loader
│       └── onnx-sync.mjs     # ONNX WASM loader
│
├── onnxruntime/
│   └── dist/
│       └── ort-wasm-simd.wasm
│
├── yoga/
│   └── dist/
│       └── yoga.wasm
│
└── socketbin-node-sea-builder-builder/
    └── bin/
        └── socket             # SEA binary
```

### Build Artifacts

The CLI build process creates these artifacts:

1. **TypeScript Compilation** - `.mts` → `.js`
2. **Bundling** - All code bundled into single file with esbuild
3. **WASM Extraction** - Yoga and ONNX WASM files extracted
4. **Compression** - Brotli compression for distribution
5. **Checksums** - SHA256 checksums for verification

## Build Time Estimates

| Build Type | Time | Disk Space |
|------------|------|------------|
| CLI only (cached) | < 1s | N/A |
| CLI only (fresh) | 30-60s | ~50 MB |
| Full build (cached) | < 1s | N/A |
| Full build (fresh) | 2-5 min | ~200 MB |
| Platform binaries (sequential) | 30-60 min | ~1 GB |
| Platform binaries (parallel) | 10-20 min | ~1 GB |

## Setup Requirements

### Development Dependencies

Install dependencies:

```bash
pnpm install
```

### Platform-Specific Tools

See [Build Toolchain Setup](build-toolchain-setup.md) for platform-specific installation guides.

**Quick check:**

```bash
# Verify you have required tools
node --version   # >=18
pnpm --version   # >=10.16.0
```

## Build Configuration

### Environment Variables

Configure builds with environment variables:

```bash
# Published build (production optimizations)
INLINED_SOCKET_CLI_PUBLISHED_BUILD=1 pnpm build

# Legacy build (compatibility mode)
INLINED_SOCKET_CLI_LEGACY_BUILD=1 pnpm build

# Sentry build (with error tracking)
INLINED_SOCKET_CLI_SENTRY_BUILD=1 pnpm build

# No minification (for debugging)
SOCKET_CLI_NO_MINIFY=1 pnpm build

# Force build (skip cache)
SOCKET_CLI_FORCE_BUILD=1 pnpm build
```

### Build Scripts

The build system consists of:

- **Root**: `scripts/build.mjs` - Orchestrates full build with caching
- **CLI**: `packages/cli/scripts/build.mjs` - Builds CLI package
- **esbuild**: `packages/cli/.config/esbuild.cli.build.mjs` - Bundle configuration

## Troubleshooting

### Build Fails with "Module not found"

**Solution**: Ensure dependencies are installed:

```bash
pnpm install
```

### Build is Slow

**Solution**: Use caching and parallel builds:

```bash
# Smart caching (only rebuilds changed packages)
pnpm build

# Parallel platform builds
pnpm build --platforms --parallel
```

### "Command not found: pnpm"

**Solution**: Install pnpm:

```bash
npm install -g pnpm@latest
```

### Clean Build After git pull

**Solution**: Force rebuild:

```bash
pnpm build --force
```

### WASM Files Missing

**Solution**: Build will automatically extract WASM files, but you can manually run:

```bash
cd packages/cli
node scripts/extract-yoga-wasm.mjs
```

## Related Documentation

- [Build/Dist Structure](build-dist-structure.md) - Output directory structure
- [Caching Strategy](caching-strategy.md) - How caching works
- [WASM Build Guide](wasm-build-guide.md) - Building WASM packages
- [Node.js Build Quick Reference](node-build-quick-reference.md) - Building custom Node.js
- [Node.js Patch Creation Guide](node-patch-creation-guide.md) - Creating Node.js patches

## Advanced Topics

### Building Custom Node.js Binaries

For building custom Node.js binaries with Socket patches, see:
- [Node.js Build Quick Reference](node-build-quick-reference.md)
- [Node.js Patch Creation Guide](node-patch-creation-guide.md)

### Platform-Specific Builds

Build for specific platforms:

```bash
# macOS Apple Silicon
pnpm build --target darwin-arm64

# Linux x64
pnpm build --target linux-x64

# Windows x64
pnpm build --target win32-x64
```

### SEA Binary Build

Build the Single Executable Application:

```bash
# Via target
pnpm build --target sea

# Via CLI package
cd packages/cli
pnpm build --sea
```

### CI/CD Integration

For CI/CD pipelines:

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Build everything
pnpm build

# Verify build
pnpm check
pnpm test
```

## Help

For more help:

```bash
# Show build system help
pnpm build --help

# Show available targets
pnpm build --help | grep -A20 "Available Targets"
```
