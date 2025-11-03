# Socket CLI Polyfills for small-icu

This directory contains polyfill modules that provide safety fallbacks for Node.js built with `--with-intl=small-icu` (English-only ICU data).

## Why These Polyfills?

When Node.js is built with `--with-intl=small-icu`:
- Binary size reduced by ~5 MB (English-only ICU vs full ICU)
- Most internationalization features work correctly
- Some edge cases may throw errors or behave unexpectedly

These polyfills act as safety layers, providing basic fallback implementations when native ICU methods fail.

## Polyfills Included

### 1. `localeCompare.js`
- **Target**: `String.prototype.localeCompare()`
- **Purpose**: Provides basic alphabetical comparison fallback
- **Applied to**: `lib/internal/per_context/primordials.js`

### 2. `normalize.js`
- **Target**: `String.prototype.normalize()`
- **Purpose**: Provides basic Unicode normalization fallback
- **Applied to**: `lib/internal/bootstrap/node.js`

## Design: External Injection (Option A)

These polyfills use the external module injection pattern:

1. **Standalone files**: Each polyfill is a self-contained module
2. **Minimal patches**: Node.js core files only load these external modules
3. **Clean separation**: Polyfill logic lives here, not in Node.js source
4. **Easy maintenance**: Update polyfills without regenerating patches

## Patch Structure

Each polyfill is loaded via a minimal patch that:
1. Checks if the native implementation works
2. Falls back to the polyfill if native throws an error
3. Adds a `Socket CLI: Polyfill <feature>` marker for verification

## Testing

Polyfills are verified during build via `scripts/build.mjs`:
- Checks for polyfill markers in target files
- Warns if not applied (but doesn't fail build)
- Polyfills are optional safety layers, not required

## Binary Size Impact

- Polyfill code: ~2-4 KB uncompressed
- Brotli compressed: ~1 KB
- Negligible impact on final binary size
