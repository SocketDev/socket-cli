---
name: optimizing-performance
description: Audits performance in Rust, Go, C++, JS/TS, parsers, Node addons, and WebAssembly.
---

# Optimizing Performance

Treat performance as a measured property of a representative workload. A fast-looking
rewrite, compiler attribute, native addon, or WebAssembly feature is not an optimization
until it improves the target metric without breaking correctness, portability, or memory
limits.

## Workflow

1. Define the workload and success metric: p50/p99 latency, throughput, startup time,
   binary size, peak RSS, allocations, or GC work. Record machine, runtime/compiler,
   build mode, input mix, and baseline.
2. Profile the release-like artifact. Classify the bottleneck as algorithmic, allocation/
   memory, parser/data layout, compiler/codegen, runtime boundary, concurrency, or I/O.
3. Read the matching reference before proposing a change. Use the language reference for
   implementation scans; use the compiler reference only for a measured hot/cold or
   build-pipeline issue.
4. Make one causal change. Preserve public behavior, error handling, portability targets,
   and memory ownership. Add a fallback whenever a target capability is optional.
5. Re-run the identical benchmark and correctness suite. Report the delta, variance,
   memory/allocation effect, build/startup effect, and remaining uncertainty.

## Expert audit lenses

| Situation | Read first | Look for |
| --- | --- | --- |
| Compiler, hot/cold paths, inlining, PGO/LTO | [compiler](references/compiler.md) | release mode, representative profiles, code-size and portability trade-offs |
| Parser or tokenizer | [parser data-oriented design](references/parser-data-oriented-design.md) | copied text, pointer-rich ASTs, allocation per token/node, scattered passes |
| `.node` addon or JS/native boundary | [Node native boundaries](references/node-native-boundaries.md) | startup/load time, value conversion, copies, tiny calls, blocking event loop |
| Wasm or worker/shared memory | [WebAssembly capabilities](references/webassembly-capabilities.md) | artifact probes, feature variants, transfer/share ownership, boundary batching |
| Rust | [Rust](references/rust.md) | cloning, growth reallocations, iterator/code-size balance, release profile |
| Go | [Go](references/go.md) | allocs/op, escape, slice/map growth, GC, contention, pprof |
| C++ | [C++](references/cpp.md) | allocation/indirection, aliasing/lifetime, virtual dispatch, build flags |
| JavaScript or TypeScript | [JavaScript/TypeScript](references/javascript-typescript.md) | allocation churn, object-shape instability, deopts, string/UTF work, crossings |

## Required report shape

For every kept optimization, state:

- **Evidence:** profiler/benchmark artifact and the representative workload.
- **Cause:** the concrete cost and why the change reaches it.
- **Trade-offs:** code size, build time, memory, portability, maintenance, and tail latency.
- **Safety:** correctness tests, ownership/lifetime rule, and capability fallback where needed.
- **Result:** before/after values with enough repetitions to distinguish noise.

## Guardrails

- Never enable CPU features, PGO, LTO, unsafe code, pooling, SIMD, a compiler hint, or a
  Wasm proposal globally because it sounds faster; scope and measure it.
- Do not benchmark debug artifacts, cold one-shot runs when steady state matters, or a
  microbenchmark as a substitute for a production parser/service workload.
- Do not cross JS/native/Wasm boundaries per token, AST node, or byte when a batch or
  typed buffer can express the same work.
- Keep a portable baseline for a distributable. `target-cpu=native` and experimental host
  features are not a distributable default.

## Portable SIMD

Portable SIMD is RUNTIME CPU DISPATCH: one binary detects the CPU at run time and uses
AVX2/NEON when present, scalar/SSE2 otherwise. This is the only way a distributed SIMD path
both goes fast on new CPUs and runs at all on old ones.

- **Match the microarch pin to who controls the target.** Distributed to CPUs you do NOT
  control — published npm natives, downloadable CLIs, release artifacts — must NOT pin above
  the minimum supported microarch: no `-C target-cpu=native`, no baseline
  `-C target-feature=+avx2`, no `GOAMD64=v2|v3|v4`, each bakes in the build machine's ISA and
  SIGILLs on older CPUs. Use runtime dispatch instead. A CONTROLLED target — a homogeneous
  fleet, a constrained container, a per-microarch build matrix with a selecting loader, or a
  local build where build host == run host — MAY pin to the guaranteed floor, never to
  `native` on a random build box, and records why. Enforced by
  `scripts/fleet/check/build-microarch-is-portable.mts`; a pin passes when annotated
  `# microarch-pin: local-profiling | removable: YYYY-MM-DD` or
  `# microarch-pin: controlled-target - <justification>`.
- **The scan kernel is compare-and-reduce.** Load a 16/32-byte chunk, run class compares,
  OR the class masks, extract to a scalar bitmask, find the first boundary with a
  count-trailing-zeros, then a scalar tail handles the sub-stride remainder.
- **Correctness is sacred.** A SIMD path must be byte-identical to its scalar reference —
  ship a SIMD-vs-scalar differential test plus an exhaustive delimiter-at-every-offset test,
  and validate end to end.
- **The optimizer will not autovectorize a data-dependent scan.** Compilers autovec simple
  counted loops over contiguous numeric slices, not find-first-of-a-byte-set scans; those
  need explicit SIMD or a `memchr`-family primitive. Profile first; measure in release only.
- Language mechanics live in [Rust](../optimizing-rust-performance/SKILL.md),
  [Go](../optimizing-go-performance/SKILL.md), and
  [C++](../optimizing-cpp-performance/SKILL.md); lexer/scan specifics in
  [parser performance](../optimizing-parser-performance/SKILL.md).
