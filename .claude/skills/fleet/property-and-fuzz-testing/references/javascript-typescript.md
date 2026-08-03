# JS / TS property + fuzz

## Tier 1 — fast-check (`import fc from 'fast-check'`)

Runs standalone in vitest — no extra binding needed (`@fast-check/vitest`'s
`it.prop` is optional sugar we don't take). Pinned in the MAIN catalog as
`fast-check` (`catalog:`) — universal, pure JS, cheap.

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

**Writing arbitraries** — the part that goes wrong:
- **Construct** values where the outcome is known — don't generate a random
  input then reimplement the function to predict its output.
- **Don't** cap `maxLength` unless the algorithm requires it — let fast-check explore.
- **Avoid** `.filter()` / `fc.pre()` — use arbitrary options
  (`fc.string({ minLength: 2 })`) or `.map()` a valid shape instead.
- Use `fc.bigInt()` over `fc.integer()` when the computation can overflow.
- Assert **characteristics** of the result, not the whole return value.
- **Assert in a BLOCK body**: `fc.property(arb, x => { expect(...).toBe(...) })`.
  An expression-body arrow (`x => expect(...).toBe(...)`) returns the `expect()`
  result as fast-check's verdict — a silent false-negative. Either throw via
  `expect` inside `{ }`, or return an explicit boolean.
- Async predicate → `fc.asyncProperty` + `await fc.assert(...)`.
  Concurrency/races → `fc.scheduler()`.

**Never** depend on `Math.random()` or the system clock inside a property —
control randomness through the generator, and mock time (`vi.setSystemTime`).

## Tier 2 — vitiate (crash · memory-safety · security)

SWC-instrumented, coverage-guided, corpus + auto-minimized crash artifacts
replayed as regression tests. The `prototypePollution` detector makes it a
security fuzzer, not just a crash fuzzer.

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

The config is a repo-**ROOT** `vitest.config.mts` carrying the `vitiatePlugin`.
Instrument this repo's OWN src via `instrument: { include: [...] }` (targets
import `src/` directly) — `instrument.packages` is ONLY for node_modules
dependency instrumentation and never sees local relative src.

```ts
// vitest.config.mts — repo ROOT, NOT a custom name (see WHY below)
import { defineConfig } from 'vitest/config'
import { vitiatePlugin } from '@vitiate/core/plugin'

// Non-`VITIATE_`-prefixed so vitiate's warnUnknownVitiateEnvVars() stays quiet.
const FUZZ_TIME_MS = Number(process.env['FUZZ_TIME_MS']) || 15_000

export default defineConfig({
  plugins: [vitiatePlugin({
    instrument: { include: ['src/**/*.ts', 'src/**/*.mts'] },
    fuzz: { fuzzTimeMs: FUZZ_TIME_MS, stopOnCrash: true, detectors: { prototypePollution: true } },
  })],
  test: { include: ['test/**/*.fuzz.ts'] },
})
```

**Why ROOT, not a custom `vitest.fuzz.config.mts`.** vitiate's fuzz supervisor
runs inside a vitest worker and re-spawns `vitest run` for the coverage-guided
child WITHOUT forwarding `--config` (its `getConfigFile()` is populated only in
the MAIN process). The child therefore falls back to vitest's config
auto-discovery, which only finds a config at the repo-**root** name. A
custom-named config the child can't see → it loads vitest defaults and dies with
"No test files found" / "coverage map not initialized". The root config re-runs
the plugin's `config` hook in the child, injecting `@vitiate/core/setup` (the
shared-memory coverage map) and the SWC instrument transform.

> **WARNING — a root `vitest.config.mts` is safe ONLY behind
> `.config/repo/vitest.config.mts`.** A root config would otherwise hijack the
> WHOLE test suite, loading the SWC-instrumenting plugin on every run. It's safe
> in socket-lib because `pnpm test` (`scripts/fleet/test.mts`) passes `--config
> .config/repo/vitest.config.mts` explicitly whenever that file exists, so the
> normal suite never loads the root config or the plugin. A repo WITHOUT
> `.config/repo/vitest.config.mts` (whose `pnpm test` auto-discovers the root)
> must NOT use this pattern — it needs a bespoke `VITIATE_FUZZ`-gated setup
> instead.

**Runner** — `scripts/repo/fuzz.mts` (`pnpm run test:fuzz`) resolves the repo's
`vitest` bin and runs `vitest run` with `VITIATE_FUZZ=1` and NO `--config`, so
the parent run and the re-spawned coverage-guided child agree via auto-discovery
on the same root config. Budget via `FUZZ_TIME_MS` (default 15s; CI raises it).
Without `VITIATE_FUZZ` the `fuzz()` targets replay the committed seed corpus as
fast regression checks. Reference implementation: **socket-lib**
(`vitest.config.mts` + `scripts/repo/fuzz.mts`, commit `8e3fd0a6`).

**Fleet-pinned** in the OPTIONAL catalog (`@vitiate/core` + `vitiate`, latest
published `0.3.1`). Its native `@swc/core`/`@vitiate/engine` install only in a
repo that actually fuzzes, so the weight never lands fleet-wide. Adopt it in a
repo that fuzzes an input boundary (sdxgen's manifest parsers, ultrathink's
`acorn` JS surface) by adding `@vitiate/core` + `vitiate` as `catalog:` devDeps,
the root `vitest.config.mts` above (behind `.config/repo/vitest.config.mts`),
and a `scripts/repo/fuzz.mts` `test:fuzz` runner.

**Exit codes (forward-looking — `0.4.0` is NOT published yet; latest is
`0.3.1`, exit `1`).** When `0.4.0` ships it is expected to exit **77** on a crash
and **70** on a timeout (both libFuzzer standard, settable via `-error_exitcode`
/ `-timeout_exitcode`). A path that shells the `vitiate` CLI directly should
then pass them **explicitly** and read them structurally — `0` = clean, `77` =
crash (fail + upload the minimized artifact), `70` = hang, any other non-zero =
tool error — and **never** treat `exit 1 = crash found`. The `vitiatePlugin` +
`vitest` path above sidesteps this entirely: vitest reports pass/fail directly,
so the CLI exit-code contract is a separate concern.

**Native addon caveat:** a JS-boundary vitiate fuzz is necessary but NOT
sufficient for a C++/Rust addon — vitiate only sees crashes that surface as a
JS abort, while a heap overflow / UAF in the native code corrupts silently.
Fuzz the native code directly too (see [rust.md](rust.md) / [cpp.md](cpp.md)).

## Tier 3 — hand-rolled seeded harness (dep-0)

The established pattern in
`test/repo/integration/cascade-channel-parity.fuzz.test.mts`. Use for
**SUT-integration invariants** where the "input" is a synthetic repo tree /
manifest and the check is "the real SUTs agree". Deterministic + replayable:

```
FUZZ_SEED=<n> FUZZ_ITERS=<n> pnpm test <the>.fuzz.test.mts
```

Shape: a seeded PRNG builds N synthetic worlds, drives the **real** functions
(no mocks of the SUT), asserts the invariant, and **injects each known failure
mode** to prove it's caught. A failing seed prints for one-command replay. No
external dep — matches the fleet dep budget for the heavy integration case.

## Conventions

- Name property/fuzz files `*.fuzz.test.mts` (Tier 1/3, vitest) or `*.fuzz.ts`
  (Tier 2, vitiate runner).
- A discovered counterexample becomes a **pinned example test** next to the
  property (regression + documentation).
