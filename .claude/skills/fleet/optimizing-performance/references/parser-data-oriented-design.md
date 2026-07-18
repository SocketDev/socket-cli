# Parser data-oriented design audit

Optimize the access pattern, not the class hierarchy. Parser pipelines commonly scan
source, produce tokens, build nodes, resolve references, and serialize/traverse results;
data read together should be compact and traversable together.

## Scan for these costs

- `String`/`std::string`/`string`/JS string creation for every identifier, token, or
  literal; prefer source spans (`start`, `end`) until text is actually needed.
- one heap allocation per token, node, child list, error, or temporary; use capacity
  estimates, contiguous node stores, and bounded scratch storage where profiling agrees.
- node pointers/references scattered across the heap; use stable indices/offsets into
  owned tables when nodes are frequently traversed or serialized.
- array-of-struct layouts when a pass uses only one or two fields across many nodes;
  evaluate structure-of-arrays or a compact header plus side tables.
- linked lists, boxed variants, hash maps, virtual calls, closures, or callback crossings
  in the inner token loop.
- repeated decoding/normalization and generic Unicode work on an ASCII-dominant input;
  use a proven ASCII fast path that retains a correct Unicode fallback.

## Design rules

1. Measure allocation count, bytes allocated, cache/CPU cost, and peak memory separately.
   An arena can lower allocator overhead while increasing retention.
2. Reserve from a conservative source-length-derived estimate; never trust hostile input
   length as an unbounded allocation request.
3. Represent variable-size children as `(offset, length)` into a shared child-index table
   rather than allocating a container in every node when traversal dominates.
4. Keep source text and AST storage position-independent where practical. Indices are
   easier to serialize, move, share with Wasm/typed arrays, and validate than pointers.
5. Use a fixed wire layout at cross-language boundaries. Assert field widths/alignment on
   the native side and test endianness/versioning; do not cast arbitrary bytes to structs.
6. Separate the common cheap path from rare decoding, error recovery, comments, and rich
   diagnostics. Preserve exact source locations and error behavior.

## Language mapping

| Rust | Go | C++ | JS/TypeScript |
| --- | --- | --- | --- |
| `Vec::with_capacity`, arena/index tables, slices/spans, avoid clone-heavy ASTs | pre-sized slices, byte offsets, avoid `fmt`/string conversion in scan loop | `vector::reserve`, `string_view` with explicit lifetime, `pmr` only with bounded ownership | `Uint8Array`/typed tables, numeric tags/offsets, stable arrays, avoid object-per-token |

## Validation

Test deeply nested and malformed input, source retention after parse, offset overflow,
Unicode locations, and serializing/deserializing the compact representation. Benchmark
small files and large generated files separately: a layout helping bulk throughput can
lose on startup or tiny inputs.

## Further reading

- [Engineering High-Performance Parsers](https://www.arshad.fyi/writings/engineering-high-performance-parsers)
