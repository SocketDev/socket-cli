---
name: optimizing-memory-performance
description: Audits measured memory and allocation performance.
---

# Optimizing Memory Performance

Separate allocation rate, allocation bytes, retained heap/RSS, locality, and peak memory.
An optimization that removes allocations but retains an oversized arena or buffer can lose.

1. Read [memory audit](../optimizing-performance/references/memory.md) and, for parsers,
   [parser data-oriented design](../optimizing-performance/references/parser-data-oriented-design.md).
2. Scan for unbounded capacity growth, copied text, per-item allocation, retained source
   buffers, pointer-rich structures, object-per-token records, and pools without ownership.
3. Establish capacity bounds and reset/eviction rules before adding reuse, arenas, pools, or
   interning.
4. Benchmark allocation count/bytes, peak RSS/heap, GC/allocator time, locality-sensitive
   throughput, and tiny-input startup separately.
