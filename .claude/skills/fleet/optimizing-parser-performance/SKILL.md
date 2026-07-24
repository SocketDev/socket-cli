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

## SIMD scan loops

A lexer scanning identifiers, strings, template bodies, or whitespace is the case that pays
off for hand SIMD — the optimizer will not autovectorize a data-dependent find-first-of-a-
byte-set scan, so reach for explicit SIMD or a `memchr`-family primitive. Portable SIMD is
runtime CPU dispatch; do not ship `-C target-cpu=native` or `GOAMD64=v2|v3|v4` in a build
distributed to CPUs you do not control. Pin only to a floor a controlled target guarantees,
and record why, enforced by `scripts/fleet/check/build-microarch-is-portable.mts`.

- **The kernel is compare-and-reduce.** Load a 16/32-byte chunk, run the class compares,
  OR the class masks, extract to a scalar bitmask, find the first boundary with a
  count-trailing-zeros — or NOT then count for the first NON-member — then a scalar tail
  handles the sub-stride remainder.
- **Byte-identical or it does not ship.** A SIMD scan must match its scalar reference
  exactly: ship a SIMD-vs-scalar differential test plus an exhaustive delimiter-at-every-
  offset-across-the-stride test, and validate end to end.
- **The SIMD candidate byte set must match its OWN scalar path exactly.** It may be a
  SUPERSET of a sister port's set when this port carries extra semantics — e.g. a Go
  `readString` scanning `0xE2` for U+2028/U+2029 handling that the Rust and C++ ports omit.
  Correctness beats cross-port delimiter symmetry.
- **Make it real and wire it in.** An unrolled scalar loop with a per-byte call is NOT SIMD;
  a SIMD helper with no non-test caller is dead code. A shipped SIMD function must be a real
  vector kernel AND live on the hot path — prefer whatever the sister ports do, in lock-step.
- **Measured payoff shape.** The acorn-lang Go work landed 1.5-2.4x end-to-end lexer
  throughput on string/template-dense JS, ~16x on isolated micro-scans, allocation-neutral.
  Language mechanics: [Rust](../optimizing-rust-performance/SKILL.md),
  [Go](../optimizing-go-performance/SKILL.md), [C++](../optimizing-cpp-performance/SKILL.md).
