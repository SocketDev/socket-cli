# Socket CLI yao-pkg Build Support

## Overview

Socket CLI supports building standalone executables using [@yao-pkg/pkg](https://github.com/yao-pkg/pkg), a fork of the original pkg tool that provides better Node.js bytecode compilation support and maintains compatibility with modern Node.js versions.

## Why yao-pkg?

yao-pkg is used for Socket CLI binary distribution because it:

1. **Supports Node.js 24.x** - The original pkg tool was discontinued at Node 18
2. **Handles WASM modules** - Required for yoga-layout (Ink's layout engine)
3. **Better bytecode compilation** - Improved V8 bytecode support for performance
4. **CommonJS compatibility** - Works with dependencies that use top-level await

## Key Implementation Details

### yoga-layout WASM Integration

The primary challenge for pkg binary support is yoga-layout's use of WebAssembly with top-level await. Socket CLI solves this by:

1. **Patching yoga-layout** - Adds a synchronous entry point (`dist/src/sync.js`)
2. **Inlining WASM data** - Base64 WASM is embedded directly in the patch
3. **Synchronous WebAssembly APIs** - Uses `new WebAssembly.Module()` and `new WebAssembly.Instance()`
4. **Proxy-based initialization** - Handles async emscripten setup without top-level await

See `patches/yoga-layout.patch` for implementation details.

#### The Problem

yoga-layout (Ink's layout engine) uses top-level await to load its WASM module:

```javascript
// Original yoga-layout code
export default await loadYogaWasm()  // ❌ Fails in pkg
```

This breaks in pkg binaries because:
- pkg's virtual filesystem can't handle asynchronous WASM loading at startup
- Top-level await blocks CommonJS module loading
- File I/O is restricted in pkg's `/snapshot/` virtual filesystem

#### The Solution

The patch creates a synchronous entry point (`dist/src/sync.js`, ~93 lines):

```javascript
import loadYogaImpl from '../binaries/yoga-wasm-base64-esm.js'
import wrapAssembly from './wrapAssembly.js'

// Inlined base64 WASM data (~70KB) to avoid file reading at runtime
const base64 = `AGFzbQEAAAABugM3YAF/AGACf38AYAF/AX9gA39/fwBgAn98...`

// Decode base64 → Uint8Array
const wasmBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

// Synchronous WebAssembly compilation
const module = new WebAssembly.Module(wasmBytes)
const instance = new WebAssembly.Instance(module, importObject)

// Wrap and export
export default wrapAssembly(instance)
```

**Key techniques:**

1. **Inline WASM**: Embeds entire WASM binary (~70KB) as base64 string in JavaScript
2. **Synchronous APIs**: Uses `new WebAssembly.Module()` instead of `WebAssembly.instantiate()`
3. **No file I/O**: WASM data is in code, not separate `.wasm` file
4. **Proxy pattern**: Handles emscripten initialization without async/await

#### Why This Works with pkg

- **No async loading**: Synchronous WebAssembly APIs work at module initialization
- **No file reads**: WASM data is embedded in JS, not in `/snapshot/` virtual filesystem
- **CommonJS compatible**: No top-level await blocking module loading
- **Deterministic**: Loads same way every time, no timing issues

**Result**: Socket CLI's Ink UI (powered by yoga-layout) works perfectly in pkg binaries!

### pkg Binary Detection

The CLI detects when running as a pkg binary via `process.pkg` and adjusts execution:

```javascript
if (typeof process.pkg !== 'undefined') {
  // Running as pkg binary - directly execute CLI
  require(constants.distCliPath)
} else {
  // Normal Node - spawn with custom flags
  spawn(node, [...flags, cliPath])
}
```

This is necessary because pkg binaries cannot spawn themselves with custom Node flags.

## What the yao-pkg Patches Do

The yao-pkg patches modify Node.js v24.9.0 to enable bytecode-only execution:

### 1. V8 Bytecode API (`deps/v8/src/api/api.cc`)
Adds three new V8 API methods:
- `V8::EnableCompilationForSourcelessUse()` - Forces eager compilation with deterministic bytecode
- `V8::DisableCompilationForSourcelessUse()` - Restores lazy compilation
- `V8::FixSourcelessScript()` - Strips source code from compiled scripts

**How it works:** JavaScript is compiled to V8 bytecode, source is discarded, binary runs bytecode directly.

### 2. VM Context Sourceless Mode (`src/node_contextify.cc`)
Extends `vm.Script` with `sourceless` parameter:
```javascript
new vm.Script(code, { sourceless: true, produceCachedData: true })
// Compiles to bytecode, strips source, returns bytecode as cachedData
```

### 3. pkg Bootstrap (`lib/internal/bootstrap/pkg.js`)
Adds `process.pkg` object with:
- `process.pkg.entrypoint` - Main entry point path
- `process.pkg.defaultEntrypoint` - Fallback entry
- Virtual filesystem APIs for accessing bundled files

### 4. Module Loader (`lib/internal/modules/cjs/loader.js`)
Patches `require()` to:
- Load modules from pkg virtual filesystem
- Execute bytecode-compiled modules directly
- Handle `process.pkg.entrypoint` as main module

### 5. Argument Reordering (`src/node_main.cc`)
Custom `reorder()` function processes arguments for pkg binaries:
- Loads "baked" arguments from BAKERY section (embedded in binary)
- Injects `PKG_DUMMY_ENTRYPOINT` if not running via pkg runtime
- Controlled by `PKG_EXECPATH` environment variable

**Important:** When testing the patched Node binary directly (not in pkg), set:
```bash
export PKG_EXECPATH=PKG_INVOKE_NODEJS
```
Otherwise CLI flags like `--version` will be treated as module names.

## Complete Build Process from Scratch

This section provides a comprehensive step-by-step guide to building Socket CLI pkg binaries from scratch, including downloading Node.js source, applying patches, and building everything.

### Prerequisites

Before starting, ensure you have:

- **macOS** (13.5+), **Linux**, or **Windows** with WSL
- **Xcode Command Line Tools** (macOS): `xcode-select --install`
- **Build tools**: `gcc`, `g++`, `make`, `python3`
- **Node.js** v22+ (for building Socket CLI, not for yao-pkg)
- **pnpm** v9+
- **Git**
- **~10GB free disk space** for Node.js source and build artifacts
- **30-60 minutes** for initial Node.js build

### Step 1: Download Node.js v24.9.0 Source

yao-pkg supports specific Node.js versions. We use **v24.9.0** (exact version with tested patches).

```bash
# Create build directory structure
mkdir -p .custom-node-build
cd .custom-node-build

# Clone Node.js v24.9.0 source
git clone --depth 1 --branch v24.9.0 https://github.com/nodejs/node.git node-yao-pkg
cd node-yao-pkg

# Verify we have the correct version
git describe --tags
# Output: v24.9.0
```

**Why v24.9.0?**
- Latest version with tested yao-pkg patches
- Long-term support (LTS) planned
- Good V8 bytecode compilation support

### Step 2: Download yao-pkg Patch

yao-pkg provides official patches for Node.js that enable bytecode compilation.

```bash
# Create patches directory (if not exists)
mkdir -p .custom-node-build/patches

# Download official yao-pkg patch for v24.9.0
curl -sL https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.v24.9.0.cpp.patch \
  -o .custom-node-build/patches/node.v24.9.0.cpp.patch

# Verify patch was downloaded
ls -lh .custom-node-build/patches/node.v24.9.0.cpp.patch
# Should show ~15-20KB file
```

**What this patch does:**
- Adds V8 bytecode API methods (`V8::EnableCompilationForSourcelessUse()`)
- Extends `vm.Script` with `sourceless` parameter
- Adds `process.pkg` object for pkg runtime
- Patches module loader to load from virtual filesystem
- Adds argument reordering for pkg binaries

See "What the yao-pkg Patches Do" section for detailed explanation.

### Step 3: Apply yao-pkg Patch

Apply the official yao-pkg patch to Node.js source:

```bash
cd .custom-node-build/node-yao-pkg

# Reset to clean state (if re-applying)
git reset --hard v24.9.0
git clean -fdx

# Apply the patch
patch -p1 < ../patches/node.v24.9.0.cpp.patch

# Verify patch applied successfully
git status
# Should show modified files in deps/v8/, lib/, src/
```

**Expected changes:**
- `deps/v8/src/api/api.cc` - V8 bytecode API
- `src/node_contextify.cc` - VM sourceless mode
- `lib/internal/bootstrap/pkg.js` - pkg runtime (new file)
- `lib/internal/modules/cjs/loader.js` - Module loader
- `src/node_main.cc` - Argument reordering

If patch fails, ensure you're on exact v24.9.0 tag and have clean working directory.

### Step 4: Apply Custom Optimizations (Optional)

Socket CLI applies additional optimizations to reduce binary size. This step is **optional** but recommended for production builds.

**Option A: Use build script (Recommended)**

The `scripts/build-yao-pkg-node.sh` script applies optimizations automatically:

```bash
cd /Users/jdalton/projects/socket-cli
pnpm run build:yao-pkg:node
```

This script handles everything:
- Downloads Node.js source
- Applies yao-pkg patches
- Configures with size optimizations
- Builds with all CPU cores
- Signs binary (macOS)

**Option B: Manual configuration**

If building manually, configure with these optimization flags:

```bash
cd .custom-node-build/node-yao-pkg

./configure \
  --with-intl=small-icu \
  --without-npm \
  --without-corepack \
  --without-inspector \
  --without-amaro \
  --without-sqlite
```

**What these flags do:**
- `--with-intl=small-icu` - English-only internationalization (~30MB saved vs full-icu)
- `--without-npm` - Remove npm binary (~5MB saved)
- `--without-corepack` - Remove corepack (~1MB saved)
- `--without-inspector` - Remove debugger/inspector (~2-3MB saved)
- `--without-amaro` - Remove TypeScript runtime utils (~500KB saved)
- `--without-sqlite` - Remove SQLite/Web Storage API (~1-2MB saved)

**What we KEEP:**
- ✅ V8 full compiler (required for bytecode compilation)
- ✅ WASM support (required for yoga-layout/Ink)
- ✅ JIT optimization (Turbofan, Sparkplug, Maglev)
- ✅ SSL/TLS support (required for Socket API)
- ✅ small-icu (English-only internationalization)

**Result:** ~82-85MB binary (vs ~95MB unoptimized)

### Step 5: Build Node.js

Build the patched Node.js binary:

```bash
cd .custom-node-build/node-yao-pkg

# Build with all CPU cores (30-60 minutes)
make -j$(sysctl -n hw.ncpu)  # macOS
# OR
make -j$(nproc)               # Linux

# Wait for build to complete...
# On Apple M1/M2: ~30-40 minutes
# On Intel/AMD: ~45-60 minutes
```

**Expected output:**
```
  LINK(host) /path/to/out/Release/node
clang++: warning: ...
```

**Build artifacts:**
- Binary: `.custom-node-build/node-yao-pkg/out/Release/node`
- Size: ~82-85MB (optimized) or ~95MB (unoptimized)

### Step 6: Verify Build

Test the patched Node.js binary:

```bash
cd .custom-node-build/node-yao-pkg

# IMPORTANT: Set PKG_EXECPATH to avoid dummy entrypoint injection
export PKG_EXECPATH=PKG_INVOKE_NODEJS

# Test basic functionality
./out/Release/node --version
# Output: v24.9.0

./out/Release/node -e "console.log('Hello from custom Node!')"
# Output: Hello from custom Node!

# Test V8 bytecode API (yao-pkg feature)
./out/Release/node -e "console.log(typeof process.versions.modules)"
# Output: string

# Check binary size
ls -lh out/Release/node
# Output: ~82-85MB
```

**Troubleshooting:**

If you get "Cannot find module '--version'" error:
```bash
# The PKG_EXECPATH env var wasn't set
export PKG_EXECPATH=PKG_INVOKE_NODEJS
./out/Release/node --version  # Should work now
```

See "Troubleshooting > Testing the Patched Node Binary" for details.

### Step 7: Sign Binary (macOS Only)

On macOS, sign the binary to avoid Gatekeeper warnings:

```bash
cd .custom-node-build/node-yao-pkg

# Ad-hoc sign (sufficient for local use)
codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime out/Release/node

# Verify signature
codesign -dv out/Release/node
# Output: Signature size=...
```

For App Store or distribution, use your Developer ID certificate instead of `-`.

### Step 8: Configure pkg.json

Update `pkg.json` to point to your custom Node binary:

```bash
cd /Users/jdalton/projects/socket-cli
```

Edit `pkg.json`:

```json
{
  "node": "/Users/jdalton/projects/socket-cli/.custom-node-build/node-yao-pkg/out/Release/node",
  "targets": [
    "node24-macos-arm64"
  ],
  "outputPath": "pkg-binaries",
  "assets": [
    "dist/**/*",
    "requirements.json",
    "translations.json",
    "shadow-bin/**/*"
  ],
  "scripts": {
    "node_modules/.pnpm/yoga-layout@3.2.1_patch_hash=.../dist/binaries/yoga-wasm-base64-esm.js":
      "node_modules/.pnpm_patches/yoga-layout@3.2.1/dist/binaries/yoga-wasm-base64-esm.js",
    "node_modules/.pnpm/yoga-layout@3.2.1_patch_hash=.../dist/src/sync.js":
      "node_modules/.pnpm_patches/yoga-layout@3.2.1/dist/src/sync.js",
    "node_modules/.pnpm/yoga-layout@3.2.1_patch_hash=.../dist/src/wrapAssembly.js":
      "node_modules/.pnpm_patches/yoga-layout@3.2.1/dist/src/wrapAssembly.js"
  }
}
```

**Important fields:**
- `node`: Absolute path to your custom patched Node binary
- `targets`: Platform combinations to build (start with one, add more later)
- `scripts`: yoga-layout WASM files (must be from patched version in `.pnpm_patches/`)

### Step 9: Build Socket CLI Distribution

Build the rollup distribution:

```bash
cd /Users/jdalton/projects/socket-cli

# Build distribution files
pnpm run build:dist:src

# Verify dist/ directory was created
ls -lh dist/
# Should show: cli.js, constants.js, utils.js, vendor.js, etc.
```

This creates the CommonJS distribution in `dist/` that pkg will bundle.

### Step 10: Build pkg Binary

Finally, build the pkg executable:

```bash
cd /Users/jdalton/projects/socket-cli

# Build pkg binary with yao-pkg
pnpm run build:yao-pkg

# Or run pkg directly:
pnpm exec pkg .
```

**Build process:**
1. Reads `pkg.json` configuration
2. Uses custom Node binary from `pkg.json` → `node` path
3. Bundles `dist/` files as bytecode
4. Copies assets to `/snapshot/` virtual filesystem
5. Embeds everything into single executable
6. Outputs to `pkg-binaries/` directory

**Expected output:**
```
> pkg .
> Targets: node24-macos-arm64
> Building...
> Done in 45s
```

**Output location:**
- `pkg-binaries/socket-macos-arm64` (~90-110MB)

### Step 11: Test pkg Binary

Test the generated executable:

```bash
cd pkg-binaries

# Test basic commands
./socket-macos-arm64 --version
# Output: socket/<version>

./socket-macos-arm64 --help
# Output: Socket CLI help text

# Test real functionality
./socket-macos-arm64 scan create --help
./socket-macos-arm64 info --help

# Test with actual project
cd /path/to/test-project
/path/to/pkg-binaries/socket-macos-arm64 scan create --json
```

**What to verify:**
- ✅ CLI starts without errors
- ✅ Help text displays correctly
- ✅ Ink UI renders properly (if using interactive commands)
- ✅ Socket API calls work
- ✅ yoga-layout WASM loads correctly

### Step 12: Cross-Platform Builds (Optional)

To build for multiple platforms, you need custom Node binaries for each target.

**Option A: GitHub Actions (Recommended)**

Use CI/CD to build on each platform:

```yaml
# .github/workflows/build-pkg.yml
strategy:
  matrix:
    include:
      - os: macos-13
        target: node24-macos-arm64
      - os: macos-13
        target: node24-macos-x64
      - os: ubuntu-latest
        target: node24-linux-x64
      - os: windows-latest
        target: node24-win-x64
```

**Option B: Local cross-compilation (Advanced)**

Build Node.js on each target platform, copy binaries, update `pkg.json`:

```json
{
  "nodeRange": "node24",
  "targets": [
    "node24-macos-arm64",
    "node24-macos-x64",
    "node24-linux-x64",
    "node24-win-x64"
  ]
}
```

---

## Quick Start (Using build script)

If you just want to build quickly without understanding each step:

```bash
# 1. Build custom Node.js (one-time, 30-60 minutes)
pnpm run build:yao-pkg:node

# 2. Build Socket CLI distribution
pnpm run build:dist:src

# 3. Build pkg binary
pnpm run build:yao-pkg

# Done! Binary is in pkg-binaries/
```

---

## Building Custom Node.js for yao-pkg

yao-pkg requires a patched Node.js binary to enable bytecode compilation. Build it once:

```bash
# Download the yao-pkg patch first
mkdir -p .custom-node-build/patches
curl -sL https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.v24.9.0.cpp.patch \
  -o .custom-node-build/patches/node.v24.9.0.cpp.patch

# Build the patched Node.js (30-60 minutes)
pnpm run build:yao-pkg:node
```

The script:
1. Clones Node.js v24.9.0 (exact version supported by yao-pkg)
2. Applies yao-pkg patches for bytecode compilation
3. Configures with size optimizations:
   - `--with-intl=small-icu` - English-only ICU (~30MB saved)
   - `--without-npm` - No npm (~5MB saved)
   - `--without-corepack` - No corepack (~1MB saved)
   - `--without-inspector` - No debugger (~2-3MB saved)
   - `--without-amaro` - No TypeScript utils (~500KB saved)
   - `--without-sqlite` - No SQLite/Web Storage (~1-2MB saved)
4. **Keeps:** V8 full compiler (bytecode), WASM, JIT, SSL/crypto
5. Builds with all available CPU cores (30-60 minutes)
6. Signs the binary for macOS ARM64

**Expected Binary Size:** ~80-85MB (vs ~95MB unoptimized)
**Output:** `.custom-node-build/node-yao-pkg/out/Release/node`

## Building pkg Binaries

### Quick Build (Current Platform)

Build for your current platform only:

```bash
pnpm run build:yao-pkg
```

This:
1. Builds source with rollup (`pnpm run build:dist:src`)
2. Runs `pnpm exec pkg .` using the config in `pkg.json`

### Full Build (All Platforms)

Build for all platforms (requires custom Node for each architecture):

```bash
# Edit pkg.json targets to specify platforms
pnpm run build:yao-pkg
```

Default targets in `pkg.json`:
- `node24-macos-arm64`
- `node24-macos-x64`
- `node24-linux-arm64`
- `node24-linux-x64`
- `node24-win-arm64`
- `node24-win-x64`

**Note:** Cross-platform builds require access to the target platform's patched Node binary.

## Configuration Files

### pkg.json

Main pkg configuration:

```json
{
  "node": "/path/to/.custom-node-build/node-yao-pkg/out/Release/node",
  "targets": ["node24-macos-arm64", ...],
  "outputPath": "pkg-binaries",
  "assets": ["dist/**/*", "requirements.json", "translations.json", "shadow-bin/**/*"],
  "scripts": {
    // yoga-layout WASM files from patched version
    "node_modules/.pnpm/yoga-layout@3.2.1_patch_hash=.../dist/binaries/yoga-wasm-base64-esm.js":
      "node_modules/.pnpm_patches/yoga-layout@3.2.1/dist/binaries/yoga-wasm-base64-esm.js",
    // ... other yoga-layout files
  }
}
```

Key settings:
- **node** - Path to custom yao-pkg patched Node binary
- **targets** - Platform/architecture combinations to build
- **assets** - Files to include in binary (copied to /snapshot)
- **scripts** - Files to include in binary (bundled as bytecode)

## Testing pkg Binaries

Test the built binaries:

```bash
# Built binaries are in pkg-binaries/ or root
./socket-macos --version
./socket-macos scan create --help

# Test a real scan
./socket-macos scan create --json
```

## Limitations & Considerations

1. **Binary Size** - pkg binaries are ~90-110MB (includes Node runtime + bundled code)
2. **Build Time** - Custom Node build takes 30-60 minutes (one-time)
3. **Platform Specific** - Must build custom Node for each target architecture
4. **Dynamic Requires** - Some dynamic requires may not work (see pkg warnings during build)
5. **WASM Limitations** - Only works with our patched yoga-layout approach

## Troubleshooting

### Testing the Patched Node Binary

**Error: Cannot find module '--version' or '--help':**
```bash
$ ./out/Release/node --version
Error: Cannot find module '--version'
```

**Cause:** The yao-pkg patch's `reorder()` function injects `PKG_DUMMY_ENTRYPOINT` when `PKG_EXECPATH` is not set, causing all arguments to be treated as module names.

**Fix:** Set the environment variable before testing:
```bash
export PKG_EXECPATH=PKG_INVOKE_NODEJS
./out/Release/node --version  # Now works correctly
```

This issue only affects testing the patched Node binary directly. Inside a pkg executable, the env var is set automatically.

### Build Failures

**yoga-layout WASM errors:**
```
Error: File '/**/yoga-wasm-base64-esm.js' was not included
```
- Ensure `patches/yoga-layout.patch` is applied
- Check `pkg.json` scripts section includes yoga-layout files
- Verify `pnpm-lock.yaml` shows patched version

**Missing custom Node:**
```
Error: Cannot find Node binary
```
- Run `pnpm run build:yao-pkg:node` first
- Check `pkg.json` node path points to built binary

### Runtime Errors

**Invalid character in atob():**
- yoga-layout patch may have malformed base64
- Regenerate patch: `pnpm patch-commit node_modules/.pnpm_patches/yoga-layout@3.2.1`

**Module not found:**
- Check if module is in `pkg.json` assets or scripts
- Some modules may need explicit inclusion

## Comparison with SEA

Socket CLI supports both pkg (yao-pkg) and SEA (Single Executable Application):

| Feature | yao-pkg | SEA |
|---------|---------|-----|
| Node Version | 24.x (patched) | 24.8.0+ (native) |
| Binary Size | ~90-110MB | ~60-80MB |
| Build Time | Fast (~30s) | Slower (~2-3min) |
| Custom Node | Required (one-time) | Not required |
| WASM Support | Requires patches | Native support |
| Bytecode | V8 bytecode | V8 snapshot |
| Maturity | Community fork | Official Node.js |

**Recommendation:** Use SEA for production unless you need specific pkg features.

## References

- [yao-pkg/pkg GitHub](https://github.com/yao-pkg/pkg)
- [Original pkg tool](https://github.com/vercel/pkg) (discontinued)
- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html)
- Socket CLI: `docs/SEA_PLATFORM_SUPPORT.md`
