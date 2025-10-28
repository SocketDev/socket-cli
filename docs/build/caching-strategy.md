# Build Caching Strategy

## Overview

Socket CLI uses a **unified, consistent caching strategy** across all build workflows to minimize build times and preserve compilation progress between CI runs.

## Strategy Decision Tree

```
Does the build compile C/C++?
├─ YES → Is it native or WASM?
│   ├─ Native Build (smol)
│   │   ├─ Use ccache for per-object-file caching
│   │   └─ Use build directory cache for CMake state
│   └─ WASM Build (Yoga, ONNX)
│       └─ Use build directory cache only
│           (Emscripten doesn't integrate well with ccache)
└─ NO (AI Models, SEA)
    └─ Cache final output only
```

## Caching Patterns

### Pattern 1: Native C++ Builds (smol)

**Use case**: Compiling Node.js from source to native binaries

**Strategy**: ccache + build directory cache

```yaml
- name: Setup ccache (Linux/macOS)
  uses: hendrikmuhs/ccache-action@...
  with:
    key: build-${{ platform }}-${{ arch }}-${{ hash }}
    max-size: 2G

- name: Restore build cache
  uses: actions/cache@...
  with:
    path: |
      packages/node-smol-builder/build
      packages/node-smol-builder/.node-source
    key: node-smol-build-${{ platform }}-${{ arch }}-${{ hash }}
    restore-keys: |
      node-smol-build-${{ platform }}-${{ arch }}-

- name: Restore binary cache
  uses: actions/cache@...
  with:
    path: packages/node-smol-builder/dist/socket-smol-*
    key: node-smol-${{ platform }}-${{ arch }}-${{ hash }}
```

**Why both ccache and build directory?**
- **ccache**: Caches individual compiled object files (very granular)
- **build directory**: Caches CMake configuration, dependency tracking, build state
- **Together**: Maximum build speed and failure recovery

**Benefits:**
- First build: ~60-90 minutes
- Cached build: ~5-10 minutes (ccache hits on all objects)
- Partial failure: Can resume from cached state

### Pattern 2: WASM C++ Builds (Yoga, ONNX)

**Use case**: Compiling C++ to WebAssembly with Emscripten

**Strategy**: Build directory cache only (no ccache)

```yaml
- name: Restore output cache
  uses: actions/cache@...
  with:
    path: packages/yoga-layout/build/wasm
    key: yoga-wasm-${{ hash }}

- name: Restore build cache
  uses: actions/cache@...
  with:
    path: |
      packages/yoga-layout/build
      packages/yoga-layout/.yoga-source
    key: yoga-build-${{ hash }}
    restore-keys: |
      yoga-build-
```

**Why no ccache?**
- Emscripten uses custom LLVM-based compilation
- ccache integration is unreliable with Emscripten
- Build directory caching achieves the same goal more simply

**Benefits:**
- Yoga: ~2-3 minutes → ~1 minute (already fast)
- ONNX: ~30-40 minutes → ~2-3 minutes (on failure recovery)
- Simpler, more reliable than ccache integration

### Pattern 3: Non-C++ Builds (AI Models, SEA)

**Use case**: Python model conversion, JavaScript bundling

**Strategy**: Output cache only

```yaml
- name: Restore output cache
  uses: actions/cache@...
  with:
    path: packages/socketbin-cli-ai/dist
    key: ai-models-${{ hash }}
```

**Why output only?**
- No compilation involved (Python scripts, JS bundling)
- Intermediate state doesn't speed up rebuilds
- Simple caching is sufficient

## Cache Key Strategy

All caches use **content-based hashing** for invalidation:

```bash
HASH=$(find <paths> -type f \( -name "pattern" \) | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)
```

**Key format:**
```
<workflow>-<type>-<platform>-<arch>-<content-hash>
```

**Examples:**
- `node-smol-build-linux-x64-abc123def456` (smol build cache)
- `yoga-build-abc123def456` (Yoga build cache)
- `onnx-runtime-build-abc123def456` (ONNX build cache)

**Restore keys** provide prefix matching for partial cache hits:
```yaml
restore-keys: |
  node-smol-build-linux-x64-
  node-smol-build-linux-
```

## Cache Layers

### Layer 1: Build Dependencies
- **Cached**: Python, Ninja, Emscripten SDK
- **Purpose**: Avoid re-downloading build tools
- **Duration**: Stable across builds

### Layer 2: Source Code
- **Cached**: Cloned repositories (`.node-source/`, `.yoga-source/`, `.onnx-source/`)
- **Purpose**: Skip git clone operations
- **Duration**: Stable unless version changes

### Layer 3: Intermediate Build
- **Cached**: CMake cache, compiled objects (`build/`)
- **Purpose**: Resume compilation from previous state
- **Duration**: Invalidated on source/patch changes

### Layer 4: Compilation Cache (Native only)
- **Cached**: Per-object-file compilation results (ccache)
- **Purpose**: Instant reuse of unchanged compiled objects
- **Duration**: Survives source changes (object-level granularity)

### Layer 5: Final Output
- **Cached**: Blessed artifacts (`dist/`)
- **Purpose**: Skip entire build if nothing changed
- **Duration**: Exact hash match required

## Build Time Comparison

| Build | First Run | Cached | With Intermediate Cache |
|-------|-----------|--------|------------------------|
| Smol (native) | 60-90 min | 5-10 min | 10-15 min (partial) |
| ONNX (WASM) | 30-40 min | instant | 2-3 min (on failure) |
| Yoga (WASM) | 2-3 min | instant | 1-2 min (partial) |
| AI Models | 10-15 min | instant | N/A (no compilation) |
| SEA | 5-10 min | instant | N/A (just bundling) |

## Implementation Checklist

When adding a new build workflow:

- [ ] Determine if it compiles C/C++ (Pattern 1 or 2)
- [ ] If native C++: Add ccache setup
- [ ] Add build directory cache for all C++ builds
- [ ] Add output cache for final artifacts
- [ ] Use content-based hash for cache keys
- [ ] Add restore-keys for prefix matching
- [ ] Test cache hit/miss scenarios
- [ ] Document expected build times

## Troubleshooting

### Cache not restoring
- Check cache key hash generation includes all relevant files
- Verify restore-keys provide fallback options
- Check GitHub Actions cache size limits (10 GB per repo)

### Build slower with cache
- Check ccache statistics (`ccache -s`)
- Verify build directory cache includes CMake cache
- Check for cache corruption (force rebuild with `--force`)

### Cache too large
- Adjust ccache max-size (default: 2G)
- Clean build directories of unnecessary artifacts
- Consider excluding large intermediate files

## Related Documentation

- [Build/Dist Structure](build-dist-structure.md) - Archive and promotion workflow
- [Node.js Patches](../../build/patches/socket/README.md) - Patch management
- [GitHub Actions Caching](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
