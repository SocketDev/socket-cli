# minilm-builder

MiniLM model conversion and optimization for Socket CLI security analysis.

## Purpose

This package converts and optimizes MiniLM models for use in Socket CLI:
- **Model conversion**: Convert PyTorch/Transformers models to ONNX format
- **Quantization**: Apply INT8/INT4 mixed-precision quantization
- **Optimization**: ONNX graph optimizations for inference
- **Expected savings**: 5-10MB per model through quantization

## Build Process

The build follows these steps:

1. **Download models** - Fetch MiniLM models from Hugging Face
2. **Convert to ONNX** - Export models to ONNX format
3. **Apply quantization** - Use mixed-precision INT4/INT8 quantization
4. **Optimize graphs** - Apply ONNX optimization passes
5. **Verify** - Test inference with sample inputs
6. **Export** - Copy to distribution location

## Usage

**Build and optimize models:**
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
- **Models**: List of MiniLM model names to process
- **Quantization strategy**: INT4/INT8 mixed precision settings
- **Optimization level**: ONNX optimization passes

## Models

The following MiniLM models are converted and optimized:
- **Sentence transformer**: For embedding text snippets
- **Tokenizer**: Vocabulary and tokenization rules

## Quantization Strategy

Mixed-precision quantization reduces model size while maintaining accuracy:
- **Attention layers**: INT8 quantization (higher precision for important computations)
- **Feed-forward layers**: INT4 quantization (lower precision, more compression)
- **Embeddings**: INT8 quantization (preserve token representations)
- **Layer norm**: FP32 (no quantization for normalization layers)

## Output

Optimized models are exported to:
- `build/models/minilm.onnx` - Quantized MiniLM model
- `build/models/tokenizer.json` - Tokenizer configuration

## Checkpoints

The build uses checkpoints for incremental builds:
- `downloaded` - Models downloaded from Hugging Face
- `converted` - Models converted to ONNX
- `quantized` - Quantization applied
- `optimized` - Graph optimizations applied
- `verified` - Inference tested

Use `--force` flag to ignore checkpoints and rebuild from scratch.

## Integration

This package is used by Socket CLI to provide AI-powered security analysis. The optimized models are embedded in the Socket CLI distribution for offline inference.

## Size Comparison

Per model:
- **Original PyTorch model**: ~66 MB
- **ONNX FP32**: ~33 MB
- **ONNX INT8**: ~17 MB
- **ONNX INT4/INT8 mixed**: ~13 MB (53 MB saved)

Size savings come from:
1. ONNX format (50% smaller than PyTorch)
2. INT8 quantization (50% smaller than FP32)
3. INT4 quantization (75% smaller than FP32)
4. Graph optimizations (5-10% additional savings)
