/*
 * @file The fleet's pinned cargo-installed tool versions — ONE canonical
 *   home so the installer (`setup/rust.mts`) and every consumer
 *   (`lint-rust.mts`) read the same pin and cannot drift.
 *
 *   cargo-fixit (crate-ci) is the drop-in replacement for `cargo clippy
 *   --fix` — same fixes, a fraction of the wall clock, because it skips the
 *   full re-check compile between fix rounds. `lint-rust.mts --fix` prefers
 *   it when installed and falls back to clippy's own `--fix` otherwise.
 *
 *   Soak note, same rationale as the pnpm 11.8.0 external-tools soakBypass
 *   precedent: 0.1.13 published 2026-08-05, inside the 7-day window, and the
 *   pin was OPERATOR-NAMED. crate-ci is a known publisher; the soak targets
 *   registry typosquats and malicious freshpubs. The exact-version
 *   `cargo install <tool>@<version> --locked` is the control.
 */

export const CARGO_FIXIT_VERSION = '0.1.13'
