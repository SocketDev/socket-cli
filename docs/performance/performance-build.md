# Build Performance Optimization

## Overview

Socket CLI uses esbuild for fast, reliable builds with optimal CLI startup performance. This document covers the build system architecture, optimizations, and available flags.

## Why esbuild over Rollup

### Single-pass compilation
- **Build time**: ~500ms typical (vs minutes with Rollup)
- **Hot reload**: Near-instant rebuilds in watch mode
- **Development velocity**: Faster iteration cycles

### No template literal corruption
- esbuild preserves template literals correctly
- Rollup had historical issues with string interpolation
- Critical for CLI output formatting

### Better for CLI startup time
- Optimized CommonJS output
- Minimal overhead in generated code
- Fast module initialization

### Post-build Brotli compression
- Automatic `.bz` compressed artifacts
- Quality level 11 (maximum compression)
- Typical 70-80% size reduction
- Example: 11MB → 2.5MB compressed

## Build Architecture

```
Entry point: src/cli-dispatch.mts
    ↓
esbuild bundler
    ↓
Optimizations:
  ├─ Tree shaking (unused code removal)
  ├─ Minification (optional, via --no-minify flag)
  ├─ Local package resolution (monorepo support)
  └─ Plugin system (custom resolvers)
    ↓
Output: dist/cli.js (executable CommonJS)
    ↓
Brotli compression
    ↓
Output: dist/cli.js.bz (compressed artifact)
```

## Build Optimizations

### Minification
```javascript
// Default: minify disabled for readable stack traces
minify: false

// Override for production builds:
SOCKET_CLI_NO_MINIFY=0 node scripts/build.mjs
```

### Tree-shaking
- Enabled by default
- Removes unused exports and code paths
- Significant bundle size reduction

### Local package resolution
Resolves Socket monorepo packages during build:
- `@socketsecurity/lib` → Local `socket-lib` dist
- `@socketsecurity/sdk` → Local `socket-sdk-js` dist
- `@socketsecurity/registry` → Local `socket-registry/registry` dist
- `@socketregistry/packageurl-js` → Local `socket-packageurl-js` dist

Benefits:
- No need to publish packages during development
- Instant reflection of local changes
- Consistent versioning across repos

### Build analysis
```javascript
// esbuild config includes metafile generation
metafile: true

// Outputs bundle size during build:
// ✓ Bundle size: 10.45 MB
```

## Build Flags

### `--watch`
Development mode with automatic rebuilds:
```bash
pnpm run build:watch
# or
pnpm run dev
```

Features:
- Watches source files for changes
- Rebuilds on modification
- Near-instant incremental builds
- Preserves terminal output

### `--no-minify`
Disable minification for debugging:
```bash
node scripts/build.mjs --no-minify
```

Use when:
- Debugging production issues
- Analyzing bundle contents
- Improving stack traces

### `--quiet`
Suppress build progress output:
```bash
node scripts/build.mjs --quiet
```

### `--verbose`
Show detailed build information:
```bash
node scripts/build.mjs --verbose
```

### `--sea`
Build Single Executable Application binaries:
```bash
node scripts/build.mjs --sea
```

Delegates to `scripts/build-sea.mjs` for platform-specific executables.

## Performance Characteristics

### Build times

```
Cold build (clean):           ~2-3 seconds
  ├─ Clean dist:              < 100ms
  ├─ Extract WASM/models:     ~1-2 seconds
  └─ esbuild bundle:          ~500ms

Hot rebuild (watch mode):     ~200-500ms
  └─ esbuild incremental:     ~200-500ms

Full rebuild (with SEA):      ~5-10 minutes
  ├─ CLI build:               ~2-3 seconds
  └─ Platform binaries:       ~5-10 minutes
```

### Bundle size

```
Uncompressed:  ~11 MB
  └─ Large due to bundled dependencies:
     - ONNX runtime (~3MB)
     - ML models (~2MB)
     - Ink/React (~1MB)
     - CLI dependencies (~5MB)

Compressed (brotli):  ~2.5 MB (77% reduction)
  └─ Quality 11 (maximum)
  └─ Used for distribution artifacts
```

### Startup time implications

```
Cold start:              ~150-250ms
  ├─ Node.js init:       ~50ms
  ├─ Module loading:     ~50-100ms
  └─ CLI init:           ~50-100ms

Warm start (cached):     ~80-120ms
  └─ Filesystem cache hit reduces module loading
```

Optimization impact:
- esbuild produces smaller output than Rollup
- CommonJS format loads faster than ESM in Node.js
- Single-file bundle reduces filesystem operations
- Tree-shaking removes ~30% unused code

## Build Pipeline

### Standard build
```bash
pnpm run build

Steps:
1. Clean dist directory
2. Extract MiniLM model (ML inference)
3. Extract ONNX runtime (ML execution)
4. Extract Yoga WASM (layout engine)
5. Run esbuild bundle
6. Compress with brotli
```

### Watch mode
```bash
pnpm run build:watch

Steps:
1-4. (same as standard build)
5. Run esbuild in watch mode
   └─ Skips brotli compression
   └─ Incremental rebuilds only
```

### Production build
```bash
INLINED_SOCKET_CLI_PUBLISHED_BUILD=1 pnpm run build

Additional:
- Sets production environment flags
- Includes version hash
- Optimizes for distribution
```

## Build Artifacts

```
dist/
├─ cli.js          Primary executable (11MB)
├─ cli.js.bz       Brotli compressed (2.5MB)
├─ npm-cli.js      npm wrapper
├─ npx-cli.js      npx wrapper
├─ pnpm-cli.js     pnpm wrapper
└─ yarn-cli.js     yarn wrapper
```

## Monorepo Integration

### Package resolution order
```
1. Local sibling directories:
   ../../../socket-lib
   ../../../socket-sdk-js
   ../../../socket-registry/registry
   ../../../socket-packageurl-js

2. node_modules fallback:
   node_modules/@socketsecurity/lib
   node_modules/@socketsecurity/sdk
   (etc.)

3. Fail with clear error
```

### Custom plugins

**resolve-socket-packages**:
- Resolves local Socket packages by path
- Handles subpath exports (e.g., `@socketsecurity/lib/logger`)
- Checks `package.json` exports field

**resolve-socket-lib-internals**:
- Handles relative imports within socket-lib
- Maps `../constants/*` to dist paths
- Resolves bundled external dependencies

**yoga-wasm-alias**:
- Redirects `yoga-layout` to custom sync implementation
- Required for Ink rendering in CLI

**stub-problematic-packages**:
- Stubs `iconv-lite` and `encoding`
- Prevents bundling issues with optional dependencies

## Troubleshooting

### Build fails with "Cannot find module"

Check local package paths:
```bash
ls -la ../../../socket-lib/dist
ls -la ../../../socket-sdk-js/dist
ls -la ../../../socket-registry/registry/dist
```

Rebuild dependencies:
```bash
cd ../../../socket-lib && pnpm run build
cd ../../../socket-sdk-js && pnpm run build
```

### Build succeeds but runtime errors

Missing WASM/models:
```bash
# Re-extract assets
node packages/cli/scripts/extract-yoga-wasm.mjs
node packages/cli/scripts/extract-onnx-runtime.mjs
node packages/cli/scripts/extract-minilm-model.mjs
```

### Slow build times

Use watch mode for development:
```bash
pnpm run dev
```

Clean node_modules if very slow:
```bash
pnpm run clean:node_modules
pnpm install
```

### Bundle size too large

Check what's included:
```bash
# Build with analysis
node packages/cli/.config/esbuild.cli.build.mjs

# Review metafile output
# Check for unexpected dependencies
```

## Best Practices

### Development workflow
```bash
# 1. Start watch mode
pnpm run dev

# 2. Make code changes
# 3. Test immediately (auto-rebuilt)
pnpm exec socket --version

# 4. Iterate quickly
```

### Production workflow
```bash
# 1. Clean build
pnpm run build

# 2. Run tests
pnpm test

# 3. Verify bundle
ls -lh packages/cli/dist/cli.js

# 4. Check startup time
time pnpm exec socket --version
```

### CI/CD workflow
```bash
# Build once, use everywhere
pnpm run build --quiet

# Test with built artifacts
pnpm test-ci

# Package for distribution
pnpm run build:platforms
```

## Comparison: esbuild vs Rollup

| Feature | esbuild | Rollup |
|---------|---------|--------|
| Build time | ~500ms | ~30-60s |
| Watch mode | ~200ms | ~5-10s |
| Template literals | ✓ Correct | ⚠ Corruption issues |
| Tree shaking | ✓ Fast | ✓ Thorough |
| Minification | ✓ Built-in | Requires plugin |
| Plugin ecosystem | Growing | Mature |
| CLI startup impact | Fast | Slower |

## Future Optimizations

### Potential improvements
1. **Code splitting**: Split large dependencies into chunks
2. **Lazy loading**: Load ML models on demand
3. **Native modules**: Replace JS with native addons where beneficial
4. **Bundle analysis**: Automated size regression detection

### Monitoring
```bash
# Track bundle size over time
du -h packages/cli/dist/cli.js

# Compare startup time
hyperfine 'pnpm exec socket --version'

# Profile cold starts
node --prof packages/cli/dist/cli.js --version
```

## Summary

Socket CLI's esbuild-based build system prioritizes:
- **Speed**: Sub-second builds for rapid development
- **Reliability**: No template literal corruption
- **Performance**: Optimized for fast CLI startup
- **Developer experience**: Watch mode, clear errors, fast iteration

The combination of esbuild's speed and Brotli compression delivers both fast development cycles and compact distribution artifacts.
