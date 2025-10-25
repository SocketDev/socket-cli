# WASM Build Guide

Quick reference for building and optimizing Socket CLI's WASM bundle.

---

## Quick Start

### Production Build

```bash
# Full optimized build (~5-10 minutes)
node scripts/wasm/build-unified-wasm.mjs

# Or via CLI wrapper
node scripts/wasm.mjs --build
```

### Fast Dev Build (3-5x Faster)

```bash
# Minimal optimization, fast iteration (~2-5 minutes)
node scripts/wasm/build-unified-wasm.mjs --dev

# Or via CLI wrapper
node scripts/wasm.mjs --build --dev
```

---

## Build Modes Comparison

| Mode | Build Time | Size | Use Case |
|------|------------|------|----------|
| **Dev** | 2-5 min | ~108-110 MB | Rapid iteration, testing |
| **Production** | 5-10 min | ~108-110 MB | Release, deployment |

Both modes produce similar final sizes due to symbol stripping, but production has better runtime performance.

---

## Optimization Levels

### Dev Build (`--dev`)

**Cargo Profile**: `dev-wasm`

```toml
opt-level = 1           # Minimal optimization
lto = false             # No link-time optimization
codegen-units = 16      # Parallel compilation (faster)
strip = true            # Strip symbols (smaller)
```

**RUSTFLAGS**:
```bash
-C target-feature=+simd128  # Enable WASM SIMD
```

### Production Build (default)

**Cargo Profile**: `release`

```toml
opt-level = "z"         # Maximum size optimization
lto = "thin"            # Thin link-time optimization
codegen-units = 1       # Single unit (best optimization)
strip = true            # Strip symbols
panic = "abort"         # No unwinding code
```

**RUSTFLAGS**:
```bash
-C target-feature=+simd128      # Enable WASM SIMD
-C link-arg=--strip-debug       # Strip debug info
-C link-arg=--strip-all         # Strip all symbols
```

---

## Performance Optimizations

### 1. Build Caching (Optional but Recommended)

Install sccache for 40-60% faster clean builds:

```bash
# Install
cargo install sccache

# Configure environment
export RUSTC_WRAPPER=sccache
export SCCACHE_DIR=$HOME/.cache/sccache

# Check cache stats
sccache --show-stats
```

### 2. Auto-Setup Environment

```bash
# Interactive setup
node scripts/wasm/setup-build-env.mjs

# Apply to shell
eval "$(node scripts/wasm/setup-build-env.mjs --export)"

# Or append to shell config
node scripts/wasm/setup-build-env.mjs --export >> ~/.zshrc
source ~/.zshrc
```

### 3. Parallel Builds

Ensure cargo uses all CPU cores:

```bash
export CARGO_BUILD_JOBS=$(nproc)  # Linux
export CARGO_BUILD_JOBS=$(sysctl -n hw.ncpu)  # macOS
```

---

## Benchmarking

Compare dev vs production build times:

```bash
# Benchmark both modes
node scripts/wasm/benchmark-build.mjs

# Benchmark dev only
node scripts/wasm/benchmark-build.mjs --dev-only

# Benchmark production only
node scripts/wasm/benchmark-build.mjs --prod-only
```

**Expected Output**:
```
Build Time Comparison:
  Dev Build:   2m 30s
  Prod Build:  8m 15s
  Speedup:     3.3x faster (dev vs prod)
```

---

## Build Pipeline

The build process consists of these steps:

1. **Check Rust toolchain** - Install if missing
2. **Download models** - CodeT5, MiniLM, ONNX Runtime, Yoga
3. **Convert models** - INT4 quantization for CodeT5
4. **Build WASM** - Rust → WASM compilation
5. **Optimize WASM** - wasm-opt -Oz (5-15% reduction)
6. **Compress** - Brotli quality 11 (~70% reduction)
7. **Embed** - Base64 encode into JavaScript

---

## Size Breakdown

### Before Compression

| Component | Size |
|-----------|------|
| MiniLM model (INT8) | ~17 MB |
| CodeT5 encoder (INT4) | ~30 MB |
| CodeT5 decoder (INT4) | ~60 MB |
| Tokenizers | ~1 MB |
| ONNX Runtime | ~2-5 MB |
| Yoga Layout | ~95 KB |
| **Total** | **~115 MB** |

### After Optimization

| Stage | Size | Reduction |
|-------|------|-----------|
| Raw WASM | ~115 MB | baseline |
| wasm-opt -Oz | ~108-110 MB | 5-10% |
| Brotli (quality 11) | ~32-35 MB | ~70% |

---

## Troubleshooting

### Build is slow

1. **Use dev mode for iteration**:
   ```bash
   node scripts/wasm/build-unified-wasm.mjs --dev
   ```

2. **Install sccache**:
   ```bash
   cargo install sccache
   export RUSTC_WRAPPER=sccache
   ```

3. **Check CPU usage**:
   ```bash
   export CARGO_BUILD_JOBS=$(nproc)
   ```

### Build fails with wasm-opt

The build will continue without optimization:

```bash
# Install binaryen for wasm-opt
brew install binaryen  # macOS
sudo apt-get install binaryen  # Linux
choco install binaryen  # Windows
```

### Out of memory

Large WASM builds may require more memory:

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=8192"
```

### Incremental builds not working

WASM builds disable incremental compilation:

```toml
[profile.dev-wasm]
incremental = false  # Required for WASM
```

Use sccache instead for faster rebuilds.

---

## CI/CD Recommendations

### GitHub Actions

```yaml
- name: Setup Rust
  uses: actions-rs/toolchain@v1
  with:
    toolchain: stable
    target: wasm32-unknown-unknown

- name: Install wasm-pack
  run: cargo install wasm-pack

- name: Install binaryen
  run: |
    brew install binaryen  # macOS
    # or apt-get install binaryen for Linux

- name: Setup build cache
  uses: actions/cache@v3
  with:
    path: |
      ~/.cargo/registry
      ~/.cargo/git
      target
      ~/.cache/sccache
    key: ${{ runner.os }}-wasm-${{ hashFiles('**/Cargo.lock') }}

- name: Build WASM
  run: node scripts/wasm/build-unified-wasm.mjs
```

### Cache Strategy

1. **Cargo registry/git** - Dependencies (~500 MB)
2. **Target directory** - Compiled artifacts (~2-3 GB)
3. **sccache directory** - Compilation cache (~1-2 GB)

---

## Advanced: Manual Build Steps

If you need fine-grained control:

### 1. Direct Cargo Build

```bash
cd packages/socketbin-custom-node-from-source/wasm-bundle

# Dev build
cargo build --target wasm32-unknown-unknown --profile dev-wasm

# Production build
cargo build --target wasm32-unknown-unknown --release
```

### 2. Manual wasm-opt

```bash
# Optimize for size
wasm-opt -Oz input.wasm -o output.wasm

# Optimize for speed
wasm-opt -O3 input.wasm -o output.wasm

# With SIMD
wasm-opt -Oz --enable-simd input.wasm -o output.wasm
```

### 3. Manual Compression

```bash
# Brotli compression
brotli -q 11 -w 24 socket_ai_bg.wasm -o socket_ai_bg.wasm.br

# Check compression ratio
ls -lh socket_ai_bg.wasm*
```

---

## References

- **Cargo Profiles**: https://doc.rust-lang.org/cargo/reference/profiles.html
- **wasm-pack**: https://rustwasm.github.io/wasm-pack/
- **wasm-opt (Binaryen)**: https://github.com/WebAssembly/binaryen
- **sccache**: https://github.com/mozilla/sccache
- **Ultrathink learnings**: `.claude/wasm-optimization-summary.md`

---

## Summary

**For development**:
```bash
node scripts/wasm/build-unified-wasm.mjs --dev  # Fast iteration
```

**For production**:
```bash
node scripts/wasm/build-unified-wasm.mjs  # Fully optimized
```

**For benchmarking**:
```bash
node scripts/wasm/benchmark-build.mjs  # Compare performance
```

**For optimization**:
```bash
node scripts/wasm/setup-build-env.mjs  # Setup caching
```
