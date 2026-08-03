# Compiler and codegen audit

Use this after a profile identifies CPU in generated code, instruction-cache pressure, a
predictably cold error path, or an inlining/layout opportunity. Start with a release-like
build and a representative profile; compiler hints encode claims that must stay true.

## Audit checklist

1. Capture the exact compiler/runtime version, target triple/architecture, optimization
   flags, linker, and deployed CPU baseline.
2. Check the generated artifact only after profiling: symbols/assembly explain a result;
   they do not establish that it matters end-to-end.
3. Prefer profile-guided layout and inlining over manual branch predictions. Validate
   code size, startup time, and cold-path latency as well as the hot metric.
4. Keep CPU-specific dispatch behind runtime feature detection or publish per-target
   artifacts. Never ship a binary that can execute unsupported instructions.

## Language-specific levers

| Runtime | Measured levers | Audit cautions |
| --- | --- | --- |
| Rust/LLVM | release profile, `-C lto=thin`, codegen units, instrumentation PGO, narrowly true `#[cold]`, per-function `target_feature` | LTO increases link time; target features can create illegal instructions; `#[inline]` may grow code |
| Go | CPU pprof-driven PGO, compiler diagnostics, release build | PGO profile must represent the deployed workload; inspect allocations/GC and contention too |
| C++/Clang | `-O2`/`-O3` comparison, ThinLTO, instrumented or sample PGO, narrowly portable visibility and cold annotations | `[[likely]]`, `[[unlikely]]`, and vendor attributes can be wrong or nonportable; PGO should supersede guesses |
| JS/V8 | stable object shapes and call sites, warmup-aware benchmarks, current Node/V8 version | do not depend on undocumented optimization tiers or engine flags in production |

## Hot/cold paths

Move genuinely exceptional formatting, allocation-heavy diagnostics, and recovery out of
the common parse/scan loop. A `cold` annotation is appropriate only when telemetry or a
representative profile proves rarity; it is not a way to make a function fast. Keep error
semantics and observability intact.

## PGO and LTO

PGO is a closed-loop deployment practice: build a baseline, collect representative
profiles, rebuild, then measure the same workloads. Rust's PGO uses LLVM instrumentation;
Go consumes CPU pprof profiles; Clang supports instrumented and sampled profiles. Treat
profiles as build inputs with their workload, date, and target recorded. Compare PGO and
non-PGO artifacts because stale or skewed profiles can shift code size and cold behavior.

ThinLTO is usually the first whole-program experiment for larger Rust/C++ builds because
it can expose cross-module optimization at lower link-time cost than full LTO. Keep it
only if the deployed metric benefits enough to pay its build and debugging cost.


## Sources

- [Rust codegen options](https://doc.rust-lang.org/rustc/codegen-options/index.html)
- [Rust PGO](https://doc.rust-lang.org/rustc/profile-guided-optimization.html)
- [Rust `cold` attribute](https://doc.rust-lang.org/reference/attributes/codegen.html)
- [Go PGO](https://go.dev/doc/pgo)
- [Clang PGO](https://clang.llvm.org/docs/UsersManual.html#profile-guided-optimization)
- [Clang ThinLTO](https://clang.llvm.org/docs/ThinLTO.html)
- [Clang `cold` attribute](https://clang.llvm.org/docs/AttributeReference.html#cold)
