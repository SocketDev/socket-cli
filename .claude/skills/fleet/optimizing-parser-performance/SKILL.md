---
name: optimizing-parser-performance
description: Audits parser and tokenizer performance.
---

# Optimizing Parser Performance

Profile release-like parsing against representative valid, malformed, small, large, ASCII,
and Unicode corpora. Preserve grammar behavior, diagnostics, source locations, and resource
limits.

1. Read the shared [parser data-oriented design audit](../optimizing-performance/references/parser-data-oriented-design.md).
2. Scan for copied token text, allocation per node/token, pointer-rich ASTs, scattered
   passes, generic Unicode work in ASCII-heavy scans, and JS/native/Wasm crossings per item.
3. Change one causal storage or scan-loop cost at a time; define ownership, offsets, and
   overflow behavior before compacting data.
4. Re-measure CPU, allocations, peak memory, startup, and throughput; test malformed and
   deeply nested input alongside the common corpus.

Use [optimizing-compiler-performance](../optimizing-compiler-performance/SKILL.md) only for
a profile-proven codegen issue.
