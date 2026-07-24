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
   invariants, supported-target dispatch, and a measured win. For SIMD, reach for
   `std::arch` intrinsics behind `is_x86_feature_detected!` / `#[cfg(target_arch)]`,
   `std::simd` on nightly, the `wide` crate for stable ergonomic portable SIMD, or the
   SIMD-accelerated `memchr` family for byte scans. Do NOT `-C target-cpu=native` or a
   baseline `-C target-feature=+avx2` in a build distributed to CPUs you do not control — it
   bakes in the build machine's ISA and SIGILLs on older CPUs; runtime
   `is_x86_feature_detected!` dispatch is the portable path. Pin only to a floor a controlled
   target guarantees — a homogeneous fleet, a per-ISA build matrix, or a local build where
   build host == run host — and record why. Enforced by
   `scripts/fleet/check/build-microarch-is-portable.mts`.
5. Report CPU, allocations, peak RSS, binary/startup impact, and correctness results.
