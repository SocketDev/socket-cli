# Socket CLI Unified WASM Bundle

Single WASM file containing all AI models and execution engines for Socket CLI.

## Architecture

```
socket-ai.wasm (~145MB)
  ├─ ONNX Runtime (~2-5MB) - ML execution engine
  ├─ MiniLM model (~17MB int8) - Semantic understanding
  ├─ CodeT5 encoder (~60MB int8) - Code generation (encoder)
  ├─ CodeT5 decoder (~60MB int8) - Code generation (decoder)
  ├─ Tokenizers (~1MB) - Text tokenization
  └─ Yoga Layout (~95KB) - Flexbox layout engine
```

## Build Process

### 1. Check Prerequisites

```bash
node scripts/wasm/check-rust-toolchain.mjs
```

**What it does**:
- Checks for Rust/cargo installation
- Installs Rust via rustup if missing
- Installs wasm32-unknown-unknown target
- Installs wasm-pack

### 2. Download Models

```bash
node scripts/wasm/download-models.mjs
```

**What it downloads**:
- MiniLM model (pre-quantized from HuggingFace)
- CodeT5 tokenizer (from HuggingFace)
- ONNX Runtime WASM (from node_modules)
- Yoga Layout WASM (from node_modules)

**What needs conversion** (see next step):
- CodeT5 encoder (PyTorch → ONNX int8)
- CodeT5 decoder (PyTorch → ONNX int8)

### 3. Convert CodeT5 Models (One-Time)

```bash
# Requires Python + optimum[onnxruntime]
pip install optimum[onnxruntime] torch

# Convert models
node scripts/wasm/convert-codet5.mjs
```

**What it does**:
- Downloads `Salesforce/codet5-small` from HuggingFace
- Exports PyTorch → ONNX format
- Quantizes fp32 → int8
- Saves to `.cache/models/`

### 4. Build Unified WASM

```bash
node scripts/wasm/build-unified-wasm.mjs
```

**What it does**:
1. Runs prerequisite checks (Rust, models)
2. Builds Rust project with wasm-pack
3. Optimizes with wasm-opt (if available)
4. Embeds WASM as brotli-compressed base64 in JavaScript
5. Generates `external/socket-ai-sync.mjs`

**Output**:
- `wasm-bundle/pkg/socket_ai_bg.wasm` (~145MB)
- `external/socket-ai-sync.mjs` (brotli+base64 embedded)

## Distribution Pipeline

```
external/socket-ai-sync.mjs (~50-70MB brotli+base64)
  ↓
Rollup bundles into dist/cli.js
  ↓
Brotli compress entire bundle
  ↓
dist/cli.js.bz (~20-30MB estimated)
  ↓
Native stub OR index.js detects .bz extension
  ↓
Decompresses with built-in zlib.brotliDecompress
  ↓
Runs in vm.Module
```

## Usage

### Load WASM Module

```javascript
import { loadWasmSync, getWasmExports } from './external/socket-ai-sync.mjs'

// Initialize WASM (one-time, ~50-100ms)
loadWasmSync()

// Access exports
const exports = getWasmExports()
```

### Load Models

```javascript
import {
  loadCodet5DecoderSync,
  loadCodet5EncoderSync,
  loadCodet5TokenizerSync,
  loadMinilmModelSync,
  loadMinilmTokenizerSync,
} from './external/socket-ai-sync.mjs'

// Load MiniLM
const minilmModel = loadMinilmModelSync() // Uint8Array
const minilmTokenizer = loadMinilmTokenizerSync() // JSON object

// Load CodeT5
const encoder = loadCodet5EncoderSync() // Uint8Array
const decoder = loadCodet5DecoderSync() // Uint8Array
const tokenizer = loadCodet5TokenizerSync() // JSON object
```

### Use with ONNX Runtime

```javascript
import { InferenceSession } from 'onnxruntime-web'
import { loadCodet5EncoderSync } from './external/socket-ai-sync.mjs'

// Load encoder from WASM linear memory
const encoderBytes = loadCodet5EncoderSync()

// Create ONNX session
const session = await InferenceSession.create(encoderBytes.buffer)

// Run inference
const outputs = await session.run({ input_ids: inputTensor })
```

## File Structure

```
wasm-bundle/
├── Cargo.toml              # Rust project config
├── src/
│   └── lib.rs              # WASM exports (model pointers)
├── pkg/                    # wasm-pack output (gitignored)
│   └── socket_ai_bg.wasm   # Built WASM bundle
└── README.md               # This file

scripts/wasm/
├── check-rust-toolchain.mjs    # Install Rust if needed
├── download-models.mjs         # Download model assets
├── convert-codet5.mjs          # Convert CodeT5 (TODO)
└── build-unified-wasm.mjs      # Main build script

external/
└── socket-ai-sync.mjs      # Generated loader (base64 WASM)

.cache/models/              # Downloaded models (gitignored)
├── minilm-int8.onnx
├── minilm-tokenizer.json
├── codet5-encoder-int8.onnx
├── codet5-decoder-int8.onnx
├── codet5-tokenizer.json
├── ort-wasm-simd-threaded.wasm
└── yoga.wasm
```

## Next Steps

### 1. Create CodeT5 Conversion Script

```bash
# TODO: Create scripts/wasm/convert-codet5.mjs
# Uses Python + optimum-cli to convert PyTorch → ONNX int8
```

### 2. Update Native Stub for .bz Detection

**File**: `bin/bootstrap.js` or native stub

**Add**:
```javascript
const { brotliDecompressSync } = require('node:zlib')
const { readFileSync } = require('node:fs')

const CLI_ENTRY_BZ = join(CLI_PACKAGE_DIR, 'dist', 'cli.js.bz')

if (existsSync(CLI_ENTRY_BZ)) {
  // Decompress and run
  const compressed = readFileSync(CLI_ENTRY_BZ)
  const decompressed = brotliDecompressSync(compressed)

  // Run in vm.Module or eval
  require('vm').runInThisContext(decompressed, {
    filename: 'cli.js',
  })
} else if (existsSync(CLI_ENTRY)) {
  // Fallback to uncompressed
  require(CLI_ENTRY)
}
```

### 3. Update Rollup Config

Add brotli compression step after bundling:

```javascript
// .config/rollup.dist.config.mjs
import { brotliCompressSync } from 'node:zlib'

export default {
  // ... existing config

  plugins: [
    // ... existing plugins

    {
      name: 'brotli-compress',
      writeBundle(options, bundle) {
        for (const fileName in bundle) {
          if (fileName === 'cli.js') {
            const jsFile = join(options.dir, fileName)
            const code = readFileSync(jsFile)
            const compressed = brotliCompressSync(code)
            writeFileSync(`${jsFile}.bz`, compressed)
            console.log(`✓ Compressed ${fileName} → ${fileName}.bz`)
          }
        }
      }
    }
  ]
}
```

### 4. Test End-to-End

```bash
# Build everything
pnpm run build

# Test compressed bundle
node bin/bootstrap.js --version
```

## Benefits

| Metric | Before (3 files) | After (1 file) |
|--------|------------------|----------------|
| **Assets** | 3 separate WASM/JS | 1 unified WASM |
| **Initialization** | ~150-200ms | ~50-100ms |
| **Memory layout** | Fragmented | Contiguous |
| **Distribution** | Complex | Simple |
| **Size (raw)** | ~140MB total | ~145MB (+5MB overhead) |
| **Size (brotli)** | N/A | ~50-70MB base64 |
| **Size (final)** | ~10MB | ~20-30MB (estimated) |

## Troubleshooting

### Rust Not Found

```bash
# Install Rust manually
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### wasm-pack Build Fails

```bash
# Check Rust version
rustc --version

# Update toolchain
rustup update stable

# Clean and rebuild
rm -rf wasm-bundle/target wasm-bundle/pkg
node scripts/wasm/build-unified-wasm.mjs
```

### CodeT5 Models Missing

Run the conversion script (requires Python):

```bash
pip install optimum[onnxruntime] torch
node scripts/wasm/convert-codet5.mjs
```

### WASM Too Large

The WASM file is ~145MB which is expected given:
- CodeT5 encoder: 60MB
- CodeT5 decoder: 60MB
- MiniLM: 17MB
- ONNX Runtime: 2-5MB
- Yoga: <1MB

After brotli compression in the final distribution, it should be ~20-30MB.

## References

- [wasm-pack Documentation](https://rustwasm.github.io/wasm-pack/)
- [wasm-bindgen Guide](https://rustwasm.github.io/wasm-bindgen/)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
- [CodeT5 Paper](https://arxiv.org/abs/2109.00859)
- [MiniLM Model](https://huggingface.co/sentence-transformers/paraphrase-MiniLM-L3-v2)
