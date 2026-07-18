---
name: optimizing-javascript-performance
description: Audits measured JavaScript and TypeScript performance.
---

# Optimizing JavaScript Performance

Profile the deployed Node/browser version after warmup. TypeScript types are erased, so
measure the emitted JavaScript, engine allocation/GC behavior, and host-boundary cost.

1. Read [JavaScript/TypeScript performance audit](../optimizing-performance/references/javascript-typescript.md).
2. Scan for per-item allocation, unstable record shapes, polymorphic call sites, callback or
   Promise churn, intermediate arrays/strings, regex/UTF work, and per-item native/Wasm calls.
3. Keep V8-friendly layouts as readable data design, not reliance on undocumented engine
   tiers or production-only flags.
4. Re-run corpus, Unicode/error, startup, heap, GC, and tail-latency measurements on every
   supported Node/V8 line affected.
