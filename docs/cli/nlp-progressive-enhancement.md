# NLP Progressive Enhancement

Socket CLI's NLP system uses progressive enhancement to work with or without ONNX Runtime and ML models.

## Overview

The NLP system provides three tiers of functionality:

```
┌─────────────────────────────────────────┐
│ Tier 3: Full (CodeT5)                  │
│ Code analysis & synthesis              │
│ Requires: ONNX Runtime + CodeT5 models│
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ Tier 2: Enhanced (MiniLM)              │
│ Semantic embeddings                    │
│ Requires: ONNX Runtime + MiniLM model │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ Tier 1: Baseline (compromise)          │
│ Basic NLP features                      │
│ Always available (pure JS)              │
└─────────────────────────────────────────┘
```

## Architecture

### Stub Pattern

The `onnx-runtime-stub.mts` module provides a graceful fallback API:

```typescript
// Try to load real ONNX Runtime, fall back to stub if unavailable.
export async function loadOnnxRuntime() {
  try {
    const onnx = await import('onnxruntime-node')
    return onnx
  } catch {
    // Return stub for graceful degradation.
    return stubOnnxRuntime
  }
}
```

### Progressive Loading

The `nlp.mts` module uses capability checks:

```typescript
// Check if enhanced NLP is available.
async function checkEnhancedNLP(): Promise<boolean> {
  // Load ONNX Runtime (real or stub).
  onnxRuntime = await loadOnnxRuntime()

  if (!onnxRuntime) return false

  // Check if models are available.
  if (!existsSync(minilmModel)) return false

  // Try to load the model.
  minilmSession = await onnxRuntime.InferenceSession.create(minilmModel)

  return minilmSession !== null
}
```

## Features by Tier

### Tier 1: Baseline (Always Available)

Uses `compromise` library for pure JavaScript NLP:

- `tokenize()` - Basic word tokenization
- `extractEntities()` - Named entity recognition (people, places, organizations)
- `getSentiment()` - Sentiment analysis (positive/negative/neutral)
- `semanticSimilarity()` - Word overlap-based similarity (compromise fallback)
- `analyzeCode()` - Line count and basic complexity estimation

### Tier 2: Enhanced (When MiniLM + ONNX Available)

Adds semantic understanding via MiniLM embeddings:

- `tokenize()` - WordPiece tokenization (more accurate)
- `getEmbedding()` - 384-dimensional semantic embeddings
- `semanticSimilarity()` - Cosine similarity between embeddings

### Tier 3: Full (When CodeT5 + ONNX Available)

Adds code-specific ML capabilities:

- `analyzeCode()` - Deep code analysis via CodeT5 encoder
- `synthesizeCode()` - Code generation via CodeT5 decoder
- `explainVulnerability()` - Security issue explanations
- `suggestFix()` - Automated fix suggestions
- `calculateCodeSimilarity()` - Semantic code similarity

## Configuration

### Model Paths

Configure model locations via environment variable:

```bash
export SOCKET_CLI_MODELS_PATH=/path/to/models
```

Default: `.cache/models/`

Expected model files:
- `minilm-l6-int4.onnx` - MiniLM embeddings model (INT4 quantized)
- `minilm-l6-tokenizer.json` - MiniLM tokenizer vocabulary
- `codet5-encoder-int4.onnx` - CodeT5 encoder (INT4 quantized)
- `codet5-decoder-int4.onnx` - CodeT5 decoder (INT4 quantized)
- `codet5-tokenizer.json` - CodeT5 tokenizer vocabulary

### Capability Detection

Check available features at runtime:

```typescript
import { getNLPCapabilities } from './utils/nlp.mts'

const capabilities = await getNLPCapabilities()

if (capabilities.baseline) {
  // Basic NLP always available
}

if (capabilities.enhanced) {
  // Semantic embeddings available
}

if (capabilities.codet5) {
  // Code analysis/synthesis available
}
```

## Build Requirements

### Minimal Build (Baseline Only)

No external dependencies required:
- Pure JavaScript via `compromise`
- Works on any platform
- No WASM compilation needed

### Enhanced Build (MiniLM)

Requires:
- ONNX Runtime (`onnxruntime-node` package)
- MiniLM model files (INT4 quantized, ~4MB)

### Full Build (CodeT5)

Requires:
- ONNX Runtime (`onnxruntime-node` package)
- CodeT5 model files (INT4 quantized, ~50MB encoder + ~50MB decoder)

## Testing

Test without ONNX Runtime:

```bash
# Temporarily hide onnxruntime-node.
NODE_PATH=/tmp/nonexistent node test-nlp-fallback.mjs
```

Verify:
- ✓ Capabilities report baseline-only
- ✓ All functions return results
- ✓ No exceptions thrown
- ✓ Graceful degradation to compromise

## Benefits

### For Development

- Fast builds without waiting for WASM compilation
- Works in environments without ONNX Runtime support
- Easy to test baseline vs enhanced features

### For Production

- Smaller binary size without ML models
- Faster startup time without model loading
- Flexible deployment (ship with or without models)

### For Users

- CLI works immediately without model downloads
- Optional enhanced features for power users
- No breaking changes when models unavailable

## Implementation Details

### Why Stub Instead of Optional Imports?

We use a stub pattern instead of conditional imports because:

1. **Type Safety**: Stub provides correct types for IDE autocomplete
2. **Error Handling**: Graceful fallback instead of import errors
3. **Testing**: Easy to test both paths (real vs stub)
4. **Compatibility**: Works with any module system (ESM, CJS)

### Why INT4 Quantization?

Models are quantized to INT4 (4-bit integers) for:

1. **Size**: 8x smaller than FP32 models
2. **Speed**: Faster inference on CPU
3. **Memory**: Lower RAM usage
4. **Quality**: Minimal accuracy loss for NLP tasks

MiniLM: 25MB (FP32) → 4MB (INT4)
CodeT5: 800MB (FP32) → 100MB (INT4)

### Why Three Tiers?

- **Baseline**: Ensures CLI always works
- **Enhanced**: Adds semantic understanding without huge models
- **Full**: Maximum capability for security analysis

## Troubleshooting

### ONNX Runtime Not Loading

Symptoms: `enhanced: false` in capabilities

Solutions:
- Install onnxruntime-node: `npm install onnxruntime-node`
- Check platform support (Node.js 18+, x64/arm64)
- Verify WASM support: `node --experimental-wasm-modules`

### Models Not Found

Symptoms: `enhanced: false` even with ONNX Runtime

Solutions:
- Download models to `.cache/models/`
- Set `SOCKET_CLI_MODELS_PATH` environment variable
- Check file permissions
- Verify model file integrity (INT4 ONNX format)

### Performance Issues

Symptoms: Slow NLP operations

Solutions:
- Use INT4 quantized models (not FP32)
- Enable WASM SIMD: `node --experimental-wasm-simd`
- Enable WASM threads: `node --experimental-wasm-threads`
- Increase Node.js memory: `NODE_OPTIONS="--max-old-space-size=4096"`

## Future Enhancements

Potential improvements:

1. **Model Streaming**: Download models on-demand
2. **WebGPU**: GPU acceleration for faster inference
3. **Model Caching**: Cache embeddings to disk
4. **Quantization**: INT2 models for even smaller size
5. **Fine-tuning**: Custom models for Socket-specific tasks

## References

- [ONNX Runtime](https://onnxruntime.ai/)
- [MiniLM Paper](https://arxiv.org/abs/2002.10957)
- [CodeT5 Paper](https://arxiv.org/abs/2109.00859)
- [Quantization Guide](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- [Progressive Enhancement](https://developer.mozilla.org/en-US/docs/Glossary/Progressive_Enhancement)
