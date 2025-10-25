/**
 * Socket CLI Unified WASM Bundle
 *
 * Embeds all AI models and WASM modules:
 * - ONNX Runtime (~3MB SIMD-only, single-threaded)
 * - MiniLM model (~17MB int8)
 * - CodeT5 encoder (~30MB int4)
 * - CodeT5 decoder (~60MB int4)
 * - Tokenizers (~1MB)
 * - Yoga Layout (~95KB)
 *
 * INT4 Quantization:
 * - CodeT5 models use INT4 (4-bit weights) for 50% size reduction
 * - Only 1-2% quality loss compared to INT8
 * - Total: ~115MB (vs ~145MB with INT8)
 */

use wasm_bindgen::prelude::*;

// Embed all models at compile time using include_bytes!().
// These files are read during compilation and embedded in the .wasm file's data section.

static MINILM_MODEL: &[u8] = include_bytes!("../../.cache/models/minilm-int8.onnx");
static MINILM_TOKENIZER: &[u8] = include_bytes!("../../.cache/models/minilm-tokenizer.json");

static CODET5_ENCODER: &[u8] = include_bytes!("../../.cache/models/codet5-encoder-int4.onnx");
static CODET5_DECODER: &[u8] = include_bytes!("../../.cache/models/codet5-decoder-int4.onnx");
static CODET5_TOKENIZER: &[u8] = include_bytes!("../../.cache/models/codet5-tokenizer.json");

// Use optimized SIMD-only WASM (single-threaded).
// We don't use multi-threading (no session options, sequential batching).
// SIMD-only saves ~2 MB vs threaded version.
#[cfg(not(feature = "unoptimized-wasm"))]
static ONNX_RUNTIME: &[u8] = include_bytes!("../../.cache/models/ort-wasm-simd-optimized.wasm");
#[cfg(feature = "unoptimized-wasm")]
static ONNX_RUNTIME: &[u8] = include_bytes!("../../.cache/models/ort-wasm-simd.wasm");

#[cfg(not(feature = "unoptimized-wasm"))]
static YOGA_LAYOUT: &[u8] = include_bytes!("../../.cache/models/yoga-optimized.wasm");
#[cfg(feature = "unoptimized-wasm")]
static YOGA_LAYOUT: &[u8] = include_bytes!("../../.cache/models/yoga.wasm");

// =============================================================================
// MiniLM Model
// =============================================================================

/// Get pointer to MiniLM model in WASM linear memory.
#[wasm_bindgen]
pub fn get_minilm_model_ptr() -> *const u8 {
    MINILM_MODEL.as_ptr()
}

/// Get size of MiniLM model in bytes.
#[wasm_bindgen]
pub fn get_minilm_model_size() -> usize {
    MINILM_MODEL.len()
}

/// Get pointer to MiniLM tokenizer in WASM linear memory.
#[wasm_bindgen]
pub fn get_minilm_tokenizer_ptr() -> *const u8 {
    MINILM_TOKENIZER.as_ptr()
}

/// Get size of MiniLM tokenizer in bytes.
#[wasm_bindgen]
pub fn get_minilm_tokenizer_size() -> usize {
    MINILM_TOKENIZER.len()
}

// =============================================================================
// CodeT5 Models
// =============================================================================

/// Get pointer to CodeT5 encoder in WASM linear memory.
#[wasm_bindgen]
pub fn get_codet5_encoder_ptr() -> *const u8 {
    CODET5_ENCODER.as_ptr()
}

/// Get size of CodeT5 encoder in bytes.
#[wasm_bindgen]
pub fn get_codet5_encoder_size() -> usize {
    CODET5_ENCODER.len()
}

/// Get pointer to CodeT5 decoder in WASM linear memory.
#[wasm_bindgen]
pub fn get_codet5_decoder_ptr() -> *const u8 {
    CODET5_DECODER.as_ptr()
}

/// Get size of CodeT5 decoder in bytes.
#[wasm_bindgen]
pub fn get_codet5_decoder_size() -> usize {
    CODET5_DECODER.len()
}

/// Get pointer to CodeT5 tokenizer in WASM linear memory.
#[wasm_bindgen]
pub fn get_codet5_tokenizer_ptr() -> *const u8 {
    CODET5_TOKENIZER.as_ptr()
}

/// Get size of CodeT5 tokenizer in bytes.
#[wasm_bindgen]
pub fn get_codet5_tokenizer_size() -> usize {
    CODET5_TOKENIZER.len()
}

// =============================================================================
// ONNX Runtime
// =============================================================================

/// Get pointer to ONNX Runtime WASM in linear memory.
#[wasm_bindgen]
pub fn get_onnx_runtime_ptr() -> *const u8 {
    ONNX_RUNTIME.as_ptr()
}

/// Get size of ONNX Runtime WASM in bytes.
#[wasm_bindgen]
pub fn get_onnx_runtime_size() -> usize {
    ONNX_RUNTIME.len()
}

// =============================================================================
// Yoga Layout
// =============================================================================

/// Get pointer to Yoga Layout WASM in linear memory.
#[wasm_bindgen]
pub fn get_yoga_layout_ptr() -> *const u8 {
    YOGA_LAYOUT.as_ptr()
}

/// Get size of Yoga Layout WASM in bytes.
#[wasm_bindgen]
pub fn get_yoga_layout_size() -> usize {
    YOGA_LAYOUT.len()
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Get total embedded size in bytes.
#[wasm_bindgen]
pub fn get_total_embedded_size() -> usize {
    MINILM_MODEL.len()
        + MINILM_TOKENIZER.len()
        + CODET5_ENCODER.len()
        + CODET5_DECODER.len()
        + CODET5_TOKENIZER.len()
        + ONNX_RUNTIME.len()
        + YOGA_LAYOUT.len()
}

/// Get version string.
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
