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
3. Use PGO only from representative whole-program CPU profiles. Go has NO ergonomic portable
   SIMD: for a genuine hot loop — a lexer scanning identifiers, strings, template bodies, or
   whitespace qualifies, ordinary code does not — hand-write per-arch Plan 9 assembly, amd64
   SSE2/AVX2 and arm64 NEON, behind `golang.org/x/sys/cpu` runtime feature dispatch with a
   `//go:build !amd64 && !arm64` scalar fallback; no cgo, no GOEXPERIMENT. Do NOT raise
   GOAMD64 to v2/v3/v4 for a binary distributed to CPUs you do not control — it raises the
   ISA floor and crashes on older CPUs; a single default v1 binary plus `x/sys/cpu` dispatch
   still uses AVX2 when present and runs everywhere. Pin GOAMD64 only to a floor a controlled
   target guarantees — a homogeneous fleet or a per-ISA build matrix — and record why.
   Enforced by `scripts/fleet/check/build-microarch-is-portable.mts`.
4. Test cancellation, backpressure, and races after concurrency changes.
5. Keep the change only when CPU, allocations, GC work, peak heap, and tail latency improve
   on the same workload.
