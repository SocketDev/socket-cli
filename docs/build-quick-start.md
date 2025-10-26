# Socket CLI Build Quick Start

## 🚀 TL;DR

```bash
# Install toolchain (one time)
# See: docs/build-toolchain-setup.md

# Build everything for current platform
node scripts/build-all-binaries.mjs

# Expected time: ~30 minutes
# Output: packages/node-{smol,sea}-builder/build/cli-{platform}/
```

## 📦 What Gets Built

### Builder Packages (build from source)
- ✅ `node-smol-builder` - Custom Node.js with Socket patches (~18 MB)
- ✅ `node-sea-builder` - SEA binaries for distribution (~50 MB)
- ✅ `onnx-runtime-builder` - ONNX Runtime WASM
- ✅ `codet5-models-builder` - CodeT5 model optimization
- ✅ `minilm-builder` - MiniLM model optimization
- ✅ `yoga-layout` - Yoga Layout WASM

### Distributable Packages (published artifacts)
- `socketbin-cli-darwin-arm64` - macOS Apple Silicon binary
- `socketbin-cli-darwin-x64` - macOS Intel binary
- `socketbin-cli-linux-arm64` - Linux ARM64 binary
- `socketbin-cli-linux-x64` - Linux x64 binary
- `socketbin-cli-alpine-arm64` - Alpine Linux ARM64 binary
- `socketbin-cli-alpine-x64` - Alpine Linux x64 binary
- `socketbin-cli-win32-arm64` - Windows ARM64 binary
- `socketbin-cli-win32-x64` - Windows x64 binary

## 🎯 Common Build Scenarios

### Scenario 1: Local Development (Current Platform)

```bash
# Build only what you need for local testing
node scripts/build-all-binaries.mjs --smol-only

# Or if you prefer SEA binaries
node scripts/build-all-binaries.mjs --sea-only
```

**Time**: ~30 minutes
**Disk**: ~10 GB
**Output**: `packages/node-smol-builder/build/cli-darwin-arm64/` (or your platform)

### Scenario 2: Testing WASM Changes

```bash
# Build only WASM components
node scripts/build-all-binaries.mjs --wasm-only

# Then use existing Node.js binaries
pnpm run dev
```

**Time**: ~5 minutes
**Disk**: ~1 GB
**Output**: `packages/*/build/*.wasm`

### Scenario 3: Release Build (All Platforms)

```bash
# Requires: Docker, cross-compile toolchains
node scripts/build-all-binaries.mjs --all-platforms

# Or use GitHub Actions (recommended)
git push  # Triggers CI/CD build
```

**Time**: ~4-8 hours
**Disk**: ~50 GB
**Output**: All 8 platform binaries in both variants

### Scenario 4: CI/CD (GitHub Actions)

GitHub Actions automatically builds all platforms on:
- Push to `main`
- Pull request
- Tag push (triggers release)

See: `.github/workflows/release-sea.yml`

## 📂 Build Output Structure

After building, artifacts are organized as:

```
packages/node-smol-builder/
├── build/
│   ├── node-source/              # Pristine Node.js v24.10.0 (shared)
│   ├── cli-darwin-arm64/
│   │   ├── node                  # Custom Node.js binary (18 MB)
│   │   ├── yoga.wasm            # Yoga Layout WASM (200 KB)
│   │   ├── onnx-runtime.wasm    # ONNX Runtime WASM (2 MB)
│   │   └── models/              # AI models (compressed)
│   └── cli-linux-x64/
│       └── ...                   # Same structure
└── dist/
    └── socket-darwin-arm64       # Final optimized binary

packages/node-sea-builder/
├── build/
│   ├── cli-darwin-arm64/
│   │   └── socket               # SEA binary with bundled JS (50 MB)
│   └── cli-linux-x64/
│       └── socket
└── dist/
    └── socket-darwin-arm64       # Final SEA binary

packages/socketbin-cli-darwin-arm64/
└── bin/
    └── socket                    # Published binary (copied from above)
```

## 🔍 Verifying Builds

```bash
# Check build artifacts exist
ls -lh packages/node-smol-builder/build/cli-*/

# Test binary works
packages/node-smol-builder/build/cli-darwin-arm64/node --version

# Run smoke tests
node scripts/verify-node-build.mjs

# Check binary size
du -sh packages/*/build/cli-*/node
```

## 🧹 Cleaning Up

```bash
# Clean all build artifacts
pnpm run clean

# Clean specific package
cd packages/node-smol-builder
pnpm run clean

# Clean Docker images
docker system prune -a

# Nuclear option: clean everything
rm -rf packages/*/build packages/*/dist node_modules .pnpm-store
pnpm install
```

## ⚡ Speed Optimization Tips

1. **Use ccache** (caches C++ compilation):
   ```bash
   brew install ccache  # macOS
   export CC="ccache gcc" CXX="ccache g++"
   ```

2. **Parallel builds** (use all CPU cores):
   ```bash
   export JOBS=$(nproc)  # Linux
   export JOBS=$(sysctl -n hw.ncpu)  # macOS
   ```

3. **Skip tests** during build:
   ```bash
   node scripts/build-all-binaries.mjs --skip-tests
   ```

4. **Use pre-built WASM** (skip WASM build):
   ```bash
   node scripts/build-all-binaries.mjs --skip-wasm
   ```

## 🐛 Common Issues

### Issue: "Emscripten SDK not found"
```bash
# Install and activate Emscripten
source ~/.emsdk/emsdk_env.sh

# Or add to shell profile
echo 'source ~/.emsdk/emsdk_env.sh' >> ~/.zshrc
```

### Issue: "Python version too old"
```bash
# macOS: Install Python 3.12+
brew install python@3.12

# Linux: Use deadsnakes PPA
sudo apt-get install python3.12
```

### Issue: "Out of disk space"
```bash
# Clean build artifacts
pnpm run clean

# Clean Docker
docker system prune -a

# Check disk usage
du -sh packages/*/build
```

### Issue: "Node.js build fails"
```bash
# Check build log
cat packages/node-smol-builder/build/build.log

# Common causes:
# - Missing Python 3
# - Missing C++ compiler
# - Insufficient RAM (need 8GB+)
# - Disk space (need 10GB+)
```

## 📊 Build Time & Size Reference

| Platform | Variant | Build Time | Binary Size | Disk Usage |
|----------|---------|------------|-------------|------------|
| darwin-arm64 | smol | ~20 min | ~18 MB | ~2 GB |
| darwin-arm64 | SEA | ~5 min | ~50 MB | ~500 MB |
| linux-x64 | smol | ~40 min | ~13 MB | ~2 GB |
| linux-x64 | SEA | ~10 min | ~50 MB | ~500 MB |
| win32-x64 | SEA | ~15 min | ~55 MB | ~500 MB |

*Times measured on M1 Max MacBook Pro*

## 📚 Next Steps

1. **First build**: Read [Build Toolchain Setup](./build-toolchain-setup.md)
2. **Understanding builds**: Read [Build Process](./build-process.md)
3. **Customizing Node.js**: See [Node.js Patches](../packages/node-smol-builder/patches/socket/README.md)
4. **Cross-platform**: See [Docker Builds](../docker/README.md)
5. **CI/CD**: See `.github/workflows/release-sea.yml`

## 🆘 Getting Help

If you encounter issues:

1. Check [Build Toolchain Setup](./build-toolchain-setup.md)
2. Check [Build Process](./build-process.md)
3. Search [GitHub Issues](https://github.com/SocketDev/socket-cli/issues)
4. Ask in [Socket Community Discord](https://socket.dev/discord)
