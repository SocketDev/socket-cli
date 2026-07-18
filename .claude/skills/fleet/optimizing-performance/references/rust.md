# Rust performance audit

Profile a release-like Cargo profile and record `rustc -Vv`, target, and feature set. Scan
hot parser and service paths for `clone`, `to_owned`, `collect`, `format!`, `String` growth,
`HashMap` use, trait-object dispatch, lock contention, and allocations hidden in iterator
adapters or error construction.

## High-value checks

- Preallocate `Vec`, `String`, and maps from measured conservative bounds; retain/reuse
  buffers only when their retained capacity is bounded and reduces allocator pressure.
- Use borrowed source spans or byte offsets during scanning; promote to owned/interned text
  only at a measured ownership boundary.
- Favor contiguous `Vec` tables and indices for parser nodes. Avoid `Box` per node unless
  recursion or ownership genuinely requires it.
- Use `#[inline]` and `#[cold]` only around profiled call/layout facts. Check code-size
  growth and inspect the release artifact after the benchmark proves value.
- Benchmark `lto = "thin"`, `codegen-units`, and PGO separately. `target-cpu=native` is a
  local experiment, not a portable release setting; gate target features safely.
- Treat `unsafe`, manual SIMD, custom allocators, and interior mutability as escalation
  paths with invariants, fuzz/property tests, and measured wins.

## Measurement

Use `cargo bench` or the repository benchmark harness for controlled comparisons, and a
system profiler/allocation profiler for whole-program cost. Include allocation count/bytes,
peak RSS, and binary/startup impact alongside throughput. Keep parser corpus distributions
representative (small files, large files, malformed input, Unicode where applicable).
