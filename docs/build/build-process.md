# Socket CLI Build Process

Complete guide for building all Socket CLI binaries from source.

## 📋 Overview

Socket CLI consists of multiple build artifacts:
- **WASM components**: yoga-layout, onnx-runtime, AI models
- **Custom Node.js**: Patched Node.js with size optimizations (smol variant)
- **SEA binaries**: Single Executable Application binaries for distribution
- **Platform binaries**: 8 platforms x 2 variants = 16 total binaries

## 🏗️ Build Architecture

```
packages/
├── node-smol-builder/          # Custom Node.js builder
│   ├── build/
│   │   ├── node-source/        # Pristine Node.js source (--depth=1 clone)
│   │   ├── cli-darwin-arm64/   # macOS ARM64 build artifacts
│   │   ├── cli-darwin-x64/     # macOS Intel build artifacts
│   │   ├── cli-linux-arm64/    # Linux ARM64 build artifacts
│   │   ├── cli-linux-x64/      # Linux x64 build artifacts
│   │   ├── cli-alpine-arm64/   # Alpine ARM64 build artifacts
│   │   ├── cli-alpine-x64/     # Alpine x64 build artifacts
│   │   ├── cli-win32-arm64/    # Windows ARM64 build artifacts
│   │   └── cli-win32-x64/      # Windows x64 build artifacts
│   └── dist/                   # Final optimized binaries
│
├── node-sea-builder/           # SEA builder
│   ├── build/
│   │   ├── cli-darwin-arm64/   # macOS ARM64 SEA artifacts
│   │   ├── cli-darwin-x64/     # macOS Intel SEA artifacts
│   │   ├── cli-linux-arm64/    # Linux ARM64 SEA artifacts
│   │   ├── cli-linux-x64/      # Linux x64 SEA artifacts
│   │   ├── cli-alpine-arm64/   # Alpine ARM64 SEA artifacts
│   │   ├── cli-alpine-x64/     # Alpine x64 SEA artifacts
│   │   ├── cli-win32-arm64/    # Windows ARM64 SEA artifacts
│   │   └── cli-win32-x64/      # Windows x64 SEA artifacts
│   └── dist/                   # Final SEA binaries
│
├── yoga-layout/                # Yoga Layout WASM
│   └── build/
│       └── yoga.wasm           # Compiled WASM module
│
├── onnx-runtime-builder/       # ONNX Runtime WASM
│   └── build/
│       └── onnx-runtime.wasm   # Compiled WASM module
│
├── codet5-models-builder/      # CodeT5 model optimization
│   └── build/
│       └── models/             # Optimized ONNX models
│
└── minilm-builder/             # MiniLM model optimization
    └── build/
        └── models/             # Optimized ONNX models
```

## 🚀 Quick Start

### Build Current Platform Only

```bash
# Build WASM + current platform (fastest)
node scripts/build-all-binaries.mjs

# Build only WASM components
node scripts/build-all-binaries.mjs --wasm-only

# Build only smol variant for current platform
node scripts/build-all-binaries.mjs --smol-only

# Build only SEA variant for current platform
node scripts/build-all-binaries.mjs --sea-only
```

### Build All Platforms (Cross-Compilation)

```bash
# Build all 8 platforms (requires Docker + cross-compile toolchains)
node scripts/build-all-binaries.mjs --all-platforms

# Expected time: 4-8 hours depending on hardware
# Expected disk space: ~50 GB (includes build artifacts)
```

## 📦 Phase 1: WASM Components

WASM components must be built first as they're embedded in binaries.

### Yoga Layout

```bash
cd packages/yoga-layout
pnpm run build

# Output: build/yoga.wasm (~200 KB)
# Used for: Terminal UI layout calculations
```

### ONNX Runtime

```bash
cd packages/onnx-runtime-builder
pnpm run build

# Output: build/onnx-runtime.wasm (~2 MB)
# Used for: AI model inference engine
```

### CodeT5 Models

```bash
cd packages/codet5-models-builder
pnpm run build

# Output: build/models/codet5-*.onnx (~90 MB total)
# Used for: Code analysis and suggestions
```

### MiniLM Models

```bash
cd packages/minilm-builder
pnpm run build

# Output: build/models/minilm.onnx (~17 MB)
# Used for: Text embeddings and similarity
```

## 🛠️ Phase 2: Custom Node.js (smol variant)

The `node-smol-builder` package creates a size-optimized Node.js binary with Socket patches.

### Build Process

```bash
cd packages/node-smol-builder
pnpm run build

# Steps performed:
# 1. Clone Node.js v24.10.0 to build/node-source (--depth=1)
# 2. Apply 7 custom patches from patches/socket/
# 3. Apply custom C++ additions from additions/
# 4. Configure with size optimization flags
# 5. Compile Node.js
# 6. Strip and optimize binary
# 7. Sign binary (macOS only)
# 8. Copy to build/cli-{platform}/node
```

### Size Optimizations

Starting from ~49 MB default Node.js build:

1. **Configure flags** (-25 MB):
   - `--with-intl=none` (remove ICU)
   - `--v8-lite-mode` (disable TurboFan JIT)
   - `--disable-SEA` (remove SEA support)
   - `--without-npm --without-inspector`

2. **Binary stripping** (-3 MB):
   - `strip --strip-all` (remove debug symbols)
   - `llvm-strip` on macOS

3. **Compression** (-6 MB):
   - Brotli compress embedded modules
   - **Target: ~18 MB per binary**

### Node Source Management

The build script clones Node.js source to `build/node-source`:

```bash
# Pristine Node.js source (not modified directly)
build/node-source/
├── deps/
├── lib/
├── src/
└── node.gyp
```

**Important**: Never modify `build/node-source/` directly. All changes must go through:
- `patches/socket/*.patch` - Source code patches
- `additions/` - Additional C++ files

## 📱 Phase 3: SEA Binaries

The `node-sea-builder` package creates Single Executable Application binaries using native Node.js.

### Build Process

```bash
cd packages/node-sea-builder
pnpm run build --platform darwin-arm64

# Steps performed:
# 1. Bundle Socket CLI JavaScript with esbuild
# 2. Generate SEA blob with Node.js injector
# 3. Download/use platform Node.js binary
# 4. Inject SEA blob into Node.js binary
# 5. Sign binary (macOS/Windows)
# 6. Copy to build/cli-{platform}/socket
```

### Platform Binaries

SEA binaries are built for each platform:

| Platform | Architecture | Binary Name | Size |
|----------|-------------|-------------|------|
| darwin-arm64 | macOS Apple Silicon | socket | ~50 MB |
| darwin-x64 | macOS Intel | socket | ~50 MB |
| linux-arm64 | Linux ARM64 | socket | ~50 MB |
| linux-x64 | Linux x64 | socket | ~50 MB |
| alpine-arm64 | Alpine Linux ARM64 | socket | ~40 MB |
| alpine-x64 | Alpine Linux x64 | socket | ~40 MB |
| win32-arm64 | Windows ARM64 | socket.exe | ~55 MB |
| win32-x64 | Windows x64 | socket.exe | ~55 MB |

## 🐳 Cross-Platform Compilation

### Linux Platforms (via Docker)

```bash
# Build all Linux variants
docker compose -f docker/docker-compose.build.yml up

# Build specific variant
docker compose -f docker/docker-compose.build.yml up build-linux-arm64
```

### macOS Platforms

macOS binaries must be built on macOS:

```bash
# On macOS ARM64 (M1/M2/M3)
node scripts/build-all-binaries.mjs --smol-only

# On macOS Intel
node scripts/build-all-binaries.mjs --smol-only

# Or use GitHub Actions with macos-latest and macos-13 runners
```

### Windows Platforms

Windows binaries must be built on Windows or via GitHub Actions:

```bash
# On Windows (PowerShell)
node scripts\build-all-binaries.mjs --sea-only

# Or use GitHub Actions with windows-latest runner
```

## 📁 Build Artifacts Organization

After building, artifacts are organized as follows:

```
packages/node-smol-builder/build/
├── node-source/              # Shared Node.js source (pristine)
├── cli-darwin-arm64/
│   ├── node                  # Custom Node.js binary
│   ├── yoga.wasm            # Embedded WASM modules
│   ├── onnx-runtime.wasm
│   └── models/              # AI models
└── cli-linux-x64/
    ├── node
    ├── yoga.wasm
    ├── onnx-runtime.wasm
    └── models/

packages/node-sea-builder/build/
├── cli-darwin-arm64/
│   └── socket               # SEA binary with bundled JS
└── cli-linux-x64/
    └── socket
```

## Distribution Packages

Final binaries are copied to platform-specific packages:

```
packages/socketbin-cli-darwin-arm64/
└── bin/
    └── socket               # Distributed binary (smol or SEA)

packages/socketbin-cli-linux-x64/
└── bin/
    └── socket
```

## ⏱️ Build Time Estimates

| Task | Time (M1 Max) | Time (Intel i7) |
|------|---------------|-----------------|
| WASM components | ~5 minutes | ~10 minutes |
| Node.js smol (1 platform) | ~20 minutes | ~40 minutes |
| Node.js smol (all platforms) | ~3 hours | ~6 hours |
| SEA binaries (all platforms) | ~30 minutes | ~1 hour |
| **Total (all builds)** | **~4 hours** | **~8 hours** |

## 💾 Disk Space Requirements

| Component | Size |
|-----------|------|
| Node.js source | ~500 MB |
| Node.js build artifacts (per platform) | ~2 GB |
| WASM modules | ~300 MB |
| AI models (uncompressed) | ~400 MB |
| Final binaries (per platform) | ~50 MB |
| **Total workspace** | **~20 GB (1 platform)** |
| **Total workspace (all platforms)** | **~50 GB** |

## 🔧 Troubleshooting

### Build Failures

1. **Node.js compile errors**: Check that patches apply cleanly
2. **WASM build errors**: Ensure Rust toolchain is installed (`rustup`)
3. **Model build errors**: May be placeholder implementations

### Cross-Compilation Issues

1. **Docker permission errors**: Add user to docker group
2. **QEMU emulation slow**: Use native hardware or GitHub Actions
3. **Windows build on macOS**: Not possible, use GitHub Actions

### Disk Space Issues

1. Clean build artifacts: `pnpm run clean`
2. Remove node_modules: `find . -name node_modules -type d -prune -exec rm -rf {} +`
3. Clean Docker: `docker system prune -a`

## 📚 Related Documentation

- [WASM Build Guide](./wasm-build-guide.md)
- [Node.js Patches](../packages/node-smol-builder/patches/socket/README.md)
- [Binary Optimization](../packages/node-smol-builder/scripts/optimize.mjs)
- [Docker Builds](../docker/README.md)
