---
name: optimizing-go-performance
description: Audits measured Go performance.
---

# Optimizing Go Performance

Use `-benchmem` and the relevant pprof/trace evidence before changing allocations,
concurrency, pooling, or an API for escape behavior.

1. Read [Go performance audit](../optimizing-performance/references/go.md).
2. Scan for conversion loops, `fmt`, append/map growth, interface/reflection paths,
   goroutine-per-item work, channel contention, and default-use `sync.Pool`.
3. Use PGO only from representative whole-program CPU profiles.
4. Test cancellation, backpressure, and races after concurrency changes.
5. Keep the change only when CPU, allocations, GC work, peak heap, and tail latency improve
   on the same workload.
