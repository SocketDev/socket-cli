# Dot-naming — domain from the target suffix

Every published per-platform artifact carries a **dotted name** whose target
segment says what kind of artifact it is:
`@<owner>/<name>[.<lang>].<target>[-<platform>]`. The domain is read from the
`.target` token in the name, never from the scope. A loader, allowlist, or
manifest generator classifies an artifact by its target and validates the
platform tail against that target's canonical grammar. The domains are never
blurred into one convention.

Ratified 2026-07-04 as the binary-vs-napi split; generalized 2026-07-13 to the
dotted two-axis scheme (`.lang` + `.target`) so multi-implementation families
(a Rust addon, a C++ addon, and a wasm fallback of the same package) never
collide.

## The grammar

`@<owner>/<name>[.<lang>].<target>[-<platform>]`

- **`<name>`** — the logical package. `@<owner>/<name>` alone is a
  **meta-selector**: it loads a default family (native, then wasm fallback); it
  is not itself an implementation.
- **`<lang>`** (optional) — implementation source: `rs` (Rust), `cpp` (C++),
  `go` (Go), `ts` (TypeScript). Omitted for a single-implementation package;
  `@<owner>/<name>.<lang>` (no target) is that family's loader.
- **`<target>`** — build-artifact kind, the **domain signal**:
  - **`node`** — native NAPI addon (payload `<name>.node`). Platform tail follows
    **napi-rs** naming: `platform-arch[-abi]`, `-gnu`/`-musl` on linux and
    `-msvc` on windows explicit, darwin bare. Default matrix is 5 targets (the
    wasm fallback covers the rest): `darwin-arm64`, `darwin-x64`,
    `linux-arm64-gnu`, `linux-x64-gnu`, `win32-x64-msvc`. Canonical set:
    `scripts/fleet/util/napi-targets.mts`.
  - **`wasm`** — portable WebAssembly. No platform tail; one artifact runs
    everywhere.
  - **`exe`** — standalone executable (payload at `bin/<name>`). Platform tail
    follows pnpm **pack-app** naming: `<os>-<arch>[-musl]`, glibc unsuffixed, no
    toolchain segment. 8 targets (an executable has no fallback): `darwin-arm64`,
    `darwin-x64`, `linux-arm64`, `linux-arm64-musl`, `linux-x64`,
    `linux-x64-musl`, `win32-arm64`, `win32-x64`. Canonical set:
    `scripts/fleet/util/pack-app-triplets.mts`. Exemplar:
    `@pnpm/exe.<os>-<arch>[-musl]`. Spec: <https://pnpm.io/cli/pack-app>

## The rule

- **The target decides the domain; the platform tail must match that target's
  canonical set.** `linux-x64` on a `.node` tail is wrong (napi requires
  `linux-x64-gnu`); `linux-x64-gnu` on an `.exe` tail is wrong (pack-app has no
  toolchain segment).
- **The payload shape must agree with the target.** A `.node` target ships a
  `.node` payload; an `.exe` target ships a `bin/` payload; a `.wasm` target
  ships wasm. A target/payload disagreement makes the artifact kind illegible.
- **Domain from the name, not the scope.** The `@socketbin`/`@socketaddon` scope
  split that previously carried the binary-vs-napi distinction is legacy (both
  scopes are being decommissioned). Per-project scopes are the norm now
  (`@ultrathink/acorn.rs.node-*`); the target segment carries the domain.
- **`.lang` optional for single-impl.** A package with one implementation may
  omit `.lang` (`@pnpm/exe.<os>-<arch>`). A multi-impl family always marks it
  (`acorn.rs.node-*`, `acorn.cpp.wasm`, …) so families never collide.
- Enforcement: `scripts/fleet/check/platform-tails-match-naming-domain.mts`
  (registered in `scripts/fleet/check.mts`) classifies every per-platform tail
  manifest by its target segment (payload as a cross-check) and fails loud on a
  cross-domain suffix, a bad `.lang`, or an os/cpu engine-field mismatch.

## Separator note

The `.lang`/`.target` axes are dot-joined; the platform tail joins per its
target's own tooling convention. napi-rs emits `.node-<napi-tail>` (hyphen);
pack-app follows `.exe.<pack-app-triplet>` (dot), as in `@pnpm/exe.darwin-x64`.
The check accepts either separator before the platform tail so both tooling
conventions validate.

## Why

A standalone executable must run everywhere it is installed, with no fallback, so
the `exe` matrix carries full platform coverage including musl and win32-arm64;
pack-app's triplet grammar is the contract pnpm itself consumes. A NAPI addon
loads through a require-chain that falls back to a wasm binding, so its matrix
stays at the napi-rs popular-target set, and its names carry the ABI segment
because the `.node` artifact is ABI-specific in a way an executable is not (glibc
vs musl vs MSVC runtime linkage is part of the addon's identity, which napi-rs,
oxc's `@oxc-parser/binding-*`, and the wider prebuilt-addon ecosystem all
encode). Reading the domain from the target segment rather than the scope lets a
single package ship a Rust addon, a C++ addon, and a wasm fallback under one name
family, each artifact self-describing, none colliding.
