# C++ performance audit

Profile an optimized, symbolized production-like build. Scan hot paths for allocation,
pointer chasing, virtual/interface dispatch, `std::function`, shared ownership, temporary
`std::string` construction, map/tree lookup, exception construction, lock contention, and
accidental copies.

## High-value checks

- Use contiguous storage and stable indices for bulk parser data. Reserve vectors from
  bounded estimates; choose an arena/`std::pmr` only when resource lifetime and peak-memory
  reset behavior are explicit.
- Use `std::span` and `std::string_view` for non-owning input only when the backing lifetime
  is enforced. A dangling view is not a performance optimization.
- Make data dependencies and aliasing clear through normal type design; do not use undefined
  aliasing, casts, or `restrict`-like extensions as a guess at better vectorization.
- Compare `-O2`/`-O3`, ThinLTO, and PGO on the real corpus. Compile/link time, code size,
  RSS, and tail latency are part of the decision.
- Use `[[likely]]`, `[[unlikely]]`, `[[gnu::cold]]`, and compiler-specific intrinsics only
  for profile-proven facts, behind portability wrappers. PGO is preferable to stale hints.
- Consider SIMD only after proving a vectorizable bulk operation and supplying a baseline
  implementation/runtime dispatch for every deployed CPU.

## Native Node code

At a Node boundary, convert once, run a tight contiguous loop, and return a compact batch.
Use Node-API by default for ABI stability; direct V8 code must be pinned to supported Node
versions and measured against its operational maintenance cost.
