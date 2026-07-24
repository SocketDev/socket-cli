---
name: optimizing-cpp-performance
description: Audits measured C++ performance.
---

# Optimizing C++ Performance

Profile an optimized, symbolized, production-like build. Explain allocations, indirection,
dispatch, and generated code before introducing a low-level optimization.

1. Read [C++ performance audit](../optimizing-performance/references/cpp.md).
2. Scan for temporary strings, shared ownership, virtual/interface dispatch, `std::function`,
   map/tree lookup, pointer-rich storage, accidental copies, and lock contention.
3. Treat views, arenas/`pmr`, aliasing, SIMD, LTO/PGO, and branch/cold hints as measured,
   lifetime-safe, portable-by-default decisions—not generic fast paths. For SIMD, compile
   SSE2/AVX2/NEON intrinsics behind runtime CPU dispatch with a scalar fallback — e.g. a
   `simd.cpp` carrying `skip_whitespace` / `scan_identifier_chars` / `find_line_terminator` —
   never a `-march`-pinned distributable that assumes the build host's ISA when it ships to
   CPUs you do not control. Pin `-march` only to a floor a controlled target guarantees, and
   record why. Enforced by `scripts/fleet/check/build-microarch-is-portable.mts`.
4. For a Node boundary, also read
   [optimizing-node-native-performance](../optimizing-node-native-performance/SKILL.md).
