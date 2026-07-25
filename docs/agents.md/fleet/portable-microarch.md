# Portable microarch: match the pin to who controls the target

The axis is WHO CONTROLS THE TARGET, not "never pin". A build distributed to
CPUs you do not control must run on every CPU in its class, not just the one
that built it. Portable SIMD is RUNTIME CPU DISPATCH: one binary detects the CPU
at run time and uses AVX2/NEON when present, scalar/SSE2 otherwise. Baking the
build machine's instruction set into a distributed artifact instead makes it
SIGILL on any older CPU that lacks those instructions. A CONTROLLED target,
where you know the hardware the binary will run on, may pin to that hardware's
guaranteed floor.

## The rule

Portable by default via runtime dispatch; pin only to a floor your deployment
guarantees.

- **Distributed to CPUs you do NOT control** — published npm natives,
  downloadable CLIs, release artifacts — do NOT pin above the minimum supported
  microarch. `-C target-cpu=native`, a baseline `-C target-feature=+avx2`-style
  ISA pin, a raised `GOAMD64=v2|v3|v4`, or a baseline `-march` each bakes in the
  build host ISA and SIGILLs on older CPUs. Use `is_x86_feature_detected!` /
  `golang.org/x/sys/cpu` runtime dispatch, `std::simd`, the `wide` crate, or the
  SIMD-accelerated `memchr` family so one binary lights up AVX2/NEON when
  present. Portable, non-microarch features like `+crt-static` are fine.
- **Controlled target — pinning is legitimate and a real win.** A homogeneous
  datacenter fleet, a container constrained to known hardware, a per-microarch
  build matrix that emits one artifact per ISA level with a loader that selects
  at install or run time, or a local build where build host == run host. Pin to
  the GUARANTEED FLOOR of the target, never to `native` on a random build box,
  and record why.

## The exception annotations

The gate reads two annotation shapes, mirroring the soak-exclude convention: a
temporary pin carries a removable date, standing trust does not. Put the marker
as a trailing comment OR on the line directly above the pin.

Temporary local flamegraph or micro-bench pin — optimizer-off, host-tuned
numbers — needs a sunset date:

```toml
# microarch-pin: local-profiling | removable: 2026-12-31
rustflags = ["-Ctarget-cpu=native"]
```

Standing pin for a controlled target needs a non-empty justification, no date:

```toml
# microarch-pin: controlled-target - homogeneous CI fleet, x86-64-v3 guaranteed
rustflags = ["-Ctarget-cpu=x86-64-v3"]
```

```sh
# microarch-pin: build-matrix - one artifact per ISA level, loader selects at install
export GOAMD64=v3
```

The temporary reason token is `local-profiling` or `bench` plus a `removable:`
ISO date. The standing token is `controlled-target` or `build-matrix` followed
by a dash and a justification. A bare pin fails; a `controlled-target -` marker
with an empty justification fails.

## Enforcement

- `build-microarch-is-portable` (`scripts/fleet/check/`) scans build-config
  surfaces — `.cargo/config*.toml` + `config.repo.toml`, CI workflows
  (`.github/workflows/*.{yml,yaml}` RUSTFLAGS/GOAMD64 env), `mise.toml` /
  `mise/config.toml`, `Justfile`/`Makefile`, and `.cargo/*.sh` build scripts —
  and fails on an un-annotated microarch pin or a standing marker with an empty
  justification. Prose that merely DISCUSSES the pin (`.md`, `.mts`) is out of
  scope. The pure detectors ship a self-test under
  `test/repo/unit/check-build-microarch-is-portable.test.mts`.

## Why

The payoff of portable SIMD is real — the acorn-lang Go lexer work measured
1.5-2.4x end-to-end throughput on string/template-dense JS and ~16x on isolated
micro-scans, allocation-neutral — and for a distributed artifact it comes from
runtime dispatch, not a compile-time microarch pin. A distributed pinned build
trades that portability for a number that only holds on the build host, then
crashes for a user on an older CPU. When you control the target — a homogeneous
fleet or a per-ISA build matrix — pinning to the guaranteed floor is a real win
and legitimate. See the language mechanics in
[optimizing-rust-performance](../../../.claude/skills/fleet/optimizing-rust-performance/SKILL.md),
[optimizing-go-performance](../../../.claude/skills/fleet/optimizing-go-performance/SKILL.md),
and [optimizing-cpp-performance](../../../.claude/skills/fleet/optimizing-cpp-performance/SKILL.md).

## SIMD heuristics

When a hot loop tempts you toward SIMD, apply these in order. Source: Erin
Catto's box2d solver write-up at
<https://box2d.org/posts/2024/08/simd-matters/>; each rule carries our own
receipts where we have them. These are heuristics with a measure-first rule,
not absolutes.

- **Measure the autovectorization ceiling first.** Element-wise byte and
  integer loops routinely hit it: stuie-cabi's per-frame buffer loops gained
  5-16x from structure-only rewrites — `slice::fill`, block `memcmp`,
  `copy_from_slice` — with zero intrinsics, stuie commit `b3e23ac`. Structured
  float math does not: box2d's scalar solver shared the exact SoA layout with
  the SIMD path and still ran ~2x slower than hand-written SSE2, 524 vs 982
  FPS on a 7950X. Bench the structural rewrite first; reach for wide types
  only when the measured gap justifies them.
- **Restructure the data, don't retrofit intrinsics.** box2d's graph coloring
  batches constraints so no two in a color share a body: one data
  reorganization buys SIMD lanes AND atomics-free threading, and the coloring
  is maintained incrementally on add and remove, never recomputed per step.
  Pay for layout once; an intrinsic loop retrofitted onto a hostile layout
  pays gather/scatter on every iteration.
- **One codebase, a wide typedef.** box2d's `FloatW` typedefs to
  `__m128`/`__m256`/NEON/scalar-struct behind one gather/scatter boundary.
  Portability is a thin width abstraction — and that code shape is what makes
  the runtime dispatch required by the pinning rule above cheap.
- **Wider lanes saturate.** AVX2 beat SSE2 by ~14% despite 2x the lane width,
  1117 vs 982 FPS, because gather/scatter and memory traffic dominate. Quote
  this when someone proposes chasing a wider ISA before fixing layout.
- **SIMD selectively.** box2d kept collision detection scalar; only the
  math-dense solver went wide. Math density per byte moved decides where SIMD
  belongs.

Everything above is orthogonal to WHO CONTROLS THE TARGET: a distributed
artifact still ships runtime dispatch, per the rule at the top of this page.
