# Node native-boundary audit

A `.node` addon or Wasm module is worthwhile only when its total load, conversion,
crossing, scheduling, and memory-management cost beats the best JavaScript path for the
real workload. Measure startup/import and steady-state calls separately.

## Scan for these costs

- `require()`/dynamic loading in latency-sensitive startup; lazy-load only when it moves
  work off the critical path and does not create a later tail-latency cliff.
- per-token or per-node JS ↔ native calls, `napi_get_value_*` conversions, object creation,
  callbacks, exceptions, and Promise churn; batch records into typed buffers or a compact
  wire format.
- copies between `Buffer`, `ArrayBuffer`, typed arrays, native vectors, and Wasm memory;
  define who owns each buffer and use views or transfer where lifetime rules permit.
- blocking parsing/CPU work on the event loop; use workers/native async work only when
  queueing, serialization, and synchronization costs are measured and bounded.
- native module global state that is unsafe across Node environments or Workers.

## Implementation choices

- Prefer Node-API for addons that need ABI stability across Node majors. Direct V8/libuv/
  Node APIs trade that stability for tighter coupling and must be version-pinned, tested,
  and justified by a measured boundary cost.
- Prefer `TypedArray`/`ArrayBuffer` views for bulk numeric or byte data. External buffers
  can avoid a copy, but require a precise finalizer/lifetime contract and are not supported
  by every Node-API runtime.
- Use one bulk parse/transform call plus result tables over a callback for every AST node.
  A native fast path must preserve a JS fallback and the same observable errors.
- Make addons Node-API or context-aware before loading them from Workers; release
  per-environment resources on shutdown.

## C++ for Node fast paths

Keep argument validation at the boundary, turn values into compact native inputs once,
run a contiguous native loop, and materialize JS values in batches. Do not expose raw
pointers to GC-managed storage beyond their documented lifetime. Avoid blocking I/O or
long CPU work on the main event loop.

V8 Fast API calls and other direct V8 techniques are embedder/version-specific. Treat
them as an optional, supported-Node-only experiment with a conventional Node-API/JS
fallback; do not describe them as a portable `.node` addon default.

## Sources

- [Node-API and ABI stability](https://nodejs.org/api/n-api.html)
- [Node C++ addons](https://nodejs.org/api/addons.html)
- [Node worker threads](https://nodejs.org/api/worker_threads.html)
- [V8 public API stability](https://v8.dev/docs/api)
