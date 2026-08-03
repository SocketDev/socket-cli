# C++ fuzz

C++ has no fleet property-testing tier — memory safety is the whole point, so
go straight to Tier 2 — a coverage-guided harness under sanitizers. This is the
**top-priority** kind of fuzzing: a heap overflow / use-after-free in a native
module corrupts silently and never surfaces through a JS-boundary test.

## Tier 2 — libFuzzer + ASan/UBSan

Reference: `packages/acorn/lang/cpp/fuzz/` (lock-step port of the Rust reference
lane — targets `parse`, `parse_to_json`, `ast_cache`, reading the shared
substrate at `packages/acorn/fuzz/`).

### A harness

```cpp
// fuzz/fuzz_targets/parse.cc
#include <cstddef>
#include <cstdint>
#include "acorn/parser.h"   // the untrusted-input entry

// Contract: on ANY bytes, never crash / overflow / UAF / hang. Strict UTF-8
// decode on the boundary (report a parse error on failure; do NOT lossily
// replace — that masks a cross-lane divergence). A clean parse error is a
// NON-finding.
extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    acorn::parse(reinterpret_cast<const char *>(data), size);
    return 0;
}
```

### Build (the toolchain gotcha)

Compile + link with sanitizers + the fuzzer runtime:

```
-fsanitize=address,fuzzer,undefined -g -O1
```

**Apple's Xcode Clang has NO libFuzzer runtime** (`libclang_rt.fuzzer_osx.a`) —
`-fsanitize=fuzzer` fails at LINK time. Use a full LLVM instead:

```bash
brew install llvm            # macOS — versionless keg first
apt install clang lld        # Linux — compiler-rt bundles libFuzzer
```

The build must use its OWN isolated output dir (a sanitized `libacorn.a` mixed
with a non-sanitized one in the same dir corrupts both). acorn wires this as a
CMake `option(BUILD_FUZZER … OFF)` that repoints `OUTPUT_BASE` to
`build/fuzzer/<arch>/`, driven by `scripts/fuzz.mts` (`cmake-config.mts`
`detectFuzzerCompiler`), which probes candidate compilers by actually compiling
+ linking a trivial `LLVMFuzzerTestOneInput` TU and uses the first that links.
Set `ACORN_FUZZER_CXX=/path/to/clang++` to override. When no working compiler
is found it reports `smoke-blocked: libFuzzer-capable clang++ absent` with the
install command and **exits non-zero — never a fabricated pass.**

### Run

```bash
node scripts/fuzz.mts <target> [-max_total_time=<s>]   # never hand-invoke the binary
```

Seed from the shared committed corpus; pass `-dict=<pkg>/fuzz/dict/*.dict`,
`-max_len`, and (for the ~10× ASan slowdown) a raised `-timeout` /
`-rss_limit_mb`, exactly as the Rust `run.sh` does.

### Sanitizer matrix

- **ASan + UBSan** — default (heap/stack overflow, UAF, undefined behavior).
- **MSan** (uninitialized reads) — C++-specific; needs an MSan-instrumented
  libc++, so a separate build. Add it for a bug class ASan can't see (reading
  uninitialized parser state), not by default.
- **TSan** — only if the native module is multi-threaded.

## Escalation

- **ClusterFuzzLite** — the biggest lever: runs these same libFuzzer targets in
  CI continuously with corpus accretion + coverage + bisection. Language-
  agnostic; the C++ + Rust lanes share the runner.
- **AFL++ / Honggfuzz / LLVM Centipede** — stronger mutators/schedulers than
  libFuzzer on some targets; Centipede is the modern distributed successor.
  Build the same `LLVMFuzzerTestOneInput` TU against them (all accept the
  libFuzzer entry-point ABI).
- **libprotobuf-mutator** — structure-aware mutation for a protobuf/structured
  wire format, so the fuzzer spends cycles on valid-but-adversarial messages
  instead of rediscovering the framing.
