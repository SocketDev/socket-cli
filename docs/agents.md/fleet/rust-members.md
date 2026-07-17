# Rust fleet members

Rust repositories do not need identical source layouts, but they do follow the
same toolchain contract. The wheelhouse owns the repetitive parts so a new
developer can use the same commands in every member.

## Required files

- `Cargo.toml` describes a crate or workspace.
- `Cargo.lock` freezes the dependency graph. It must be committed.
- `rust-toolchain.toml` selects an exact compiler. A pure Rust repository uses
  the fleet root pin. A mixed-language repository may use a repo default plus a
  more specific pin inside a Rust workspace.
- `rustfmt.toml` is fleet-owned and uses two-space indentation.
- `.cargo/config.toml` is fleet-owned and contains the dependency-soak rules.
- `.cargo/config.repo.toml` is optional. Put platform runners, target-specific
  rustflags, or other repository-only Cargo settings here. The fleet config
  includes it without giving up ownership of the security settings.

Do not add repository-specific tables directly to `.cargo/config.toml`. A
cascade replaces that file byte-for-byte.

## Normal commands

```sh
pnpm run setup:rust
node scripts/fleet/fmt-rust.mts --check
pnpm run check --all
```

`setup:rust` finds every first-party Cargo manifest. For each one it finds the
nearest `rust-toolchain.toml`, installs its profile, components, and targets,
then runs `cargo fetch --locked`. It fails if a workspace has no pin; silently
using a developer's global compiler would make local and CI results differ.

`fmt-rust.mts` runs from each workspace directory. That detail matters because
Cargo and rustup discover toolchain and Cargo config files from the current
directory, not from `--manifest-path` alone.

## What “uniform” means

Uniform does not mean every crate must support the same minimum Rust version.
It means every compiler choice is exact and visible, every dependency graph is
locked and soak-checked, formatting is shared, and setup uses the same declared
inputs as CI. A mixed repository can pin Rust 1.95 for one parser and another
exact version for a separate workspace when the code genuinely needs it.
