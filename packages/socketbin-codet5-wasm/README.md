# @socketbin/codet5-wasm

CodeT5 model for code analysis and vulnerability explanations (WASM)

## Overview

This package contains the CodeT5 code transformer model compiled to WebAssembly for use in Socket CLI. It enables code vulnerability analysis and natural language explanations of security issues.

## Model Details

- **Model:** Salesforce/codet5-base
- **Size:** ~90 MB (INT4 quantized)
- **Format:** Unified WASM binary
- **Includes:**
  - CodeT5 encoder INT4 (~34 MB quantized)
  - CodeT5 decoder INT4 (~56 MB quantized)
  - Tokenizer (~500 KB)
  - ONNX inference runtime

## Installation

```bash
npm install @socketbin/codet5-wasm
```

## Usage

This package is intended for use with Socket CLI and is typically installed automatically as an optional dependency when needed.

```javascript
// Example: Loading the WASM binary
const wasmPath = require.resolve('@socketbin/codet5-wasm/bin/codet5.wasm')
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
