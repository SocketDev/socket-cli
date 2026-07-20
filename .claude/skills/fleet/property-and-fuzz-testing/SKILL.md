---
name: property-and-fuzz-testing
description: Chooses and applies the fleet's three property/fuzz testing tiers — fast-check property tests for pure logic; coverage-guided fuzzing (vitiate for JS, libFuzzer/cargo-fuzz + ASan for native C++/Rust modules) for any untrusted-input boundary; and hand-rolled seeded harnesses for SUT-integration invariants. Use when writing or hardening tests for scripts, parsers, decoders, config/manifest loaders, native addons, or checks/fixers — especially high-blast-radius or memory-unsafe surfaces where an example test misses the edge case that crashes or ships red CI fleet-wide.
---

# Property and fuzz testing

Three tiers, each for a different shape of bug. Pick by what you're testing.

| Testing… | Use | Why |
|---|---|---|
| A **pure function** with an invariant ("always/never") | **fast-check** (Tier 1) | Generated inputs + shrinking to a minimal counterexample |
| **Any untrusted-input boundary** — parser, decoder, config/manifest loader, or **native C++/Rust module** — that must not crash/hang/corrupt on any input | **coverage-guided fuzzing** (Tier 2): vitiate (JS) · libFuzzer/cargo-fuzz+ASan (native) | Finds crash / memory-safety / security inputs with no spec; replayable corpus |
| A **stateful SUT invariant** over synthetic worlds (cascade parity, `check↔fix` idempotence) | **hand-rolled seeded** (Tier 3) | Drives the real SUTs over generated repo trees; deterministic replay |

Property/fuzz tests **complement** example tests — they don't replace them. Keep a few concrete `test('…')` cases as living documentation; add a property test for the "for all inputs" claim.

**fast-check vs vitiate — complementary, not redundant.** fast-check checks *correctness* against a property you write (finds wrong answers); vitiate finds *crashes / memory / security* violations with **no spec**, using coverage feedback to reach deep paths random sampling misses. A function can be crash-free but wrong (fast-check catches) or correct-on-samples but crash on a deep-path input (vitiate catches). Both are **fleet-pinned**: fast-check in the **main** catalog (universal — pure JS, cheap); vitiate in the **optional** catalog (`@vitiate/core` + `vitiate`) — its native `@swc/core`/`@vitiate/engine` install only in a repo that actually fuzzes, so the weight never lands fleet-wide.

## The high-value fleet targets

These are the "a bug here = red CI everywhere" surfaces. Property/fuzz them first:

- **Version + pin math** — `compareSemver`, `extractPinVersion`, `derivePins`, `applyPins` (`sync-package-manager-pins.mts`), `majorBoundedRange`. Properties: total order; `derivePins` always yields a valid `>=x <y`; `applyPins` is idempotent.
- **Config / marker validation** — `readSocketWheelhouseConfig`, `validateBundleBlock`. Property: never throws on arbitrary input; accepts iff genuinely valid.
- **Cascade `check ↔ fix` idempotence** (Tier 3) — for arbitrary synthetic trees: `collectFindings(applyFixes(x))` is clean (a fix never leaves a fixable finding), `applyFixes∘applyFixes = applyFixes`, and a fixer never mutates a path outside its finding's scope.
- **Untrusted-input boundaries (Tier 2)** — sdxgen's manifest/lockfile parsers, ultrathink's `acorn.wasm` JS parser, and node-smol's `smol-manifest` **C++** module. A native module is the top priority — a crafted manifest can overflow/UAF the C++, which a JS-level test never sees — so fuzz the native code directly with libFuzzer/cargo-fuzz + ASan/UBSan, not only through the JS boundary.

## Tier 1 — fast-check (`import fc from 'fast-check'`)

Runs standalone in vitest — no extra binding needed (`@fast-check/vitest`'s `it.prop` is optional sugar we don't take). Pinned in the catalog as `fast-check` (`catalog:`).

```ts
import fc from 'fast-check'
import { expect, test } from 'vitest'
import { compareSemver } from '../../../scripts/fleet/sync-package-manager-pins.mts'

test('compareSemver is antisymmetric', () => {
  const semver = fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99)).map(t => t.join('.'))
  fc.assert(
    fc.property(semver, semver, (a, b) => {
      expect(Math.sign(compareSemver(a, b))).toBe(-Math.sign(compareSemver(b, a)))
    }),
  )
})
```

**The five classical properties** (reach for these before inventing one):
1. **Invariant of the output** — `Math.floor(x)` is always an integer.
2. **Derived from input** — a sorted array holds the same multiset.
3. **Restricted input** — dedup of an already-unique list returns it unchanged.
4. **Round-trip** — `decode(encode(x)) === x`; `unzip(zip(x)) === x`.
5. **Oracle** — the fast impl agrees with a slow reference impl.

**Writing arbitraries** (the part that goes wrong):
- **Construct** values where the outcome is known — don't generate a random input then reimplement the function to predict its output.
- **Don't** cap `maxLength` unless the algorithm requires it — let fast-check explore.
- **Avoid** `.filter()` / `fc.pre()` — use arbitrary options (`fc.string({ minLength: 2 })`) or `.map()` a valid shape instead.
- Use `fc.bigInt()` over `fc.integer()` when the computation can overflow.
- Assert **characteristics** of the result, not the whole return value.
- **Assert in a BLOCK body**: `fc.property(arb, x => { expect(...).toBe(...) })`. An expression-body arrow (`x => expect(...).toBe(...)`) returns the `expect()` result as fast-check's verdict — a silent false-negative. Either throw via `expect` inside `{ }`, or return an explicit boolean.
- Async predicate → `fc.asyncProperty` + `await fc.assert(...)`. Concurrency/races → `fc.scheduler()`.

**Never** depend on `Math.random()` or the system clock inside a property — control randomness through the generator, and mock time (`vi.setSystemTime`).

## Tier 2 — coverage-guided fuzzing (crash · memory-safety · security)

For **any untrusted-input boundary**, not just parsers: decoders, config/manifest loaders, wire-format readers, regex engines (ReDoS), and — highest priority — **native C++/Rust addons**. The contract: "on ANY input, never crash, hang, pollute the prototype, or corrupt memory." Coverage feedback reaches deep-path inputs that random property generation rarely hits.

### JS/TS surface — vitiate

SWC-instrumented, coverage-guided, corpus + auto-minimized crash artifacts replayed as regression tests. The `prototypePollution` detector makes it a security fuzzer, not just a crash fuzzer.

```ts
// test/<name>.fuzz.ts
import { fuzz } from '@vitiate/core'
import { parse, ParseError } from '../src/parser.mts'

fuzz('parse never throws a non-ParseError', (data: Buffer) => {
  try {
    parse(data.toString('utf-8'))
  } catch (e) {
    if (!(e instanceof ParseError)) throw e // any OTHER throw is a crash
  }
})
```

```ts
// vitest.fuzz.config.mts
import { defineConfig } from 'vitest/config'
import { vitiatePlugin } from '@vitiate/core/plugin'
export default defineConfig({
  plugins: [vitiatePlugin({
    instrument: { packages: ['<the-target-pkg>'] },
    fuzz: { fuzzTimeMs: 300_000, stopOnCrash: true, detectors: { prototypePollution: true } },
  })],
  test: { include: ['test/**/*.fuzz.ts'] },
})
```

**Fleet-pinned** in the OPTIONAL catalog (`@vitiate/core` + `vitiate` at `0.3.1`). Adopt it in a repo that fuzzes an input boundary (sdxgen's manifest parsers, ultrathink's `acorn.wasm`) by adding `@vitiate/core` + `vitiate` as `catalog:` devDeps, a `.fuzz` config, and a `test:fuzz` runner — the native engine installs only there, not fleet-wide.

**Pin the exit codes — the default changed.** vitiate `0.4.0` exits **77** on a crash and **70** on a timeout (was `1` in `0.3.1`); both are the libFuzzer standard and settable via `-error_exitcode` / `-timeout_exitcode`. Pass them **explicitly** in the `test:fuzz` runner so behavior is identical across the `0.3.1 → 0.4.0` bump, and have CI read them structurally — `0` = clean, `77` = crash (fail + upload the minimized artifact), `70` = hang, any other non-zero = tool error. **Never** treat `exit 1 = crash found`: it's right on `0.3.1` and silently wrong on `0.4.0`. (The `vitiatePlugin` + `vitest` path sidesteps this — vitest reports pass/fail directly; the exit-code contract is for the `vitiate` CLI / CI path.)

### Native modules (C++/Rust) — libFuzzer / cargo-fuzz + sanitizers

A JS-boundary fuzz is **necessary but not sufficient** for a native addon: vitiate only sees crashes that surface as a JS abort, while a heap overflow / use-after-free in the C++/Rust corrupts silently. Fuzz the native code **directly**:

- **Rust** — `cargo-fuzz` (libFuzzer) + `-Zsanitizer=address` (+ UBSan). The established fleet pattern: `docs/envrypt/fuzzing.md` (committed corpus, ASan smoke in CI).
- **C++ N-API** (node-smol's `smol-manifest`) — an `LLVMFuzzerTestOneInput` harness built with `-fsanitize=address,fuzzer,undefined`, seeded with real manifests; ASan is what catches the overflow the N-API return value hides. Mirror the Rust setup in `docs/envrypt/fuzzing.md`.

For a native parser do **both**: libFuzzer + ASan on the native code (memory safety) **and** a vitiate smoke through the JS surface (the integration contract).

## Tier 3 — hand-rolled seeded harness (dep-0)

The established pattern in `test/repo/integration/cascade-channel-parity.fuzz.test.mts`. Use for **SUT-integration invariants** where the "input" is a synthetic repo tree / manifest and the check is "the real SUTs agree". Deterministic + replayable:

```
FUZZ_SEED=<n> FUZZ_ITERS=<n> pnpm test <the>.fuzz.test.mts
```

Shape: a seeded PRNG builds N synthetic worlds, drives the **real** functions (no mocks of the SUT), asserts the invariant, and **injects each known failure mode** to prove it's caught. A failing seed prints for one-command replay. No external dep — matches the fleet dep budget for the heavy integration case.

## Conventions

- Name property/fuzz files `*.fuzz.test.mts` (Tier 1/3, vitest) or `*.fuzz.ts` (Tier 2, vitiate runner).
- A discovered counterexample becomes a **pinned example test** next to the property (regression + documentation).
- Seed + iteration count are env-overridable (`FUZZ_SEED` / `FUZZ_ITERS`) so CI can widen and a failure replays deterministically.
