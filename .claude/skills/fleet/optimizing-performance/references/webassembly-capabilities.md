# WebAssembly capability audit

Ship a baseline module first. Use a newer Wasm feature only when the exact compiled
artifact successfully validates and instantiates on every declared runtime/version, and
when a measured workload benefits. Feature tables change faster than deployed runtimes.

## Capability-gated variants

1. Build a portable baseline (bulk memory/SIMD only where the support policy allows).
2. Compile each feature variant with the intended toolchain and flags.
3. At install/CI time, validate and instantiate the actual bytes on the supported Node,
   browser, and embedding versions—not merely `typeof WebAssembly`.
4. Choose a variant through a small probe, cache the outcome, and retain the baseline
   fallback. Test feature and fallback paths for identical results.

Do not enable a proposal merely because a current Node release supports it. The package may
run on a different Node line, Electron, serverless platform, browser, or Wasm engine.

## Shared memory and workers

Node workers can transfer `ArrayBuffer` instances or share `SharedArrayBuffer` instances.
For threaded Wasm, use a `WebAssembly.Memory` created with `shared: true` and an explicit
maximum, compile the module for threads/atomics, and design synchronization before sharing
data. Shared memory does not make a parser automatically parallel: partition independent
work, use atomics only for necessary coordination, avoid false sharing, and measure
contention and queueing.

Growing Wasm memory can replace its backing buffer view. Recreate cached typed-array views
after growth, bound maximum memory, and define a binary-layout version. Prefer offsets and
lengths over host pointers.

## Interop performance

- Batch exported calls; crossing JS/Wasm for every character or AST node usually dominates.
- Pass bytes and numeric offsets in linear memory; avoid repeatedly encoding strings.
- Reuse initialized modules/instances where isolation permits, but measure startup and
  retained memory separately.
- Use memory64, multiple memories, GC, stack switching, or other late features only with
  a deployed-host matrix and a baseline fallback. Toolchain availability is not host support.

## Sources

- [WebAssembly feature status](https://webassembly.org/features/)
- [WebAssembly JS API and linear memory](https://webassembly.org/getting-started/js-api/)
- [Node worker threads](https://nodejs.org/api/worker_threads.html)
