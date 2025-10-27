# onnx-runtime-builder Documentation

Package-level documentation for the ONNX Runtime WASM builder.

## Overview

This package builds a minimal, single-threaded ONNX Runtime WASM module optimized for CodeT5 models in Socket CLI.

## Contents

- **build-process.md** - Detailed build process and configuration
- **operator-set.md** - Required operators for CodeT5 models
- **optimization-strategy.md** - Size optimization techniques
- **upstream-tracking.md** - Tracking ONNX Runtime releases

## Quick Links

- **Main README**: `../README.md`
- **Build Script**: `../scripts/build.mjs`
- **Operator Config**: Generated at `build/required_operators.config`

## Build Output

- **Location**: `build/wasm/`
- **Files**: `onnxruntime-web.wasm`, `onnxruntime-web.js`
- **Configuration**: Minimal build with reduced operator set

## Required Operators

21 operators required for CodeT5 models:
- Add, Cast, Concat, Div, Dropout
- Gather, Gemm, LayerNormalization
- MatMul, Mul, ReduceMean, Reshape
- Shape, Slice, Softmax, Split
- Squeeze, Sub, Tanh, Transpose, Unsqueeze

## Upstream

- **Repository**: https://github.com/microsoft/onnxruntime
- **Version**: v1.20.1
- **License**: MIT
