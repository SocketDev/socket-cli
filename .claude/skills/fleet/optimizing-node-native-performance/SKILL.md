---
name: optimizing-node-native-performance
description: Audits Node addon and native-boundary performance.
---

# Optimizing Node Native Performance

Measure module startup/import separately from steady state, and identify conversion, copy,
boundary, queueing, or native-loop cost before adopting a `.node` addon or changing one.

1. Read the shared [Node native-boundary audit](../optimizing-performance/references/node-native-boundaries.md).
2. Batch data into typed buffers or a versioned compact layout; do not cross the boundary
   per character, token, AST node, callback, or tiny result.
3. Use Node-API by default for ABI stability. Treat direct V8 fast APIs as version-specific
   experiments with a supported fallback.
4. Define ownership/finalization for every externally backed buffer and test Worker cleanup.
5. Preserve event-loop responsiveness and compare the end-to-end JS baseline.

For Wasm memory and feature variants, use
[optimizing-webassembly-performance](../optimizing-webassembly-performance/SKILL.md).
