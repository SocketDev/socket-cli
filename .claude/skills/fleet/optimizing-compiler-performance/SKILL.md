---
name: optimizing-compiler-performance
description: Audits compiler and codegen performance.
---

# Optimizing Compiler Performance

Use only after profiling identifies generated-code cost. Record the release artifact,
compiler/runtime version, target, workload, baseline, and before/after result.

1. Read the shared [compiler/codegen audit](../optimizing-performance/references/compiler.md).
2. Prefer representative PGO evidence over manually guessed branch or inlining hints.
3. Scope LTO, target features, cold annotations, and CPU dispatch to supported targets.
4. Compare code size, build time, startup, peak memory, and tail latency as well as the
   selected hot metric.
5. Keep the change only when correctness tests and the same representative benchmark pass.

For parser layout, use [optimizing-parser-performance](../optimizing-parser-performance/SKILL.md).
