# Node.js Build Quick Reference

Quick reference guide for building custom Node.js binaries with yao-pkg and Socket patches.

## 🚀 Common Commands

### Build Commands

```bash
# Normal build (incremental if possible)
node scripts/build-yao-pkg-node.mjs

# Clean build (start from scratch)
node scripts/build-yao-pkg-node.mjs --clean

# Build and verify
node scripts/build-yao-pkg-node.mjs --verify

# Clean build with verification
node scripts/build-yao-pkg-node.mjs --clean --verify
```

### Verification Commands

```bash
# Verify the build
node scripts/verify-node-build.mjs

# Integration test (build → pkg → execute)
node scripts/test-yao-pkg-integration.mjs
```

### Maintenance Commands

```bash
# Remove build artifacts (clean slate)
rm -rf .custom-node-build/

# Remove just the Node.js source (keep patches)
rm -rf .custom-node-build/node-yao-pkg/

# Clear pkg cache
rm -rf ~/.pkg-cache/
```

## 🔍 Troubleshooting

### Build Fails: "Tool not available"

**Error**:
```
❌ strip is NOT available
❌ codesign is NOT available
```

**Fix**:
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Verify tools are available
which strip    # Should return: /usr/bin/strip
which codesign # Should return: /usr/bin/codesign
```

### Build Fails: "Patch validation failed"

**Error**:
```
❌ INVALID: Patch supports v24.9.0-v24.9.5 but you're using v24.10.0
```

**Fix**:
```bash
# Option 1: Remove incompatible patch (system will use direct modifications)
rm build/patches/socket/fix-v8-include-paths-*.patch

# Option 2: Use correct Node.js version
# Edit scripts/build-yao-pkg-node.mjs and change NODE_VERSION
```

### Build Fails: "V8 include path not found"

**Error**:
```
fatal error: 'base/iterator.h' file not found
```

**Fix**:
```bash
# This happens when wrong patches are applied to v24.10.0+
# Clean and rebuild (will use direct modifications)
node scripts/build-yao-pkg-node.mjs --clean
```

**Why**: v24.10.0+ has correct V8 include paths. Don't apply v24.9.0 V8 patches!

### Build Fails: "Download failed"

**Error**:
```
❌ Download Failed
Failed to download yao-pkg patch after 3 attempts
```

**Fix**:
```bash
# Check internet connection
curl -I https://github.com

# Manually download patch
curl -L https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.v24.10.0.cpp.patch \
  -o .custom-node-build/patches/node.v24.10.0.cpp.patch

# Retry build
node scripts/build-yao-pkg-node.mjs
```

### Build Fails: "Corrupted patch file"

**Error**:
```
❌ Corrupted Patch File
Downloaded patch file is corrupted: File contains HTML
```

**Fix**:
```bash
# System will auto-retry, but if persistent:
rm .custom-node-build/patches/node.v24.10.0.cpp.patch
node scripts/build-yao-pkg-node.mjs
```

### Build Fails: During compilation

**Error**:
```
❌ Build Failed
Node.js compilation failed. See build log for details.
```

**Fix**:
```bash
# Check last 50 lines of log (shown automatically)
# Full log:
less .custom-node-build/build.log

# Common issues:
# 1. Out of memory - Close other applications
# 2. Disk full - Free up space (need 5GB)
# 3. Compiler error - Reinstall Xcode tools

# Try clean build
node scripts/build-yao-pkg-node.mjs --clean
```

### Build Succeeds but Binary Doesn't Work

**Symptoms**:
```bash
./out/Release/node --version
# No output or segfault
```

**Fix**:
```bash
# Verify build
node scripts/verify-node-build.mjs

# If verification fails, rebuild
node scripts/build-yao-pkg-node.mjs --clean --verify

# Check if Socket modifications were applied correctly
grep -r "const isSea = () => true" .custom-node-build/node-yao-pkg/lib/sea.js
# Should return a match
```

### pkg Build Fails: "Binary not found"

**Error**:
```
Error: Binary not found in cache
```

**Fix**:
```bash
# Check if binary exists in cache
ls -lh ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64*

# If missing, build was incomplete
node scripts/build-yao-pkg-node.mjs --clean --verify

# Verify it's in cache after build
ls -lh ~/.pkg-cache/v3.5/
```

### pkg Build Fails: "SEA not detected"

**Symptoms**: pkg binary runs but can't load embedded code

**Fix**:
```bash
# Verify SEA modification was applied
node scripts/verify-node-build.mjs

# Check the source file
cat .custom-node-build/node-yao-pkg/lib/sea.js | grep "isSea = () => true"

# If not found, rebuild with clean flag
node scripts/build-yao-pkg-node.mjs --clean
```

## 📊 Build Time Estimates

Based on CPU cores:

| CPU Cores | Estimated Time | Range |
|-----------|----------------|-------|
| 2 cores   | ~90 minutes    | 75-110 min |
| 4 cores   | ~75 minutes    | 60-90 min |
| 8 cores   | ~38 minutes    | 30-46 min |
| 10 cores  | ~30 minutes    | 24-36 min |
| 12+ cores | ~25 minutes    | 20-30 min |

**Note**: First build is slower (downloads source). Subsequent builds are faster if source exists.

## 🔐 Pre-flight Check Requirements

Before building, ensure you have:

- ✅ **Tools**: git, curl, patch, make, strip, codesign (macOS)
- ✅ **Disk Space**: At least 5GB free
- ✅ **Python**: Version 3.6 or later
- ✅ **Compiler**: clang++, g++, or c++
- ✅ **Network**: Can reach GitHub and yao-pkg
- ✅ **Node.js Version**: Valid git tag exists

**Check**: Script runs these checks automatically before building.

## 📁 Important Directories

```
socket-cli/
├── .custom-node-build/          # Build workspace
│   ├── node-yao-pkg/           # Node.js source (cloned)
│   ├── patches/                # Downloaded patches
│   │   └── node.v24.10.0.cpp.patch
│   ├── build.log               # Build output log
│   └── .build-checkpoint       # Progress checkpoint
│
├── build/patches/socket/        # Socket-specific patches
│   ├── enable-sea-*.patch      # SEA detection patches
│   └── fix-v8-*.patch          # V8 include patches (v24.9.x only!)
│
├── scripts/
│   ├── build-yao-pkg-node.mjs  # Main build script
│   ├── verify-node-build.mjs   # Verification script
│   └── lib/
│       ├── build-helpers.mjs   # Helper functions
│       └── patch-validator.mjs # Patch validation
│
└── docs/
    ├── node-patch-metadata.md  # Patch format guide
    └── technical/
        └── build-system-improvements.md
```

## 🎯 Build Flow Summary

```
1. Pre-flight Checks (30 seconds)
   ✅ Tools, disk space, Python, compiler, network

2. Download yao-pkg Patch (if needed)
   ✅ Auto-retry up to 3 times
   ✅ Integrity verification

3. Validate yao-pkg Patch
   ✅ Version compatibility
   ✅ Content analysis

4. Clone/Reset Node.js Source (2-5 minutes)
   ✅ Git clone --depth 1

5. Validate Socket Patches
   ✅ Metadata parsing
   ✅ Version compatibility
   ✅ Conflict detection

6. Apply Patches
   ✅ yao-pkg patches (V8 bytecode, PKG bootstrap)
   ✅ Socket patches (SEA detection)

7. Verify Modifications
   ✅ Check SEA override applied
   ✅ Check V8 includes correct

8. Configure (2-5 minutes)
   ✅ Optimization flags

9. Build (30-90 minutes depending on CPU)
   ✅ Make with parallel jobs
   ✅ Log to build.log

10. Smoke Test
    ✅ --version check
    ✅ Execute JavaScript

11. Strip Debug Symbols (82MB → 54MB)
    ✅ Smoke test after strip

12. Code Sign (macOS ARM64 only)
    ✅ Ad-hoc signing

13. Install to Cache
    ✅ Copy to ~/.pkg-cache/

14. Verify Build
    ✅ 8-point verification (if --verify)

15. Success! 🎉
```

## 💡 Tips & Best Practices

### 1. Always Use --clean for Major Changes

```bash
# After updating Node.js version
# After modifying patches
# After build system changes
node scripts/build-yao-pkg-node.mjs --clean
```

### 2. Check Build Logs on Failure

```bash
# Last 50 lines shown automatically
# Full log:
tail -f .custom-node-build/build.log  # Monitor live
less .custom-node-build/build.log     # Browse full log
grep -i error .custom-node-build/build.log  # Find errors
```

### 3. Verify After Building

```bash
# Quick verification
node scripts/verify-node-build.mjs

# Full integration test
node scripts/test-yao-pkg-integration.mjs
```

### 4. Keep Cache Clean

```bash
# Old builds accumulate, clean periodically:
rm -rf ~/.pkg-cache/v3.5/built-v24.9.*  # Remove old versions
```

### 5. Use Existing Source When Possible

```bash
# First build: Downloads source (slow)
node scripts/build-yao-pkg-node.mjs

# Subsequent builds: Reuses source (faster)
node scripts/build-yao-pkg-node.mjs

# Only use --clean when necessary
```

## 🔬 Advanced Debugging

### Enable Debug Output

```bash
# More verbose output (if implemented)
DEBUG=1 node scripts/build-yao-pkg-node.mjs
```

### Check Binary Dependencies

```bash
# macOS: Check what libraries binary needs
otool -L ~/.pkg-cache/v3.5/built-v24.10.0-darwin-arm64

# Linux: Check library dependencies
ldd ~/.pkg-cache/v3.5/built-v24.10.0-linux-x64
```

### Inspect Patch Metadata

```bash
# See what a patch claims to support
head -20 build/patches/socket/enable-sea-*.patch

# Should show:
# @node-versions: v24.10.0+
# @description: Enable SEA detection for pkg binaries
```

### Test Binary in Isolation

```bash
# Test the built binary directly
cd .custom-node-build/node-yao-pkg
./out/Release/node --version
./out/Release/node -e "console.log('Hello')"

# Test SEA detection (should always be true)
./out/Release/node -e "console.log(require('node:sea').isSea())"
# Expected output: true
```

## 📚 Related Documentation

- **[Build System Improvements](./technical/build-system-improvements.md)** - Complete technical overview
- **[Patch Metadata Format](./node-patch-metadata.md)** - How to write patches with metadata
- **[Build Improvements 2025-10-15](./technical/build-improvements-2025-10-15.md)** - Latest enhancements including test integration

## 🆘 Getting Help

### Check Documentation First

1. This quick reference
2. Build system improvements doc
3. Patch metadata guide

### Common Error Patterns

- **"file not found"** → Check V8 patches (v24.10.0+ doesn't need them)
- **"tool not available"** → Install Xcode Command Line Tools
- **"version X doesn't exist"** → Check NODE_VERSION is valid git tag
- **"out of memory"** → Close applications, free up RAM
- **"disk full"** → Free up 5GB+ space

### Still Stuck?

1. Check build log: `.custom-node-build/build.log`
2. Try clean build: `node scripts/build-yao-pkg-node.mjs --clean`
3. Verify environment: Script runs pre-flight checks automatically
4. Check patch compatibility: Remove patches, let system use direct modifications

---

**Last Updated**: 2025-10-15
**Applies To**: Socket CLI v1.0.80+
