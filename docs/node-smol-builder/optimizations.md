# Node.js Binary Optimizations

**Comprehensive optimization guide** — How we reduced Node.js binaries from 60MB+ to ~35MB.

---

## 🎯 Optimization Goals

```
Starting point: 60MB Node.js v24 binary
Target:         35MB or less
Achieved:       ~35MB (42% reduction)
Method:         Configure flags + stripping + compression
```

**Key constraints:**
- ✅ Maintain WASM support (required for CLI features)
- ✅ Support current Node.js LTS versions (20, 22, 24)
- ✅ Cross-platform (macOS, Linux, Windows)
- ✅ No significant performance degradation

---

## 📊 Optimization Summary

| Optimization | Savings | Risk | Status |
|--------------|---------|------|--------|
| V8 Lite Mode | -23MB | None | ✅ Applied |
| ICU Removal | -8MB | Low | ✅ Applied |
| SEA Removal | -2MB | None | ✅ Applied |
| GNU Strip | -3MB extra | None | ✅ Applied |
| Ninja Build | 0MB (speed) | None | ✅ Applied |
| Code Signing | 0MB (compat) | None | ✅ Applied |

**Total reduction: ~36MB (60% smaller)**

---

## 🔧 Applied Optimizations

### 1. V8 Lite Mode (-23MB)

**What it does:**
- Disables V8's JIT compiler optimization tiers (TurboFan, Maglev)
- Keeps Sparkplug (baseline compiler) and Liftoff (WASM compiler)
- Significantly reduces V8 code size

**Configure flag:**
```bash
--v8-lite-mode
```

**Impact:**
- ✅ -23MB binary size
- ✅ WASM still works (Liftoff compiler)
- ⚠️ ~10-20% slower JavaScript execution (acceptable for CLI)
- ✅ Fast startup time (no JIT warmup needed)

**Trade-off analysis:**
```
CLI workload characteristics:
- Short-lived processes (scan, install, etc.)
- I/O bound (network, filesystem)
- JIT warmup time > execution time savings
- WASM performance unaffected

Conclusion: Lite mode is ideal for CLI use case
```

---

### 2. ICU Removal (-8MB)

**What it does:**
- Removes International Components for Unicode (ICU) library
- Disables i18n features (Intl API, timezone data, etc.)

**Configure flag:**
```bash
--with-intl=none
```

**Impact:**
- ✅ -8MB binary size
- ⚠️ No `Intl.*` APIs (DateTimeFormat, NumberFormat, etc.)
- ✅ CLI doesn't use i18n features
- ✅ String operations still work (ASCII/UTF-8)

**What still works:**
- `String.prototype.toLowerCase()` (ASCII only)
- `Date.now()`, `new Date()`
- Basic string methods

**What doesn't work:**
- `Intl.DateTimeFormat`
- `Intl.NumberFormat`
- `String.prototype.localeCompare`
- Timezone conversions

---

### 3. SEA Removal (-2MB)

**What it does:**
- Removes Single Executable Application (SEA) support
- SEA allows embedding Node.js apps in the binary itself

**Configure flag:**
```bash
--disable-single-executable-application
```

**Impact:**
- ✅ -2MB binary size
- ✅ We don't use SEA (we use pkg/yao-pkg instead)
- ✅ No functionality loss

**Why we can remove it:**
- Socket CLI uses yao-pkg for binary packaging
- SEA is for embedding apps in Node itself
- Different use case

---

### 4. GNU Strip (-3MB Extra)

**What it does:**
- Uses GNU strip instead of macOS native strip
- More aggressive debug symbol removal

**Implementation:**
```bash
# Install GNU binutils on macOS
brew install binutils

# Use GNU strip
/opt/homebrew/opt/binutils/bin/strip --strip-all node
```

**Impact:**
- ✅ -3MB additional savings vs macOS strip
- ✅ More aggressive than `strip -x`
- ✅ Safe (only removes debug symbols)

**Comparison:**
```
No strip:        60MB
macOS strip -x:  38MB (-22MB)
GNU strip:       35MB (-25MB, 3MB better!)
```

---

### 5. Ninja Build (Speed Only)

**What it does:**
- Uses Ninja build system instead of Make
- Parallel builds, incremental compilation

**Configure flag:**
```bash
--ninja
```

**Impact:**
- ✅ 17% faster builds (~15-18min vs ~18-22min)
- ✅ Incremental builds (2-4min vs full rebuild)
- ✅ Better dependency tracking
- ⚠️ No size reduction (build tool only)

**Build time comparison:**
```
Make:
  Clean build:  18-22 minutes
  Incremental:  Full rebuild required

Ninja:
  Clean build:  15-18 minutes (-17%)
  Incremental:  2-4 minutes
```

---

### 6. Code Signing (macOS ARM64)

**What it does:**
- Signs binaries with ad-hoc signature on macOS ARM64
- Required for execution on Apple Silicon

**Implementation:**
```bash
codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime node
```

**Impact:**
- ✅ Binaries work on macOS ARM64
- ✅ No size impact
- ✅ Required for distribution

---

## ❌ Rejected Optimizations

### SSL Removal (-10-15MB) — REJECTED

**Why rejected:**
- Breaks HTTPS connections
- CLI needs secure API communication
- Too risky for production

**Alternative:** Could use curl/spawn for HTTPS if needed

---

### V8 Platform Removal (-1-2MB) — REJECTED

**Why rejected:**
- Breaks worker threads
- Breaks async context tracking
- Too many dependencies

---

### UPX Compression (-50% size) — REJECTED

**Why rejected:**
- 2.7x memory overhead
- Slower startup (decompression)
- Compatibility issues on some platforms

---

## 🏗️ Build Configuration

**Complete configure flags:**

```bash
./configure \
  --ninja \
  --v8-lite-mode \
  --with-intl=none \
  --disable-single-executable-application \
  --without-npm \
  --without-corepack \
  --without-inspector \
  --without-amaro \
  --without-sqlite \
  --without-node-snapshot \
  --without-node-code-cache \
  --v8-disable-object-print \
  --without-node-options \
  --enable-lto \
  --dest-cpu=arm64
```

**Key flags explained:**
- `--ninja`: Use Ninja build system (faster)
- `--v8-lite-mode`: Remove JIT tiers (-23MB)
- `--with-intl=none`: Remove ICU (-8MB)
- `--disable-single-executable-application`: Remove SEA (-2MB)
- `--enable-lto`: Link-time optimization (smaller, faster)
- `--without-*`: Remove optional features we don't need

---

## 📈 Size Progression

```
Step 0: Unconfigured Node.js v24
  └─ 102MB (with debug symbols)

Step 1: Configure with size-optimized flags
  └─ 60MB (-42MB, configured build)

Step 2: macOS native strip -x
  └─ 38MB (-22MB, basic symbol removal)

Step 3: GNU strip --strip-all
  └─ 35MB (-3MB, aggressive symbol removal)

Final: 35MB total (66% smaller than baseline)
```

---

## 🔬 Language-Specific Optimizations

### JavaScript/TypeScript
- **V8 Lite Mode**: Removes JIT compiler tiers
- **Impact**: 10-20% slower execution, 23MB smaller
- **Trade-off**: Acceptable for CLI workload (I/O bound)

### C/C++ (Node.js Core)
- **LTO (Link-Time Optimization)**: Whole-program optimization
- **Function/Data Sections**: Better dead code elimination
- **Strip**: Removes all debug symbols

### WASM
- **Liftoff Compiler**: Still available in Lite mode
- **Impact**: No WASM performance degradation
- **Use case**: onnxruntime WASM for NLP features

---

## 🎯 Per-Platform Optimizations

### macOS (ARM64)
```
Specific optimizations:
- GNU strip (3MB better than native)
- Code signing required
- Ninja builds (faster on M1/M2)

Final size: ~35MB
```

### Linux (x64/ARM64)
```
Specific optimizations:
- Native strip --strip-all
- No code signing needed
- Ninja builds

Final size: ~35MB
```

### Windows (x64)
```
Specific optimizations:
- Windows-specific patches (abseil duplicate symbols)
- MSVC strip
- Link-time optimization

Final size: ~38MB (slightly larger due to platform)
```

---

## 🧪 Verification

**Post-optimization checks:**

```bash
# 1. Binary size
du -h node
# Expected: ~35MB

# 2. Version check
./node --version
# Expected: v24.x.x

# 3. WASM support
./node -e "console.log(typeof WebAssembly)"
# Expected: object

# 4. Basic execution
./node -e "console.log('Hello')"
# Expected: Hello

# 5. Module loading
./node -e "require('fs').readFileSync"
# Expected: [Function: readFileSync]
```

---

## 📚 References

- [V8 Lite Mode Documentation](https://v8.dev/blog/v8-lite)
- [Node.js Configure Options](https://github.com/nodejs/node/blob/main/configure.py)
- [GNU Binutils](https://www.gnu.org/software/binutils/)
- [Ninja Build System](https://ninja-build.org/)

---

## 💡 Future Optimization Opportunities

### P0 (Performance, Not Size)
- Parallel Brotli compression (50-70% faster builds)
- Incremental compression cache (80-90% faster rebuilds)
- Resume from checkpoint (avoid full rebuilds on failure)

### P1 (Size, Risky)
- Custom V8 snapshot (2-5MB, complex)
- Dead code elimination in Node core (1-3MB, fragile)
- ICU subsetting (restore some i18n, 2-4MB)

### P2 (Future Research)
- LLVM LTO with custom passes
- Profile-guided optimization (PGO)
- Alternative compression (zstd, lz4)

---

**See [patches.md](./patches.md) for all applied patches and [performance.md](./performance.md) for benchmark results.**
