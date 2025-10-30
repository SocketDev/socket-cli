# @socketsecurity/onnxruntime

Custom ONNX Runtime WASM build optimized for Socket CLI.

## Overview

This package builds ONNX Runtime from source with Emscripten, optimized for:
- **Synchronous WASM instantiation** (`WASM_ASYNC_COMPILATION=0`)
- **Minimal size** (aggressive optimization flags)
- **Fast startup** (embedded WASM, no network fetch)

## Building

```bash
# Normal build with checkpoints
pnpm run build

# Force rebuild (ignore checkpoints)
pnpm run build:force

# Clean build artifacts
pnpm run clean
```

## Requirements

- **Emscripten SDK** (emsdk)
- **CMake** (3.13+)
- **Git**

Install Emscripten: https://emscripten.org/docs/getting_started/downloads.html

## Output

Built artifacts are exported to `build/wasm/`:
- `ort-wasm-simd-threaded.wasm` - ONNX Runtime WebAssembly module
- `ort-wasm-simd-threaded.js` - Emscripten JavaScript glue code

## Integration

The CLI's `extract-onnx-runtime.mjs` script:
1. Reads these built WASM artifacts
2. Embeds WASM as base64
3. Generates `build/onnx-sync.mjs` for synchronous loading

## Version

Based on ONNX Runtime v1.20.0 (or latest stable).
