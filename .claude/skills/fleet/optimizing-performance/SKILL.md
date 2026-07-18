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
- Keep a portable baseline. `target-cpu=native` and experimental host features are not a
  distributable default.
