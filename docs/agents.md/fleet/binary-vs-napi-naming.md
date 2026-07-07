# Binary vs ABI/NAPI naming domains

Per-platform artifacts split into two naming domains **by design** (ratified
2026-07-04). The suffix tells a reader — and the loaders, allowlists, and
manifest generators that parse it — which artifact kind a tail package ships.
The domains are never blurred into one convention.

## The rule

- **Binaries** (kind `cli` — standalone executables, payload at `bin/<name>`)
  follow **pnpm pack-app** naming: `<os>-<arch>[-<libc>]`, glibc unsuffixed,
  no toolchain segment. 8 targets — an executable has no fallback:
  `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-arm64-musl`,
  `linux-x64`, `linux-x64-musl`, `win32-arm64`, `win32-x64`.
  Canonical source: `scripts/fleet/util/pack-app-triplets.mts`.
  Spec: https://pnpm.io/cli/pack-app
- **ABI/NAPI** (kind `napi` — `.node` addons, payload `<name>.node` beside
  package.json) follow **napi-rs** naming: `platform-arch[-abi]`, ABI segment
  explicit (`-gnu`/`-musl` on linux, `-msvc` on windows), darwin bare.
  Default matrix is 5 targets — the wasm fallback covers the rest:
  `darwin-arm64`, `darwin-x64`, `linux-arm64-gnu`, `linux-x64-gnu`,
  `win32-x64-msvc`. Canonical source: `scripts/fleet/util/napi-targets.mts`.
- The payload shape decides the domain; the suffix must match that domain's
  canonical set. `linux-x64` on a `.node` tail is wrong (napi requires
  `linux-x64-gnu`); `linux-x64-gnu` on an executable tail is wrong (pack-app
  has no toolchain segment).
- Scope boundaries mirror the split: `@socketbin/*` publishes the binary
  domain, `@socketaddon/*` publishes the napi domain.
- Enforcement: `scripts/fleet/check/platform-tails-match-naming-domain.mts`
  (registered in `scripts/fleet/check.mts`) classifies every per-platform
  tail manifest by payload and fails loud on a cross-domain suffix or an
  os/cpu engine-field mismatch.

## Why

A standalone executable must run everywhere it's installed — there is no
fallback — so the binary matrix carries full platform coverage including musl
and win32-arm64, and pack-app's triplet grammar is the contract pnpm itself
consumes. A NAPI addon loads through a require-chain that can fall back to a
wasm binding, so its matrix stays at the napi-rs popular-target set, and its
names carry the ABI segment because the `.node` artifact is ABI-specific in a
way an executable is not (glibc vs musl vs MSVC runtime linkage is part of the
addon's identity — napi-rs, oxc's `@oxc-parser/binding-*`, and the wider
prebuilt-addon ecosystem all encode it). Sharing one grammar across both kinds
would either under-specify addons or over-specify executables, and the reader
could no longer tell the artifact kind from the name.
