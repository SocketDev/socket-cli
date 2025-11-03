/**
 * Socket Security - Minimal-Touch Brotli Builtin Loader
 *
 * @file socketsecurity_brotli_builtin_loader.h
 * @brief External header for Node.js builtin Brotli decompression
 * @version 1.0.0
 * @date 2025-01-17
 *
 * OVERVIEW
 * This header provides transparent Brotli decompression for Node.js JavaScript
 * builtin modules. It acts as a drop-in replacement for the standard builtin
 * loading path, automatically detecting and decompressing Brotli-compressed
 * modules while falling back to standard loading for uncompressed modules.
 *
 * DESIGN GOALS
 * 1. Minimal Node.js source modification (only 10 lines across 2 files)
 * 2. All decompression logic in external, maintainable code
 * 3. Zero runtime overhead for uncompressed modules
 * 4. Safe fallback on any decompression failure
 * 5. No undefined behavior or platform-specific hacks
 *
 * INTEGRATION
 * This header is included by src/node_builtins.cc and requires:
 *
 * 1. Friend declaration in src/node_union_bytes.h:
 *    friend struct socketsecurity::builtins::UnionBytesAccessor;
 *
 * 2. Call site modification in src/node_builtins.cc:
 *    - return source.ToStringChecked(isolate);
 *    + return socketsecurity::builtins::LoadBuiltinSourceWithBrotli(isolate, id, source);
 *
 * COMPRESSION FORMAT
 * Brotli-compressed builtins use a 12-byte header:
 *
 *   Offset | Size | Description
 *   -------|------|------------------------------------------
 *   0      | 4    | Magic marker: "BROT" (0x42, 0x52, 0x4F, 0x54)
 *   4      | 8    | Decompressed size (little-endian uint64_t)
 *   12     | N    | Brotli-compressed JavaScript data
 *
 * BINARY SIZE SAVINGS
 * Expected savings with Brotli compression:
 * - JavaScript builtins: ~30MB → ~5MB (83% reduction)
 * - Total binary impact: 60MB → 35MB baseline
 * - With minification + Brotli: 60MB → 20MB (67% total reduction)
 *
 * LICENSE
 * Copyright (c) 2025 Socket Security
 * SPDX-License-Identifier: MIT
 */

#ifndef SOCKETSECURITY_BROTLI_BUILTIN_LOADER_H_
#define SOCKETSECURITY_BROTLI_BUILTIN_LOADER_H_

#include "node_union_bytes.h"
#include "v8.h"
#include <brotli/decode.h>
#include <cstdio>
#include <cstring>
#include <memory>

namespace socketsecurity {
namespace builtins {

// Magic marker identifying Brotli-compressed builtin modules.
constexpr const char BROTLI_MAGIC[4] = {'B', 'R', 'O', 'T'};

// Size of the Brotli compression header (4 bytes magic + 8 bytes size).
constexpr size_t BROTLI_HEADER_SIZE = 12;

// Maximum decompressed size for a single builtin module (50MB sanity check).
constexpr uint64_t MAX_DECOMPRESSED_SIZE = 50ULL * 1024 * 1024;

/**
 * Accessor struct for UnionBytes private members.
 * Requires friend declaration in src/node_union_bytes.h.
 */
struct UnionBytesAccessor {
  static const uint8_t* GetData(const node::UnionBytes& source, size_t* out_size) {
    // Only handle one-byte (ASCII/UTF-8) strings.
    if (!source.is_one_byte() || !source.one_byte_resource_) {
      *out_size = 0;
      return nullptr;
    }

    // Access private member via friend declaration.
    auto* resource = source.one_byte_resource_;
    *out_size = resource->length();
    return reinterpret_cast<const uint8_t*>(resource->data());
  }
};

/**
 * Load a Node.js builtin source with optional Brotli decompression.
 *
 * Drop-in replacement for UnionBytes::ToStringChecked() with transparent
 * Brotli decompression support.
 *
 * ALGORITHM:
 * 1. Extract raw bytes from UnionBytes (via friend accessor)
 * 2. Check for Brotli magic marker (fast rejection for uncompressed)
 * 3. Validate decompressed size
 * 4. Decompress with Brotli
 * 5. Create V8 string from decompressed JavaScript
 * 6. Fall back to standard loading on any error
 *
 * @param isolate V8 isolate for string creation
 * @param id Builtin module identifier (for debugging)
 * @param source UnionBytes containing potentially compressed JavaScript
 * @return V8 string containing decompressed JavaScript
 */
inline v8::MaybeLocal<v8::String> LoadBuiltinSourceWithBrotli(
    v8::Isolate* isolate,
    const char* id,
    const node::UnionBytes& source) {

  // Step 1: Extract raw bytes from UnionBytes.
  size_t data_size;
  const uint8_t* data = UnionBytesAccessor::GetData(source, &data_size);

  // Fallback: If we can't access the data, use standard loading.
  if (!data || data_size == 0) {
    return source.ToStringChecked(isolate);
  }

  // Step 2: Check for Brotli compression marker (fast path for uncompressed).
  if (data_size < BROTLI_HEADER_SIZE ||
      std::memcmp(data, BROTLI_MAGIC, 4) != 0) {
    return source.ToStringChecked(isolate);
  }

  // Step 3: Read and validate decompressed size.
  uint64_t decompressed_size;
  std::memcpy(&decompressed_size, data + 4, 8);

  if (decompressed_size == 0 || decompressed_size > MAX_DECOMPRESSED_SIZE) {
    return source.ToStringChecked(isolate);
  }

  // Step 4: Prepare for decompression.
  const uint8_t* compressed = data + BROTLI_HEADER_SIZE;
  size_t compressed_size = data_size - BROTLI_HEADER_SIZE;

  // Allocate decompression buffer.
  auto decompressed = std::make_unique<uint8_t[]>(decompressed_size);

  // Step 5: Decompress with Brotli.
  size_t actual_size = decompressed_size;
  BrotliDecoderResult result = BrotliDecoderDecompress(
      compressed_size,
      compressed,
      &actual_size,
      decompressed.get()
  );

  // Validate decompression result.
  if (result != BROTLI_DECODER_RESULT_SUCCESS ||
      actual_size != decompressed_size) {
    return source.ToStringChecked(isolate);
  }

  // Step 6: Create V8 string from decompressed JavaScript.
  auto maybe_string = v8::String::NewFromOneByte(
      isolate,
      decompressed.get(),
      v8::NewStringType::kNormal,
      static_cast<int>(actual_size)
  );

  if (maybe_string.IsEmpty()) {
    return source.ToStringChecked(isolate);
  }

  return maybe_string;
}

}  // namespace builtins
}  // namespace socketsecurity

#endif  // SOCKET_BROTLI_BUILTIN_LOADER_H_
