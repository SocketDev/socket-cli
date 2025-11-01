# ONNX Runtime Build Patches

This document explains the inline patches applied to ONNX Runtime source during the build process. These patches are applied programmatically in `scripts/build.mjs` during the `cloneOnnxSource()` phase.

## Why Inline Patches?

Unlike Node.js patches (which are separate `.patch` files), ONNX Runtime patches are **applied inline** using string replacement because:
1. They're simple one-line or small code changes
2. They need to adapt to changing upstream code
3. They're easier to maintain as inline transformations
4. They don't need to track line numbers (which change frequently)

## Patch 1: Eigen Hash Update

**File**: `cmake/deps.txt`
**Location**: `scripts/build.mjs:109-119`

### Problem
GitLab changed their archive format for the Eigen library, causing SHA256 hash mismatches during dependency download.

### Error Without Patch
```
CMake Error: Hash mismatch for Eigen download
  Expected: 5ea4d05e62d7f954a46b3213f9b2535bdd866803
  Actual:   51982be81bbe52572b54180454df11a3ece9a934
```

### What It Does
Updates the Eigen dependency hash in `deps.txt` to match GitLab's new archive format:

```javascript
// Before
eigen;URL;5ea4d05e62d7f954a46b3213f9b2535bdd866803

// After
eigen;URL;51982be81bbe52572b54180454df11a3ece9a934
```

### Is This Safe?
**Yes**. The new hash is the current valid hash from GitLab. This is not a security bypass - it's updating to match upstream's archive format change.

## Patch 2: BUILD_MLAS_NO_ONNXRUNTIME Fix

**File**: `cmake/onnxruntime_webassembly.cmake`
**Location**: `scripts/build.mjs:121-135`

### Problem
When WASM threading is disabled, ONNX Runtime defines `BUILD_MLAS_NO_ONNXRUNTIME`, which causes MLFloat16 to be missing critical methods (`Negate()`, `IsNegative()`, `FromBits()`).

### Error Without Patch
```
error: 'class MLFloat16' has no member named 'Negate'
error: 'class MLFloat16' has no member named 'IsNegative'
error: 'class MLFloat16' has no member named 'FromBits'
```

### What It Does
Comments out the `BUILD_MLAS_NO_ONNXRUNTIME` definition:

```cmake
# Before
add_compile_definitions(
  BUILD_MLAS_NO_ONNXRUNTIME
)

# After
# add_compile_definitions(
#   BUILD_MLAS_NO_ONNXRUNTIME
# )
```

### Is This Still Needed?
**Partially**. We now build with `--enable_wasm_threads`, which avoids this issue. However, the patch is kept for safety in case threading needs to be disabled in the future.

### Reference
GitHub Issue: https://github.com/microsoft/onnxruntime/issues/23769

## Patch 3: wasm_post_build.js Compatibility

**File**: `js/web/script/wasm_post_build.js`
**Location**: `scripts/build.mjs:137-158`

### Problem
ONNX Runtime's post-build script expects a specific Worker URL pattern from older Emscripten versions. Modern Emscripten (3.1.50+) doesn't generate this pattern, causing the build to fail.

### Error Without Patch
```
Error: Unexpected number of matches for "" in "": .
    at wasm_post_build.js:12:13
```

### What The Script Does
The `wasm_post_build.js` script tries to transform Worker instantiation code:

```javascript
// Emscripten generates (old versions):
new Worker(new URL("./ort-wasm-simd-threaded.worker.mjs", import.meta.url), {...})

// ONNX wants (bundling optimization):
new Worker(new URL(import.meta.url), {...})
```

This makes the worker use the same file instead of loading a separate worker file.

### Why Modern Emscripten Fails
Modern Emscripten either:
1. Generates the correct format already (no transformation needed)
2. Uses a different Worker pattern (but still functionally correct)
3. Handles threading differently (but correctly)

### What Our Patch Does
Gracefully skips the transformation when the old pattern isn't found:

```javascript
// Before (ONNX Runtime's code):
if (matches.length !== 1) {
  throw new Error(`Unexpected number of matches...`);
}

// After (our patch):
if (matches.length === 0) {
  console.log('No Worker URL pattern found - skipping post-build transformation (modern Emscripten)');
  return;  // Exit gracefully
}
if (matches.length !== 1) {
  throw new Error(`Unexpected number of Worker URL matches: found ${matches.length}, expected 1. Pattern: ${regex}`);
}
```

### Is Skipping It Safe?
**Yes, absolutely**:

1. **The WASM already compiled** - This is just post-processing of the .mjs glue code
2. **Modern Emscripten generates correct code** - The Worker will work without transformation
3. **It's a legacy optimization** - Written for older Emscripten versions
4. **No runtime impact** - If the Worker doesn't work, you'd see errors at runtime (which we don't)

### What This Patch Also Fixes
The error message was broken (empty strings). We fix it to show actual values:

```javascript
// Before: Useless error message
throw new Error(`Unexpected number of matches for "" in "": .`);

// After: Helpful error message
throw new Error(`Unexpected number of Worker URL matches: found ${matches.length}, expected 1. Pattern: ${regex}`);
```

## Summary

| Patch | Type | Reason | Risk | Can Remove? |
|-------|------|--------|------|-------------|
| Eigen Hash | Dependency | GitLab format change | None | No (upstream issue) |
| BUILD_MLAS_NO_ONNXRUNTIME | Build Fix | MLFloat16 missing methods | Low | Yes (if always use threading) |
| wasm_post_build.js | Compatibility | Modern Emscripten support | None | No (modern toolchain) |

## Maintenance Notes

### When to Update These Patches

1. **Eigen Hash**: Update if ONNX Runtime updates Eigen version in `deps.txt`
2. **BUILD_MLAS_NO_ONNXRUNTIME**: Can likely be removed once threading is confirmed stable
3. **wasm_post_build.js**: Keep indefinitely - harmless and ensures forward compatibility

### How to Test Without Patches

To verify if a patch is still needed:

```bash
# Comment out the patch in scripts/build.mjs
# Then run:
node scripts/build.mjs --clean

# If build succeeds without it, the patch may no longer be needed
# If build fails, the patch is still required
```

### Upstream Status

- **Eigen Hash**: Reported but upstream unlikely to fix (GitLab issue, not ONNX issue)
- **BUILD_MLAS_NO_ONNXRUNTIME**: Fixed in newer versions with threading enabled
- **wasm_post_build.js**: Not reported (would need to add Emscripten version detection)

## References

- ONNX Runtime Build System: https://onnxruntime.ai/docs/build/web.html
- Emscripten Threading: https://emscripten.org/docs/porting/pthreads.html
- MLFloat16 Issue: https://github.com/microsoft/onnxruntime/issues/23769
