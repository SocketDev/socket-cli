---
name: optimizing-webassembly-performance
description: Audits WebAssembly performance and capability fallbacks.
---

# Optimizing WebAssembly Performance

Start from a portable baseline module. A current Node/V8 capability is not a fleet support
guarantee: validate and instantiate the exact artifact on every supported host/version.

1. Read the shared [WebAssembly capability audit](../optimizing-performance/references/webassembly-capabilities.md).
2. Batch JS/Wasm work, pass bytes plus offsets, and separately measure compile, instantiate,
   load, crossing, execution, and retained-memory cost.
3. For shared memory, require an explicit maximum, correct atomics/thread toolchain, a
   synchronization design, and a non-threaded fallback.
4. Recreate typed-array views after memory growth and version cross-language layouts.
5. Keep late Wasm features behind a compile/instantiate probe and baseline variant.

For parser representation, use [optimizing-parser-performance](../optimizing-parser-performance/SKILL.md).
