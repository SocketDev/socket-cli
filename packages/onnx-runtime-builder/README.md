# onnx-runtime

Custom ONNX Runtime WASM build with minimal operators for CodeT5 model inference.

## Purpose

This package builds ONNX Runtime for WebAssembly with:
- **Minimal operators**: Only operators required by CodeT5 models
- **Size optimizations**: Aggressive compiler flags and wasm-opt
- **Emscripten build**: Compiled to WASM for browser/Node.js compatibility
- **Expected savings**: 600KB-1.2MB compared to full build

## Build Process

The build follows these steps:

1. **Clone ONNX Runtime source** - Download specific version
2. **Generate required ops config** - Analyze CodeT5 models to determine needed operators
3. **Configure CMake** - Set up minimal build with only required ops
4. **Build with Emscripten** - Compile C++ to WASM
5. **Optimize WASM** - Apply wasm-opt with aggressive flags
6. **Verify** - Test inference with CodeT5 models
7. **Export** - Copy to distribution location

## Usage

**Build ONNX Runtime:**
```bash
pnpm run build
```

**Force rebuild (ignore checkpoints):**
```bash
pnpm run build:force
```

**Clean build artifacts:**
```bash
pnpm run clean
```

## Configuration

Build configuration in `scripts/build.mjs`:
- **ONNX Runtime version**: Change `ONNX_VERSION` constant
- **Emscripten flags**: Modify optimization flags
- **Required operators**: Auto-generated from models or manually specified

## Required Operators

The build uses `python tools/ci_build/reduce_op_kernels.py` to generate a minimal operator configuration based on CodeT5 models. This significantly reduces binary size by excluding unused operators.

Operators required by CodeT5:
- `Add`, `Cast`, `Concat`, `Div`, `Dropout`, `Gather`
- `Gemm`, `LayerNormalization`, `MatMul`, `Mul`, `ReduceMean`
- `Reshape`, `Shape`, `Slice`, `Softmax`, `Split`, `Squeeze`
- `Sub`, `Tanh`, `Transpose`, `Unsqueeze`

## Output

Built WASM files are exported to:
- `build/onnxruntime-web.wasm` - Optimized WASM binary
- `build/onnxruntime-web.js` - JavaScript glue code

## Checkpoints

The build uses checkpoints for incremental builds:
- `cloned` - Source code cloned
- `ops-analyzed` - Required operators determined
- `configured` - CMake configured
- `built` - WASM binary compiled
- `optimized` - wasm-opt applied
- `verified` - Inference tested

Use `--force` flag to ignore checkpoints and rebuild from scratch.

## Integration

This package is used by Socket CLI to provide WASM-based model inference for security analysis. The built ONNX Runtime is embedded in the Socket CLI distribution.

## Size Comparison

- **Full ONNX Runtime WASM**: ~3.0 MB
- **Minimal build (this)**: ~2.4 MB (600KB saved)
- **After wasm-opt**: ~1.8 MB (1.2MB saved)

Size savings come from:
1. Excluding unused operators (600KB)
2. Aggressive optimization flags (300KB)
3. wasm-opt post-processing (300KB)
