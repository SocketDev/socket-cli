# node-sea-builder Documentation

Package-level documentation for the Node.js Single Executable Application (SEA) builder.

## Overview

This package transforms Socket CLI into a single executable application using Node.js SEA capabilities with AST-based compatibility transformations.

## Contents

- **sea-architecture.md** - SEA build process and architecture
- **ast-transformations.md** - Code transformations for SEA compatibility
- **compatibility-issues.md** - Known SEA limitations and workarounds
- **verification-process.md** - AST-based verification of transformations

## Quick Links

- **Main README**: `../README.md`
- **Build Script**: `../scripts/build-sea.mjs`
- **Verification Script**: `../scripts/verify-sea-transforms.mjs`

## Build Process

1. **Bundle** - Rollup builds CLI into single file
2. **Transform** - AST-based SEA compatibility transformations
3. **Inject** - postject embeds bundle into Node.js binary
4. **Verify** - Validate transformations and test execution

## AST Transformations

- **require.resolve.paths** - Add defensive checks for SEA environment
- **Sentinel obscuration** - Prevent postject marker detection
- **Polyfill injection** - Add SEA compatibility polyfills

## Build Output

- **Location**: `build/sea/`
- **Files**:
  - `cli-modified.js` - Transformed CLI bundle
  - `socket-macos-arm64` - Final SEA binary (platform-specific)

## Verification

AST-based verification checks:
- Polyfill presence in first 1000 chars
- No unsafe `require.resolve.paths` patterns
- Sentinel properly obscured
- All accesses have defensive guards

## Upstream

- **Node.js SEA**: Node.js v21.7.1+ feature
- **postject**: https://github.com/nodejs/postject
- **License**: MIT
