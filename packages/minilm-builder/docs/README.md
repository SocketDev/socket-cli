# minilm-builder Documentation

Package-level documentation for the MiniLM model conversion pipeline.

## Overview

This package converts Hugging Face MiniLM models to optimized ONNX format for Socket CLI's ML-powered features.

## Contents

- **pipeline-architecture.md** - ML model conversion pipeline design
- **optimization-techniques.md** - Quantization and ONNX optimization
- **model-selection.md** - Choosing and evaluating MiniLM variants
- **upstream-tracking.md** - Tracking transformers and ONNX releases

## Quick Links

- **Main README**: `../README.md`
- **Build Script**: `../scripts/build.mjs`
- **Python Pipeline**: Auto-generated in `python/`

## Build Pipeline

6-phase automated pipeline:
1. **Setup** - Install Python ML dependencies
2. **Download** - Fetch model from Hugging Face
3. **Convert** - PyTorch → ONNX conversion
4. **Quantize** - INT8 quantization for size reduction
5. **Optimize** - ONNX Runtime optimization passes
6. **Verify** - Validate output correctness

## Build Output

- **Location**: `build/models/`
- **Files**: `model.onnx` (optimized), `tokenizer.json`
- **Format**: ONNX with INT8 quantization

## Python Dependencies

- transformers - Hugging Face model loading
- optimum[onnxruntime] - ONNX conversion and optimization
- onnx - ONNX format manipulation
- onnxruntime - ONNX inference validation

## Upstream

- **Models**: https://huggingface.co/sentence-transformers
- **Pipeline**: Hugging Face Optimum library
- **License**: Apache 2.0
