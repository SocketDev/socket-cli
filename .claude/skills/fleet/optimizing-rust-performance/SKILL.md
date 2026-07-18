---
name: optimizing-rust-performance
description: Audits measured Rust performance.
---

# Optimizing Rust Performance

Profile a release-like artifact first. Identify whether CPU, allocation, retained memory,
contention, code size, or startup is the binding cost before changing idiomatic code.

1. Read [Rust performance audit](../optimizing-performance/references/rust.md).
2. Scan hot paths for clones, owned-string conversion, growth reallocations, formatting,
   dynamic dispatch, lock contention, and allocation-hidden iterator adapters.
3. Use compiler changes only through
   [optimizing-compiler-performance](../optimizing-compiler-performance/SKILL.md).
4. Keep `unsafe`, SIMD, custom allocators, and target-specific features behind explicit
   invariants, supported-target dispatch, and a measured win.
5. Report CPU, allocations, peak RSS, binary/startup impact, and correctness results.
