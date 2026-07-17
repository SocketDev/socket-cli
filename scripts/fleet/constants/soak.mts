/*
 * @file Canonical fleet soak window — the ONE source for `minimumReleaseAge`. A
 *   new or bumped third-party dependency must have been published at least this
 *   long before the fleet adopts it: the cooldown catches a compromised
 *   upstream before it lands. Every soak surface DERIVES from `SOAK_DAYS`
 *   instead of hand-copying the number:
 *
 *   - `.config/fleet/taze.config.mts` → `maturityPeriod: SOAK_DAYS` (imports
 *     this)
 *   - `pnpm-workspace.yaml` → `minimumReleaseAge: SOAK_MINUTES` (data file)
 *   - `.npmrc` → `min-release-age=SOAK_DAYS` (data file)
 *   - the multi-ecosystem update runners (`scripts/fleet/update/*.mts`) take it
 *     as their soak threshold The two DATA files can't import this module, so
 *     `scripts/fleet/check/soak-time-is-consistent.mts` asserts they match the
 *     constant (code-is-law parity gate).
 */

export const SOAK_DAYS = 7

// pnpm's `minimumReleaseAge` is expressed in MINUTES.
export const SOAK_MINUTES = SOAK_DAYS * 24 * 60
