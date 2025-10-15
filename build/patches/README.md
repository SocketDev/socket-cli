# Socket CLI Node.js Patches

This directory contains Socket-specific patches applied on top of yao-pkg patches when building custom Node.js binaries for executable packaging.

## 🎯 The Big Picture: Why We Need This

### The Problem
Node.js executables created by standard tools are **80+ MB** and include unnecessary features. We need:
- Smaller binaries (~50MB instead of 80+MB)
- V8 bytecode compilation (compile without shipping source)
- PKG compatibility (yao-pkg is the only pkg that supports Node.js v24+)
- SEA detection (Single Executable Application detection must work)

### The Solution
We build a **custom Node.js binary** that:
1. **Removes bloat**: No npm, corepack, inspector, amaro, sqlite (~30MB savings)
2. **Adds PKG support**: yao-pkg patches enable bytecode compilation
3. **Fixes bugs**: Socket patches fix V8 include paths and SEA detection
4. **Optimizes size**: Strip debug symbols (82MB → 54MB)
5. **Works with pkg**: Install to cache so pkg uses our custom binary

## 📐 Architecture Overview

### Three-Layer System

```
┌────────────────────────────────────────────────────────┐
│  Layer 3: Socket CLI Application                       │
│  - Your JavaScript code                                 │
│  - Bundled and compiled to V8 bytecode                  │
│  - Embedded into executable                             │
└────────────────────────────────────────────────────────┘
                          ▼
┌────────────────────────────────────────────────────────┐
│  Layer 2: Socket Patches                                │
│  - Fix V8 include paths (build fix)                     │
│  - Override isSea() to return true (SEA detection)      │
└────────────────────────────────────────────────────────┘
                          ▼
┌────────────────────────────────────────────────────────┐
│  Layer 1: yao-pkg Patches                               │
│  - V8 bytecode compilation API                          │
│  - PKG bootstrap system                                 │
│  - BAKERY placeholder system                            │
└────────────────────────────────────────────────────────┘
                          ▼
┌────────────────────────────────────────────────────────┐
│  Layer 0: Node.js v24.10.0 Source                       │
│  - Upstream Node.js codebase                            │
│  - Configured with size optimizations                   │
│  - Stripped of debug symbols                            │
└────────────────────────────────────────────────────────┘
```

## 🔄 Complete Build → Test Flow

### Phase 1: Pre-Flight (Safety Checks)

**Purpose**: Verify environment is ready before starting expensive build

```
┌─────────────────────────────────────────────────┐
│  1. Check Required Tools                        │
│     - git, curl, patch, make, strip, codesign   │
│     - Exit early if missing (save time)         │
├─────────────────────────────────────────────────┤
│  2. Check yao-pkg Patch Availability            │
│     - HEAD request to GitHub                    │
│     - Fail fast if patch doesn't exist          │
│     - Provide helpful error with alternatives   │
├─────────────────────────────────────────────────┤
│  3. Check Disk Space (TODO)                     │
│     - Build requires ~5GB free space            │
│     - Warn if low disk space                    │
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- Detecting missing tools after 30 minutes of building is frustrating
- Network issues should be caught before cloning 2GB of Node.js source
- Disk space issues can corrupt builds

### Phase 2: Setup (Preparation)

**Purpose**: Get clean Node.js source and patches

```
┌─────────────────────────────────────────────────┐
│  1. Download yao-pkg Patch                       │
│     - Curl from GitHub raw URL                   │
│     - Cache locally (.custom-node-build/patches)│
│     - Reuse on subsequent builds                 │
├─────────────────────────────────────────────────┤
│  2. Clone Node.js Source (or Reset)              │
│     - Clone: New build (no directory exists)     │
│     - Reset: Re-build (directory exists)         │
│     - Clean: --clean flag (force fresh start)    │
│     - Why reset: Ensures clean state             │
├─────────────────────────────────────────────────┤
│  3. Git Clean                                    │
│     - Remove untracked files                     │
│     - Remove modified files                      │
│     - Reset to exact tag state                   │
│     - Why: Previous builds may have left artifacts│
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- Dirty source trees cause unpredictable build failures
- Cached patches speed up rebuilds
- Reset allows rebuilds without re-downloading 2GB

### Phase 3: Patching (Modifications)

**Purpose**: Apply yao-pkg patches, then Socket patches

```
┌─────────────────────────────────────────────────┐
│  1. Apply yao-pkg Patch                          │
│     - Adds V8 bytecode compilation API           │
│     - Adds lib/internal/bootstrap/pkg.js         │
│     - Modifies src/node_main.cc for PKG_EXECPATH│
│     - Adds BAKERY placeholder system             │
│     - CRITICAL: Without this, pkg won't work     │
├─────────────────────────────────────────────────┤
│  2. Find Socket Patches                          │
│     - Try: socket-node-modifications-v24-10-0.patch│
│     - Try: individual patches for v24.10.0       │
│     - Try: generic v24 patches                   │
│     - Fallback: Apply modifications directly     │
│     - Why flexible: Handles version bumps gracefully│
├─────────────────────────────────────────────────┤
│  3. Apply Socket Patches (or Direct Mods)        │
│     - Fix V8 include paths (build would fail)    │
│     - Override isSea() → true (SEA detection)    │
│     - CRITICAL: Without this, SEA check fails    │
├─────────────────────────────────────────────────┤
│  4. VERIFY Modifications                         │
│     - Check lib/sea.js has isSea override        │
│     - Check V8 includes are fixed                │
│     - FAIL BUILD if verification fails           │
│     - Why: Catch issues early before 30min build │
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- **Patch order is critical**: yao-pkg THEN Socket (Socket patches expect yao-pkg base)
- **Verification prevents wasted builds**: 30 minutes of building just to discover patches didn't apply
- **Flexible fallback**: Version bumps don't break the build

**Deep Dive: Why Each Socket Patch Matters**

1. **V8 Include Path Fix** (`fix-v8-include-paths-*.patch`):
   ```cpp
   // BEFORE (Node.js v24.9.0+ has this bug):
   #include "src/base/hashmap.h"  // ← WRONG! Fails to compile

   // AFTER (Socket patch fixes it):
   #include "base/hashmap.h"       // ← CORRECT! Compiles successfully
   ```
   - **Why it's broken**: Node.js v24.9.0+ introduced incorrect include paths
   - **Impact if not fixed**: Build fails with "file not found" errors
   - **Affects**: 5 V8 header files

2. **SEA Detection Override** (`enable-sea-for-pkg-binaries-*.patch`):
   ```javascript
   // BEFORE (stock Node.js):
   const { isSea, getAsset, getAssetKeys } = internalBinding('sea');
   // isSea() returns FALSE for pkg binaries (wrong!)

   // AFTER (Socket patch):
   const isSea = () => true;  // ← Override to always return true
   const { getAsset, getAssetKeys } = internalBinding('sea');
   // isSea() returns TRUE for pkg binaries (correct!)
   ```
   - **Why it's needed**: PKG binaries ARE SEAs but native binding doesn't detect them
   - **Impact if not fixed**: `require('node:sea').isSea()` returns false
   - **Affects**: SEA-aware code won't recognize pkg binaries as SEAs

### Phase 4: Configuration (Build Settings)

**Purpose**: Configure Node.js build with size optimizations

```
┌─────────────────────────────────────────────────┐
│  ./configure Flags                               │
│                                                  │
│  ✅ KEEP:                                        │
│     - V8 full compiler (bytecode compilation)    │
│     - V8 JIT (performance)                       │
│     - WASM support                               │
│     - SSL/crypto (https support)                 │
│     - libuv (async I/O)                          │
│                                                  │
│  ❌ REMOVE (saves ~30MB):                        │
│     --without-npm         (~10MB)                │
│     --without-corepack    (~5MB)                 │
│     --without-inspector   (~8MB)                 │
│     --without-amaro       (~2MB)                 │
│     --without-sqlite      (~5MB)                 │
│                                                  │
│  🌍 MINIMIZE:                                    │
│     --with-intl=small-icu (~5MB savings)         │
│     (English-only ICU data)                      │
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- **npm**: Not needed in executable (Socket CLI doesn't use it)
- **inspector**: Debugging not needed in production executables
- **ICU**: Full ICU is 30MB, small-icu is 5MB (English is enough)
- **Result**: 82MB → 54MB after stripping

### Phase 5: Build (Compilation)

**Purpose**: Compile Node.js with all optimizations

```
┌─────────────────────────────────────────────────┐
│  make -j<CPU_COUNT>                              │
│                                                  │
│  Time: 30-60 minutes                             │
│  CPUs: All cores (parallel compilation)          │
│  Output: out/Release/node (82MB with debug symbols)│
│                                                  │
│  What's happening:                               │
│  1. C++ compilation (Node.js + V8 + libuv)       │
│  2. JavaScript compilation (lib/*.js)            │
│  3. Linking all components together              │
│  4. Embedding ICU data                           │
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- **Parallel build**: Uses all CPU cores for faster compilation
- **Debug symbols**: Included by default (we'll strip them)
- **Binary size**: 82MB before optimization

### Phase 6: Post-Processing (Optimization)

**Purpose**: Optimize binary and verify correctness

```
┌─────────────────────────────────────────────────┐
│  1. Test Binary (smoke test)                     │
│     - Run: node --version                        │
│     - Run: node -e "console.log('test')"         │
│     - Why: Catch build failures early            │
├─────────────────────────────────────────────────┤
│  2. Strip Debug Symbols                          │
│     - Command: strip out/Release/node            │
│     - Before: 82MB                               │
│     - After: 54MB                                │
│     - Saves: 28MB (~34% size reduction)          │
│     - Trade-off: Lose debug symbols, keep functionality│
├─────────────────────────────────────────────────┤
│  3. Verify Size                                  │
│     - Expected: 50-60MB                          │
│     - Warn if: <50MB (missing features?)         │
│     - Warn if: >70MB (strip failed?)             │
├─────────────────────────────────────────────────┤
│  4. Code Sign (macOS ARM64 only)                 │
│     - Command: codesign --sign - --force         │
│     - Why: macOS requires signing for ARM64      │
│     - Without: Binary won't run on ARM Macs      │
├─────────────────────────────────────────────────┤
│  5. Install to pkg Cache                         │
│     - Copy to: ~/.pkg-cache/v3.5/built-v24.10.0-*│
│     - Name format: built-<version>-<os>-<arch>[-signed]│
│     - Why: pkg looks here for custom binaries    │
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- **Stripping**: Removes debugging info we don't need (34% smaller!)
- **Signing**: macOS ARM64 won't run unsigned binaries
- **Cache location**: pkg has specific naming convention and location expectations

### Phase 7: Verification (Correctness)

**Purpose**: Verify the build is correct BEFORE using it

```
┌─────────────────────────────────────────────────┐
│  scripts/verify-node-build.mjs                   │
│                                                  │
│  ✅ Verification Checks:                         │
│     1. Binary exists in cache                    │
│     2. lib/sea.js modification applied           │
│     3. V8 include paths fixed                    │
│     4. Binary size reasonable (50-60MB)          │
│     5. Binary functional (--version works)       │
│     6. Binary can execute JS                     │
│     7. SEA detection returns true                │
│     8. macOS signature valid (if applicable)     │
│                                                  │
│  Why every check matters:                        │
│  - Socket mods not applied? Binary won't work with pkg│
│  - V8 not fixed? Build should have failed        │
│  - SEA returns false? PKG executables broken     │
│  - Size wrong? Something went wrong in config    │
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- **Catch bugs before pkg**: Finding issues AFTER creating pkg executables wastes time
- **Verify critical features**: SEA detection is make-or-break for pkg
- **Size checks**: Wrong size indicates configuration problems

### Phase 8: Integration Testing (End-to-End)

**Purpose**: Test the entire build → pkg → execute flow

```
┌─────────────────────────────────────────────────┐
│  scripts/test-yao-pkg-integration.mjs            │
│                                                  │
│  🧪 Integration Tests:                           │
│     1. Build Socket CLI (pnpm run build)         │
│     2. Create test package.json + test-cli.js    │
│     3. Run pkg to create executable              │
│     4. Execute the binary                        │
│     5. Verify SEA detection works                │
│     6. Verify file system access                 │
│     7. Verify module loading                     │
│     8. Clean up test artifacts                   │
│                                                  │
│  Why end-to-end:                                 │
│  - Unit tests pass, integration fails? This catches it│
│  - Tests the ACTUAL use case (build + pkg + run)│
│  - Verifies pkg uses our custom binary           │
│  - Confirms SEA detection in real executable     │
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- **Real-world scenario**: Tests exactly how Socket CLI will use the binary
- **Catches integration bugs**: Unit tests can't catch pkg-specific issues
- **Automated**: Can run in CI/CD to prevent regressions

## 🛡️ Error Recovery & Resilience

### Automatic Fallback System

The build script has **4 layers of fallback** for Socket patches:

```
┌─────────────────────────────────────────────────┐
│  Tier 1: Versioned Combined Patch               │
│  socket-node-modifications-v24-10-0.patch        │
│  ├─ Exists? Use it ✅                            │
│  └─ Missing? Try Tier 2 ⬇                       │
├─────────────────────────────────────────────────┤
│  Tier 2: Individual Version Patches             │
│  fix-v8-include-paths-v24-10-0.patch             │
│  enable-sea-for-pkg-binaries-v24-10-0.patch      │
│  ├─ Exists? Use them ✅                          │
│  └─ Missing? Try Tier 3 ⬇                       │
├─────────────────────────────────────────────────┤
│  Tier 3: Generic v24 Patches                     │
│  fix-v8-include-paths-v24.patch                  │
│  enable-sea-for-pkg-binaries-v24.patch           │
│  ├─ Exists? Use them ✅                          │
│  └─ Missing? Try Tier 4 ⬇                       │
├─────────────────────────────────────────────────┤
│  Tier 4: Direct Modification Application        │
│  Apply changes directly to source files          │
│  ├─ Always works ✅                              │
│  └─ No patches needed                            │
└─────────────────────────────────────────────────┘
```

**Why This Matters**:
- **Version bump resilience**: v24.10.0 → v24.11.0 still works (uses Tier 3 or 4)
- **No patch maintenance needed**: Tier 4 always works
- **Optimization available**: Can generate patches later for reproducibility
- **Never fails**: Build always succeeds regardless of patch availability

### Common Failure Scenarios & Recovery

#### Scenario 1: yao-pkg Patch Not Available

```
❌ Problem: User sets NODE_VERSION = 'v24.11.0' but yao-pkg hasn't released patches yet

✅ Recovery: Build script detects this BEFORE cloning (saves 30+ minutes)
           Provides clear error message:
           - Link to yao-pkg patches page
           - Suggests using previous version
           - Explains how to update NODE_VERSION
```

#### Scenario 2: Socket Patches Fail to Apply

```
❌ Problem: Socket patches exist but don't apply (Node.js source changed)

✅ Recovery: Build script automatically falls back to direct modification
           - Catches patch failure
           - Applies modifications directly
           - Suggests regenerating patches
           - Build continues successfully
```

#### Scenario 3: Modifications Not Applied

```
❌ Problem: Patches applied but modifications not actually in source
          (corrupted patch, wrong files, etc.)

✅ Recovery: Verification step catches this BEFORE 30-minute build
           - Checks lib/sea.js has isSea override
           - Checks V8 includes fixed
           - Fails with clear error
           - Suggests: --clean flag to rebuild
```

#### Scenario 4: Build Artifacts from Previous Build

```
❌ Problem: Previous build failed midway, left partial artifacts

✅ Recovery: Git reset + clean at start of build
           - Resets to exact tag state
           - Removes all untracked files
           - Or use --clean flag for nuclear option
```

#### Scenario 5: Binary Size Wrong

```
❌ Problem: Binary is 80MB instead of 54MB (stripping failed?)

✅ Recovery: Post-build verification detects size issues
           - Warns if outside 50-60MB range
           - Suggests checking strip command
           - Suggests checking configure flags
           - Binary still works, just larger
```

#### Scenario 6: SEA Detection Returns False

```
❌ Problem: Binary built successfully but isSea() returns false

✅ Recovery: Verification script tests SEA detection
           - Runs test script in binary
           - Checks isSea() return value
           - FAILS if false (critical bug)
           - Provides instructions to rebuild with --clean
```

## 📜 Scripts Reference

### Build Scripts

#### `scripts/build-yao-pkg-node.mjs`
**Purpose**: Main build script - creates custom Node.js binary

**Usage**:
```bash
# Normal build
node scripts/build-yao-pkg-node.mjs

# Force fresh start (clean + rebuild)
node scripts/build-yao-pkg-node.mjs --clean

# Build and verify
node scripts/build-yao-pkg-node.mjs --verify
```

**What It Does**:
1. Pre-flight checks (tools, patch availability)
2. Downloads/clones Node.js source
3. Applies yao-pkg + Socket patches
4. Verifies modifications applied
5. Configures with optimizations
6. Builds (30-60 minutes)
7. Strips debug symbols
8. Signs (macOS only)
9. Installs to pkg cache

**When To Use**:
- First time setup
- Node.js version bump
- Build failed and need fresh start
- Patches updated

---

#### `scripts/verify-node-build.mjs`
**Purpose**: Comprehensive verification of built binary

**Usage**:
```bash
# Verify current build
node scripts/verify-node-build.mjs

# Verify specific version
node scripts/verify-node-build.mjs --node-version=v24.10.0
```

**What It Does**:
1. Checks binary exists in cache
2. Verifies lib/sea.js modification
3. Verifies V8 include fixes
4. Tests binary functionality
5. Tests SEA detection
6. Checks binary size
7. Verifies signature (macOS)

**When To Use**:
- After building
- Before creating pkg executables
- Debugging issues
- CI/CD pipeline

---

#### `scripts/test-yao-pkg-integration.mjs`
**Purpose**: End-to-end integration test with pkg

**Usage**:
```bash
# Run full integration test
node scripts/test-yao-pkg-integration.mjs

# Test specific version
node scripts/test-yao-pkg-integration.mjs --node-version=v24.10.0
```

**What It Does**:
1. Builds Socket CLI
2. Creates test package
3. Runs pkg to create executable
4. Executes and tests the binary
5. Verifies SEA detection
6. Cleans up test artifacts

**When To Use**:
- Before releasing
- After major changes
- CI/CD pipeline
- Debugging pkg issues

---

### Patch Generation Scripts

#### `scripts/regenerate-node-patches.mjs`
**Purpose**: Generate Socket patches for new Node.js versions

**Usage**:
```bash
# Generate patches for v24.11.0
node scripts/regenerate-node-patches.mjs --version=v24.11.0
```

**What It Does**:
1. Clones fresh Node.js source
2. Applies yao-pkg patches
3. Commits baseline
4. Applies Socket modifications
5. Generates patch from diff
6. Saves to build/patches/socket/

**When To Use**:
- Node.js version bumps
- Want reproducible builds
- Sharing patches with team
- CI/CD needs consistent patches

---

#### `scripts/apply-socket-mods.mjs`
**Purpose**: Apply Socket modifications directly (for testing)

**Usage**:
```bash
# Apply mods to existing Node.js source
node scripts/apply-socket-mods.mjs
```

**What It Does**:
1. Modifies lib/sea.js
2. Fixes V8 include paths
3. Does NOT commit or create patches

**When To Use**:
- Testing modifications
- Debugging patch issues
- Manual patch creation

## 🚀 Common Workflows

### Workflow 1: First Time Setup

```bash
# 1. Build custom Node.js binary
node scripts/build-yao-pkg-node.mjs

# Expected output:
#  - Binary built: .custom-node-build/node-yao-pkg/out/Release/node
#  - Installed to: ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64-signed
#  - Time: 30-60 minutes

# 2. Verify build
node scripts/verify-node-build.mjs

# Expected output:
#  ✅ All verifications passed

# 3. Build Socket CLI
pnpm run build

# 4. Create executable
pnpm exec pkg .

# 5. Test executable
./pkg-binaries/socket-macos-arm64 --version
```

---

### Workflow 2: Node.js Version Bump (e.g., v24.10.0 → v24.11.0)

```bash
# 1. Update NODE_VERSION in build script
vim scripts/build-yao-pkg-node.mjs
# Change: const NODE_VERSION = 'v24.11.0'

# 2. Check if yao-pkg patch exists
curl -I https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.v24.11.0.cpp.patch

# 3. If patch exists, build normally
node scripts/build-yao-pkg-node.mjs
# (Uses fallback if Socket patches missing)

# 4. If build succeeds, generate Socket patches for future use
node scripts/regenerate-node-patches.mjs --version=v24.11.0

# 5. Commit new patches
git add build/patches/socket/*v24-11-0.patch
git commit -m "Add patches for Node.js v24.11.0"
```

---

### Workflow 3: Build Failed / Something Went Wrong

```bash
# 1. Try clean rebuild first
node scripts/build-yao-pkg-node.mjs --clean

# If that doesn't work:

# 2. Manually clean everything
rm -rf .custom-node-build/node-yao-pkg
rm -rf ~/.pkg-cache/v3.5/built-v24.10.0-*

# 3. Rebuild from scratch
node scripts/build-yao-pkg-node.mjs

# 4. If still failing, check build log for specific error
#    Common issues:
#    - Missing tools: brew install git curl
#    - yao-pkg patch missing: Use previous Node version
#    - Disk space: Free up 5GB+
#    - Network issues: Check internet connection
```

---

### Workflow 4: Socket Patches Outdated

```bash
# Situation: Socket patches exist but fail to apply

# Build script automatically handles this:
#  1. Tries to apply patches
#  2. Catches failure
#  3. Falls back to direct modifications
#  4. Build succeeds

# After build succeeds:

# Regenerate patches for this version
node scripts/regenerate-node-patches.mjs --version=v24.10.0

# Commit updated patches
git add build/patches/socket/*v24-10-0.patch
git commit -m "Update patches for Node.js v24.10.0"
```

---

### Workflow 5: CI/CD Pipeline

```yaml
# Example GitHub Actions workflow

name: Build Custom Node.js

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: macos-latest  # Or ubuntu-latest, windows-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2

      - name: Build custom Node.js binary
        run: node scripts/build-yao-pkg-node.mjs
        timeout-minutes: 90

      - name: Verify build
        run: node scripts/verify-node-build.mjs

      - name: Run integration tests
        run: node scripts/test-yao-pkg-integration.mjs

      - name: Upload binary artifact
        uses: actions/upload-artifact@v4
        with:
          name: node-binary-${{ runner.os }}-${{ runner.arch }}
          path: ~/.pkg-cache/v3.5/built-v24.10.0-*
```

## 🎯 Quick Reference

### Build Commands
```bash
# First time build
node scripts/build-yao-pkg-node.mjs

# Clean rebuild
node scripts/build-yao-pkg-node.mjs --clean

# Build + verify
node scripts/build-yao-pkg-node.mjs --verify
```

### Verification Commands
```bash
# Verify build correctness
node scripts/verify-node-build.mjs

# Full integration test
node scripts/test-yao-pkg-integration.mjs
```

### Patch Commands
```bash
# Generate patches for new version
node scripts/regenerate-node-patches.mjs --version=v24.11.0

# Apply modifications directly (testing)
node scripts/apply-socket-mods.mjs
```

### File Locations
```bash
# Node.js source
.custom-node-build/node-yao-pkg/

# Built binary
.custom-node-build/node-yao-pkg/out/Release/node

# pkg cache
~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64-signed

# Socket patches
build/patches/socket/

# yao-pkg patch cache
.custom-node-build/patches/node.v24.10.0.cpp.patch
```

## Complete Build Process

### End-to-End Flow (Detailed)

## Patch Layers

### Layer 1: yao-pkg Patches (Upstream)

**Source**: `https://github.com/yao-pkg/pkg-fetch/tree/main/patches`

**Purpose**: Enable V8 bytecode compilation and PKG executable embedding

**Key Modifications**:
1. **V8 Bytecode API** - `EnableCompilationForSourcelessUse()`, `FixSourcelessScript()`
2. **V8 Snapshot Serialization** - Pointer compression fixes
3. **PKG Bootstrap** - `lib/internal/bootstrap/pkg.js` (NEW FILE)
4. **Environment Detection** - `PKG_EXECPATH` checking in `src/node_main.cc`
5. **BAKERY System** - Placeholder for node flags + entry point
6. **Bootstrap Routing** - Use `internal/bootstrap/pkg` instead of `internal/main/run_main_module`

### Layer 2: Socket Patches (Custom)

**Location**: `/build/patches/socket/`

#### Patch 1: V8 Include Path Fixes

**Files**: `fix-v8-include-paths-v24-10-0.patch`

**Problem**: Node.js v24.9.0+ has incorrect V8 include paths causing build failures

**Solution**: Remove erroneous `src/` prefix from V8 internal includes

```diff
-#include "src/base/hashmap.h"
+#include "base/hashmap.h"
```

**Affected Files**:
- `deps/v8/src/ast/ast-value-factory.h`
- `deps/v8/src/heap/new-spaces-inl.h`
- `deps/v8/src/heap/factory-inl.h`
- `deps/v8/src/objects/js-objects-inl.h`
- `deps/v8/src/heap/cppgc/heap-page.h`

#### Patch 2: SEA Detection for PKG Binaries

**Files**: `enable-sea-for-pkg-binaries-v24-10-0.patch`

**Problem**: `require('node:sea').isSea()` returns false for pkg binaries

**Solution**: Override `isSea()` to always return `true`

```diff
-const { isSea, getAsset, getAssetKeys } = internalBinding('sea');
+const isSea = () => true;
+const { getAsset, getAssetKeys } = internalBinding('sea');
```

**Why**: PKG binaries are functionally SEAs - this ensures consistent detection.

## Automatic Patch Management

### Build Script Intelligence

The build script (`scripts/build-yao-pkg-node.mjs`) automatically handles patches:

```javascript
// 1. Try versioned patches first
socket-node-modifications-v24-10-0.patch

// 2. Fall back to individual patches
fix-v8-include-paths-v24-10-0.patch
enable-sea-for-pkg-binaries-v24-10-0.patch

// 3. Fall back to generic v24 patches
fix-v8-include-paths-v24.patch
enable-sea-for-pkg-binaries-v24.patch

// 4. If no patches found → Apply modifications directly to source
```

**No manual intervention needed** - the build works regardless of patch availability!

## Regenerating Patches for New Node Versions

### When Node.js Version Bumps (e.g., v24.9.0 → v24.11.0)

**Option 1: Let Build Apply Directly** (Recommended)
```bash
# Just run the build - it will apply modifications directly
node scripts/build-yao-pkg-node.mjs
```

**Option 2: Generate Patches Explicitly**
```bash
# Generate versioned patches
node scripts/regenerate-node-patches.mjs --version=v24.11.0

# This creates:
# - build/patches/socket/socket-node-modifications-v24-11-0.patch
```

### Manual Patch Creation (Advanced)

If you need to create patches manually:

```bash
# 1. Build Node with yao-pkg patches
node scripts/build-yao-pkg-node.mjs

# 2. Navigate to Node source
cd .custom-node-build/node-yao-pkg

# 3. Create a commit for baseline
git add -A
git commit -m "Baseline after yao-pkg patches"

# 4. Make your modifications
vim lib/sea.js
vim deps/v8/src/ast/ast-value-factory.h

# 5. Generate patch
git diff > ../../build/patches/socket/my-custom-patch-v24-10-0.patch

# 6. Update build script SOCKET_PATCHES array (if not using auto-discovery)
```

## Verification

### Build Flags Verification

```bash
# Check configure flags were applied
cat .custom-node-build/node-yao-pkg/config.gypi | grep -E "(npm|inspector|intl)"

# Expected:
# node_install_npm: false
# node_use_sqlite: false
# v8_enable_inspector: 0
```

### Patch Verification

```bash
# Check patches were applied
cd .custom-node-build/node-yao-pkg
git diff HEAD | head -50

# Should show:
# - V8 include path changes
# - lib/sea.js isSea modification
# - yao-pkg BAKERY system
# - PKG bootstrap file
```

### Binary Verification

```bash
# Check binary size and signature
ls -lh ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64-signed
# Expected: ~54MB (after stripping)

# Check PKG placeholder exists
strings ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64-signed | grep -i "pkg"
# Should show: BAKERY, PKG_EXECPATH, internal/bootstrap/pkg

# Check signature (macOS)
codesign -dv ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64-signed
```

## Configuration

### Build Settings

All size optimizations are in `scripts/build-yao-pkg-node.mjs`:

```javascript
'--with-intl=small-icu',      // English-only ICU (~5MB savings)
'--without-npm',              // Remove npm (~10MB savings)
'--without-corepack',         // Remove corepack
'--without-inspector',        // Remove V8 inspector/debugger
'--without-amaro',            // Remove amaro
'--without-sqlite',           // Remove SQLite
```

### PKG Configuration

PKG settings are in `pkg.json`:

```json
{
  "node": "/path/to/.custom-node-build/node-yao-pkg/out/Release/node",
  "targets": ["node24-macos-arm64"],
  "outputPath": "pkg-binaries"
}
```

## Troubleshooting

### Build Fails: "patch failed to apply"

**Cause**: Patch format mismatch or Node.js source changed

**Solution**:
```bash
# Let build apply modifications directly
node scripts/build-yao-pkg-node.mjs
# It will auto-apply without patches

# Then regenerate patches if needed
node scripts/regenerate-node-patches.mjs --version=v24.10.0
```

### Build Fails: "Cannot find yao-pkg patch"

**Cause**: yao-pkg hasn't released patches for this Node version yet

**Solution**: Use previous Node version or wait for yao-pkg update

### Binary Too Large (>60MB)

**Check**:
1. Debug symbols stripped? (script does this automatically)
2. Configure flags applied? (check config.gypi)
3. ICU data included? (should be small-icu)

### pkg Can't Find Binary

**Check**:
```bash
# Verify cache location
ls ~/.pkg-cache/v3.5/built-v24*

# Verify pkg.json points to right path
cat pkg.json | grep "node"
```

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `build-yao-pkg-node.mjs` | **Main build script** - Builds complete patched Node binary |
| `regenerate-node-patches.mjs` | Generate patches for new Node versions |
| `apply-socket-mods.mjs` | Apply Socket modifications to Node source |
| `generate-node-patches.mjs` | Legacy patch generator (use regenerate instead) |

## Development Workflow

### Standard Development
```bash
# Just build - patches auto-applied or mods applied directly
node scripts/build-yao-pkg-node.mjs

# Build CLI
pnpm run build

# Create pkg binary
pnpm exec pkg .
```

### Adding New Modifications

1. **Modify `applySocketModificationsDirectly()` in `build-yao-pkg-node.mjs`**
2. **Test the build**
3. **Optionally generate patches** (for reproducibility)

### Version Bump Workflow

```bash
# 1. Update NODE_VERSION in build-yao-pkg-node.mjs
vim scripts/build-yao-pkg-node.mjs  # Change to v24.11.0

# 2. Build (auto-applies mods)
node scripts/build-yao-pkg-node.mjs

# 3. If build succeeds, optionally generate patches
node scripts/regenerate-node-patches.mjs --version=v24.11.0

# 4. Commit new patches
git add build/patches/socket/*v24-11-0.patch
git commit -m "Add patches for Node.js v24.11.0"
```

## Why This Design?

1. **Zero Manual Intervention**: Build works with or without patches
2. **Version Resilient**: Automatically handles version bumps
3. **Reproducible**: Patches capture exact changes for CI/CD
4. **Maintainable**: Modifications defined in code, not scattered patches
5. **Debuggable**: Can see what's being applied in build logs

## Related Documentation

- [yao-pkg Documentation](https://github.com/yao-pkg/pkg)
- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html)
- [V8 Bytecode](https://v8.dev/blog/understanding-ecmascript-part-4)
