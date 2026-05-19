# concurrent-cargo-build-guard

PreToolUse Bash hook that blocks a second `cargo build --release` (or known
fleet build-prod alias) while one is in flight. Fleet-wide: only fires on
cargo / build-prod commands, so a no-op in non-cargo repos.

## Why

Cargo release builds spawn 8 LLVM threads each, using 8-22GB RAM per build.
Two concurrent release builds reliably OOM-kill on typical dev machines.
Cargo dev builds + cargo check are fast (~1-2s) and parallel-safe — those
are exempt.

## What it blocks

| Pattern                                    | Block when in-flight? |
| ------------------------------------------ | --------------------- |
| `cargo build --release` / `cargo build -r` | yes                   |
| `cargo b --release` / `cargo b -r`         | yes                   |
| `pnpm build:prod` (fleet alias)            | yes                   |
| `node scripts/build.mts --prod`            | yes                   |
| `cargo build` (no --release)               | no                    |
| `cargo check`                              | no                    |

## Bypass

Type the canonical phrase in a new message:

    Allow concurrent-cargo-build bypass

Use sparingly — OOM consequences are real and abrupt.

## Detection

Uses `pgrep -f <pattern>` to count in-flight processes matching the same
build shape. If count ≥ 1, blocks. Times out the pgrep call at 5s to
guarantee the hook itself doesn't hang.
