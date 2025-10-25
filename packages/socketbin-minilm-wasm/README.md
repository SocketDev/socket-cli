# @socketbin/minilm-wasm

MiniLM embeddings model for semantic package search (WASM)

## Overview

This package contains the MiniLM sentence transformer model compiled to WebAssembly for use in Socket CLI. It enables semantic search and similarity detection for npm packages.

## Model Details

- **Model:** sentence-transformers/all-MiniLM-L6-v2
- **Size:** ~17 MB (INT4 quantized)
- **Format:** Unified WASM binary
- **Includes:**
  - MiniLM INT4 model (~17 MB quantized)
  - Tokenizer (~500 KB)
  - ONNX inference runtime

## Installation

```bash
npm install @socketbin/minilm-wasm
```

## Usage

This package is intended for use with Socket CLI and is typically installed automatically as an optional dependency when needed.

```javascript
// Example: Loading the WASM binary
const wasmPath = require.resolve('@socketbin/minilm-wasm/bin/minilm.wasm')
```

## Version Format

This package uses production-ready prerelease versioning:

```
0.0.0-YYYYMMDD.BUILD
```

Example: `0.0.0-20251025.1` (October 25, 2025, build #1)

When stable, this package will be released as `1.0.0`.

## Platform Support

WebAssembly runs on all platforms supported by Socket CLI:
- macOS (Apple Silicon and Intel)
- Linux (x64, ARM64)
- Windows (x64, ARM64)
- Alpine Linux

## License

MIT
