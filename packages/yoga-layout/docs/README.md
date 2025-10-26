# yoga-layout Documentation

Package-level documentation for the Yoga Layout WASM builder.

## Overview

This package builds a minimal, size-optimized Yoga Layout WASM module for Socket CLI's terminal layout rendering needs.

## Contents

- **build-process.md** - Detailed build process and optimization strategy
- **upstream-tracking.md** - Tracking Yoga v3.1.0 and update process
- **api-reference.md** - JavaScript API for the WASM module

## Quick Links

- **Main README**: `../README.md`
- **Build Script**: `../scripts/build.mjs`
- **Source Bindings**: `../src/yoga-wasm.cpp`

## Build Output

- **Location**: `build/wasm/`
- **Files**: `yoga.wasm` (130 KB), `yoga.js` (19 KB)
- **Optimizations**: Emscripten -Oz, Closure Compiler, wasm-opt aggressive flags

## Upstream

- **Repository**: https://github.com/facebook/yoga
- **Version**: v3.1.0
- **License**: MIT
