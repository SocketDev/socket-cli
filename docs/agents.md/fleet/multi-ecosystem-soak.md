# Multi-ecosystem soak enforcement

Referenced from the CLAUDE.md soak bullet. The 7-day `minimumReleaseAge` trust
gate is not npm-only: every ecosystem a fleet machine installs from is
manifest + lock + soak + fail-closed enforcement, all deriving from the ONE
canonical window `SOAK_DAYS` (`scripts/fleet/constants/soak.mts`). Warnings
don't prevent a compromised system; each surface below blocks or resolves to a
soaked version, never advises.

## The invariant

A fleet machine (dev laptop, CI runner, or prebaked image) can only acquire a
dependency, tool, or runtime through a committed manifest+lock whose pins a
soak-aware bump tool moved, and every acquisition path verifies integrity
fail-closed. The one deliberate exception: Socket-published artifacts (own
provenance pipeline) bypass the window via dated excludes, mirroring
`SOCKET_SCOPES`.

## Per-ecosystem enforcement

| Ecosystem     | Manifest + lock                                      | Soak mechanism                                                                                                                                                                     | Enforced by                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm           | package.json + pnpm-lock.yaml                        | pnpm `minimumReleaseAge` (minutes) + `.npmrc` `min-release-age`                                                                                                                    | pnpm rejects unsoaked at install; parity: `check/soak-time-is-consistent.mts`                                                                                                                                            |
| python        | pyproject.toml + uv.lock                             | `[tool.uv] exclude-newer`                                                                                                                                                          | uv rejects newer; `check/uv-lockfiles-are-current.mts`                                                                                                                                                                   |
| rust          | Cargo.toml + Cargo.lock                              | `.cargo/config.toml` min-publish-age (nightly-native; inert on stable, where the LOCK is build-time enforcement and the nightly updater `update/cargo.mts` is the only lock-mover) | `check/cargo-soak-config-is-current.mts`: config parity unconditional, tracked Cargo.lock required with own rust. Repo-only Cargo settings live in optional `.cargo/config.repo.toml`, included by the canonical config. |
| go            | go.mod + go.sum                                      | none native, so an external gate reads the GOPROXY publish time                                                                                                                    | `check/go-deps-are-soaked.mts` fails on an under-soak require                                                                                                                                                            |
| brew          | generated `Brewfile` + `constants/brew-tap-pins.mts` | one dated tap SHA at least SOAK_DAYS old per tap; every formula version at that SHA is definitionally soaked                                                                       | `check/brew-install-is-pinned.mts` (offline): Brewfile sync, pin age, no bare installs. Brewfile presence = enrollment; unenrolled repos never redden                                                                    |
| docker images | Dockerfile FROM digests                              | `update/docker.mts` repins only to tags older than the window                                                                                                                      | `FROM image:tag@sha256:...` pins; prebake gate below                                                                                                                                                                     |

Every gate no-ops on ecosystem absence (no own go.mod / Cargo.toml /
Brewfile), so the fleet-wide cascade never reddens a repo that lacks the
ecosystem. Vendored trees (`upstream/`, `vendor/`, `third_party/`, `deps/`,
`*-bundled`, `*-vendored`) are never "own" manifests (`update/_shared.mts`).

## The three install surfaces (one manifest set)

- CI: the fleet setup action installs brew tools via a depth-1 checkout of the
  pinned tap SHA + `brew bundle install --no-upgrade`; language deps come from
  the committed locks.
- Local dev: `pnpm setup-all` ecosystem steps provision through the same
  artifacts (`setup:brew` pinned bundle, `setup:rust` runs
  `cargo fetch --locked`, `setup:go` runs `go mod download`, `setup:python`
  runs `uv sync --frozen`); local == CI.
- Prebaked images: every `docker/fleet-bases/*.Dockerfile` copies its lock
  before installing and uses the frozen/locked verb;
  `check/prebakes-install-from-lock.mts` (repo tier) fails an unpinned
  external FROM, an unlocked install verb, or a missing lock COPY.

## Updaters (the only pin-movers)

`pnpm run update` (`update.mts`) runs taze for npm, then dry-plans every other
ecosystem via `scripts/fleet/update/{brew,cargo,docker,go,node}.mts
--soak-days SOAK_DAYS`. Applying is a deliberate per-ecosystem `--apply` /
`--fix` step because it needs that toolchain + network. The weekly automated
update rides the same chain. Bump tools for the runtime + pins (Node version,
gh-aw action SHAs, Claude plugin SHAs) hold under-soak targets loudly.

## Excludes

`scripts/fleet/constants/soak-excludes.mts` is the one canonical
per-ecosystem list (cargo / go / brew), every entry dated with its reason,
consulted by every gate. npm keeps its existing surfaces (`SOCKET_SCOPES`,
pnpm `minimumReleaseAgeExclude` with `# published | removable` annotations).

## Healing

A missing/drifted derived artifact heals through the doctor, never by hand:
`pnpm run fix --all` regenerates a drifted Brewfile (enrolled repos only);
`update/brew.mts --apply` advances tap pins; `update/cargo.mts --apply` moves
Cargo.lock under the nightly gate. Scanner false-positive lesson: text
scanners must not harvest prose. `brew-parse.mts`'s quote-state scanner exists
because echo-hint strings once became "installed tools".

## Rust toolchain

Rust's soak needs cargo's `minimum-release-age`, which only stable cargo lacks
today — so the fleet Rust toolchain is pinned to a nightly (`nightly-2026-07-12`
at time of writing) in `rust-toolchain.toml` (the canonical pin), held until a
stable release ships that support. The CLAUDE.md bullet states only the
invariant ("Rust pins the toolchain nightly"); the exact nightly and its
removal condition live here.
