# JavaScript and TypeScript performance audit

Benchmark the deployed Node/browser version after warmup, and capture CPU/heap profiles and
deoptimization evidence when available. TypeScript types disappear at runtime: optimize the
generated JavaScript, allocation behavior, and host boundary.

## Scan for these costs

- object/array/closure creation in token or byte loops; use reusable local state or typed
  tables when profiling attributes time/GC to allocation.
- changing object property order, adding/deleting fields after construction, mixed element
  kinds, and polymorphic call sites in hot loops; construct stable record shapes.
- `split`, regex, substring, concatenation, JSON conversion, `Array#map/filter/reduce`, or
  `forEach` allocating intermediate data in the hot path.
- per-token callbacks, promises, dynamic imports, native/Wasm crossings, and worker messages.
- UTF-16 indexing assumptions when parser offsets are defined in UTF-8 bytes or code points.

## High-value checks

- Keep parser input as bytes/typed arrays where the grammar permits; use offsets and numeric
  tags, materializing JS strings/nodes at a chosen API boundary.
- Pre-size arrays only from bounded estimates. Do not create sparse arrays or retain giant
  reusable buffers without measuring peak heap.
- Prefer a straightforward loop when it removes measured allocation/callback overhead, but
  do not rewrite readable code solely to imitate engine internals.
- Keep function inputs and object shapes monomorphic in an actual profiled hot path. This is
  a design constraint, not a reason to rely on a particular undocumented V8 optimization.
- Measure import/startup separately from steady state; move optional native/Wasm loading off
  the critical path only when the delayed cost is acceptable.

## Verification

Use corpus tests, Unicode/error cases, and repeatable benchmarks. Compare median and tail
latency, CPU, GC time, allocation count/heap, and startup. Re-run on all supported Node/V8
versions after an engine-sensitive change.
