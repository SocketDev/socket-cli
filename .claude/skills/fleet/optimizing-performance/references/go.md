# Go performance audit

Start with `go test -bench` plus `-benchmem`; then use CPU, heap/allocation, block, mutex,
and execution traces as the symptom requires. Scan for `fmt`, `string([]byte)`, conversion
loops, append growth, interface/reflection paths, map churn, goroutine-per-item work,
channel contention, and `sync.Pool` used as a default cache.

## High-value checks

- Pre-size slices/maps from conservative measured bounds; reuse buffers only with ownership
  discipline and bounded retained capacity.
- Parse bytes with offsets and delay string conversion. Avoid retaining a giant source buffer
  through a few small slices when lifetime/peak heap matters.
- Check escape analysis to explain an allocation, then use benchmark evidence before changing
  an API solely to alter escape behavior.
- Keep the common parser path allocation-free where practical; reserve formatting, wrapping,
  and rich errors for failure paths.
- Use `sync.Pool` only for high-churn, safely reset objects with an observed allocation/GC
  bottleneck. It is not an ownership mechanism and pooled contents can be discarded.
- Use CPU-profile-driven PGO from representative production/whole-program workload, not an
  isolated microbenchmark. Compare build time and binary size as PGO can increase inlining.

## Concurrency

Workers help CPU-bound independent chunks, not I/O-bound work already handled by the
runtime. Measure channel traffic, scheduling, and contention before adding goroutines;
use the race detector and cancellation/backpressure tests for every redesign.
