---
name: property-and-fuzz-testing
description: Pick a property/fuzz tier + per-language harness (fast-check/vitiate, cargo-fuzz, go test -fuzz, libFuzzer) for parsers, decoders, and native addons — JS/TS, Rust, Go, C++.
---

# Property and fuzz testing

Three tiers, each for a different shape of bug. Pick the tier by what you're
testing, then open the per-language reference for the harness.

| Testing… | Tier | Why |
|---|---|---|
| A **pure function** with an invariant ("always/never") | **property** (Tier 1) | Generated inputs + shrinking to a minimal counterexample |
| **Any untrusted-input boundary** — parser, decoder, config/manifest loader, wire-format reader, or **native C++/Rust module** — that must not crash/hang/corrupt on any input | **coverage-guided fuzzing** (Tier 2) | Finds crash / memory-safety / security inputs with no spec; replayable corpus |
| A **stateful SUT invariant** over synthetic worlds (cascade parity, `check↔fix` idempotence) | **hand-rolled seeded** (Tier 3) | Drives the real SUTs over generated repo trees; deterministic replay |

Property/fuzz tests **complement** example tests — they don't replace them.
Keep a few concrete `test('…')` cases as living documentation; add a property
or fuzz test for the "for all inputs" claim.

**Correctness vs safety are different fuzzers, both wanted.** A property test
checks *correctness* against a property you write (finds wrong answers); a
coverage-guided fuzzer finds *crashes / memory / security* violations with **no
spec**, using coverage feedback to reach deep paths random sampling misses. A
function can be crash-free but wrong (property catches) or correct-on-samples
but crash on a deep-path input (fuzzer catches). For a **native parser do
both**: libFuzzer + ASan on the native code (memory safety) AND a JS-surface
fuzz through the boundary (the integration contract).

## Pick your language

Each reference carries the tool, file layout, run commands, escalation to
stronger engines, and CI/gate wiring for that ecosystem. The Rust lane is the
canonical reference where a surface is implemented in several languages (see
"Lock-step" below).

| Language | Tier 1 (property) | Tier 2 (coverage-guided) | Reference |
|---|---|---|---|
| JS / TS | `fast-check` | `vitiate` (SWC-instrumented) | [references/javascript-typescript.md](references/javascript-typescript.md) |
| Rust | `proptest` / `quickcheck` | `cargo-fuzz` (libFuzzer) + ASan/UBSan | [references/rust.md](references/rust.md) |
| Go | table props / `testing/quick` | `go test -fuzz` (native) | [references/go.md](references/go.md) |
| C++ | assertion harness | libFuzzer + `-fsanitize=address,fuzzer,undefined` | [references/cpp.md](references/cpp.md) |

## The high-value fleet targets

"A bug here = red CI everywhere" surfaces. Property/fuzz them first:

- **Version + pin math** — `compareSemver`, `extractPinVersion`, `derivePins`,
  `applyPins` (`sync-package-manager-pins.mts`), `majorBoundedRange`.
  Properties: total order; `derivePins` always yields a valid `>=x <y`;
  `applyPins` is idempotent.
- **Config / marker validation** — `readSocketWheelhouseConfig`,
  `validateBundleBlock`. Property: never throws on arbitrary input; accepts iff
  genuinely valid.
- **Cascade `check ↔ fix` idempotence** (Tier 3) — for arbitrary synthetic
  trees: `collectFindings(applyFixes(x))` is clean (a fix never leaves a
  fixable finding), `applyFixes∘applyFixes = applyFixes`, and a fixer never
  mutates a path outside its finding's scope.
- **Untrusted-input boundaries (Tier 2)** — sdxgen's manifest/lockfile parsers,
  ultrathink's `acorn` JS/TS parser (every lane), envrypt's `.env` parse
  pipeline + ECIES decrypt, decmpfs's compression reader, and abitious's hybrid
  `.node` reader. A **native module is the top priority** — a crafted input can
  overflow/UAF the C++/Rust, which a JS-level test never sees — so fuzz the
  native code directly with libFuzzer/cargo-fuzz + ASan/UBSan, not only through
  the JS boundary.

## Lock-step (multi-language surfaces)

When ONE surface is implemented in several languages (acorn's parser: Rust /
Go / C++ / TS), the fuzzers are lock-step, exactly like the parsers: **Rust is
the canonical fuzzer and the source of truth; the other lanes are ports.** The
shared contract — corpus format, adversarial dictionary, classification
taxonomy, repro-dump shape — is defined ONCE at the package level and every
lane's harness points at it, so a seed added for one lane is a seed for all.
The reference implementation is `packages/acorn/fuzz/` (the shared substrate)
with per-lane harnesses under `lang/<lang>/fuzz/`. Any accept-here /
reject-there split across lanes is a `divergence` finding, not a silent fixup.

A single-language surface (envrypt, decmpfs, abitious, sdxgen) needs no shared
substrate — its one lane's `fuzz/` tree IS the source of truth.

## Beyond the default engine

The natives above (cargo-fuzz, `go test -fuzz`, libFuzzer) are the right
DEFAULT — lowest friction, lock-step across lanes, replayable corpus. Escalate
only for a proven need; each reference names the concrete tool + when:

- **Continuous fuzzing (biggest lever): ClusterFuzzLite** — runs the SAME
  libFuzzer/AFL++/honggfuzz targets in CI (GitHub Actions) on every PR + a
  batch cron, with corpus accretion, coverage reports, and crash bisection.
  Language-agnostic (C/C++/Rust/Go). This is the upgrade that matters most —
  a fuzzer that runs once in CI finds little; one that runs continuously with a
  growing corpus finds the deep bugs. Adopt it before reaching for a fancier
  local engine.
- **Alternative engines** — AFL++ (better mutators/schedulers, persistent
  mode), Honggfuzz (hardware-feedback), and LLVM **Centipede** (distributed,
  the modern libFuzzer successor) beat libFuzzer on some targets. In Rust,
  **bolero** lets ONE harness run under libFuzzer / AFL++ / honggfuzz / the Kani
  model-checker without a rewrite — the cheapest way to A/B engines.
- **Structure-aware fuzzing** — for grammars/wire formats, mutate the STRUCTURE
  not raw bytes: Rust `arbitrary` (already used), `libprotobuf-mutator` (C++),
  fuzzed-typed Go harnesses. Reaches valid-but-adversarial inputs a byte
  mutator wastes cycles rediscovering.
- **More sanitizers** — ASan (heap/stack), UBSan (UB), MSan (uninitialized
  reads — C++ only, needs an instrumented libc++), TSan (data races). Layer
  ASan+UBSan by default; add MSan/TSan for a specific bug class.

## Conventions (all languages)

- A discovered counterexample becomes a **pinned regression test** (example
  test / committed corpus entry) next to the property — regression +
  documentation.
- **Corpus + dictionary are committed** so a crash is replayable and coverage
  accrues across runs. Seed with real inputs (conformance suites, fixtures).
- Seed + iteration/time budget are env-/flag-overridable so CI can widen and a
  failure replays deterministically (`FUZZ_SEED` / `FUZZ_ITERS` for seeded
  harnesses; `-max_total_time` / `-fuzztime` / `--fuzz-time` for the native
  fuzzers).
- **Read the exit-code contract** in the language reference before wiring CI:
  `0` = clean, a crash code = fail + upload the minimized artifact, a timeout
  code = hang. Never treat "exit 1 = crash found" — the codes are tool- and
  version-specific.
- A fuzzer build/run that can't find its toolchain **reports the exact install
  command and exits non-zero — it never fabricates a pass.**
