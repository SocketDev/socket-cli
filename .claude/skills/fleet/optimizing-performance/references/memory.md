# Memory and allocation audit

Memory performance has four independent dimensions: allocation frequency, allocation bytes,
retained live memory, and locality. Report each one. Reducing one can make another worse.

## Scan for these costs

- capacity that only grows (`Vec`, slices, vectors, strings, typed arrays, maps, caches) and
  never shrinks, resets, or evicts;
- copied source text, decoded literals, or serialized data retained after a parser/API only
  needs spans, offsets, or a bounded subset;
- heap/object allocation per token, node, record, callback, error, or cross-boundary result;
- pointer-rich ownership (`Box`, `shared_ptr`, linked lists, object graphs) in bulk traversal;
- pools, arenas, interners, and global caches with unclear reset, cardinality, thread-safety,
  or lifetime rules;
- reuse that pins one hostile large input's capacity for every later small request.

## Change rules

1. Use conservative bounds derived from measured normal inputs; cap or reject hostile sizes.
2. Make ownership and reset points explicit. A pool is not an ownership protocol, and an arena
   is not automatically lower peak memory.
3. Prefer contiguous tables and offsets when bulk traversal/serialization dominates; prove
   source and table lifetimes before borrowing/viewing.
4. Record allocation count, bytes, high-water mark, RSS/heap, GC or allocator CPU, and
   throughput. Benchmark a large-input-then-small-input sequence to expose retention.
5. Preserve failure behavior and clean up on cancellation/error paths.

## Language cues

| Rust | Go | C++ | JS/TS |
| --- | --- | --- | --- |
| bounded `Vec::with_capacity`, spans, explicit arena lifetime | pre-sized slices, escape evidence, bounded reuse | `vector::reserve`, view lifetime, resource reset | typed tables, bounded arrays/caches, stable record shapes |
