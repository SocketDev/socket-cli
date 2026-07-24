#!/usr/bin/env node
/*
 * @file Fail-closed gate for the cargo min-publish-age soak posture. Rust ships
 *   NATIVE soak enforcement via nightly `-Zmin-publish-age`
 *   (RFC 3923), so — unlike Go, which has no native
 *   equivalent (see go-deps-are-soaked.mts) — this gate never resolves
 *   crates.io itself. It asserts two things:
 *
 *   1. The checked-in `.cargo/config.toml` sets `[unstable] min-publish-age`,
 *      `[registry] global-min-publish-age`, and `[resolver]
 *      incompatible-publish-age` in parity with `SOAK_DAYS`
 *      (scripts/fleet/constants/soak.mts) — the same data-file parity shape as
 *      `soak-time-is-consistent.mts`'s pnpm/.npmrc check, since a TOML file
 *      can't import the constant. Checked in EVERY repo, unconditionally —
 *      `.cargo/config.toml` cascades byte-identical fleet-wide (same as
 *      `.npmrc`), so this is where a `SOAK_DAYS` bump that forgot to regenerate
 *      the checked-in TOML gets caught, at the file's authoring source, before
 *      it ever cascades stale.
 *   2. At least one `Cargo.lock` is tracked by git, in any repo with an own
 *      Cargo.toml (findOwnCargoManifests). The config keys above are INERT on
 *      the stable toolchain fleet repos actually build with (e.g. ultrathink
 *      pins 1.95.0) — stable cargo ignores unknown `[unstable]` keys. The
 *      committed lock is therefore the real build-time enforcement; a rust repo
 *      with no tracked lock has none, regardless of what the config file says.
 *      Skipped where there's no own Cargo.toml (nothing to build). Usage: node
 *      scripts/fleet/check/cargo-soak-config-is-current.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { SOAK_DAYS } from '../constants/soak.mts'
import { REPO_ROOT } from '../paths.mts'
import { findOwnCargoManifests } from '../update/cargo.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface CargoSoakConfigSurfaces {
  readonly configPresent: boolean
  readonly globalMinPublishAgeDays: number | undefined
  readonly hasOwnCargoToml: boolean
  readonly hasTrackedLock: boolean
  readonly incompatiblePublishAgeDeny: boolean | undefined
  readonly minPublishAgeEnabled: boolean | undefined
  readonly soakDays: number
}

/**
 * Read `min-publish-age = <bool>` under `[unstable]` from a
 * `.cargo/config.toml` body.
 */
export function extractMinPublishAgeEnabled(toml: string): boolean | undefined {
  const match = /^min-publish-age\s*=\s*(false|true)\s*$/m.exec(toml)
  return match ? match[1] === 'true' : undefined
}

/**
 * Read `global-min-publish-age = "<n> days"` (days) from a `.cargo/config.toml`
 * body.
 */
export function extractGlobalMinPublishAge(toml: string): number | undefined {
  const match = /^global-min-publish-age\s*=\s*"(\d+)\s*days"\s*$/m.exec(toml)
  return match ? Number(match[1]) : undefined
}

/**
 * Read `incompatible-publish-age = "<value>"` from a `.cargo/config.toml` body,
 * true only when the value is exactly `"deny"`.
 */
export function extractIncompatiblePublishAgeDeny(
  toml: string,
): boolean | undefined {
  const match = /^incompatible-publish-age\s*=\s*"(\w+)"\s*$/m.exec(toml)
  return match ? match[1] === 'deny' : undefined
}

/**
 * Mismatches between the observed `.cargo/config.toml` + lock state and the
 * canonical soak posture. Empty means in sync. Pure — the unit-test target.
 * `.cargo/config.toml` cascades via the cargo capability (conditional), so a
 * repo with neither the file nor an own Cargo.toml is simply outside the
 * group — no findings. A cargo-owning repo missing the file, or any repo
 * carrying a drifted copy, is flagged; the tracked-lock check only applies
 * when the repo owns a Cargo.toml.
 */
export function findCargoSoakConfigIssues(
  config: CargoSoakConfigSurfaces,
): string[] {
  const cfg = { __proto__: null, ...config } as CargoSoakConfigSurfaces
  if (!cfg.configPresent && !cfg.hasOwnCargoToml) {
    return []
  }
  const out: string[] = []
  if (!cfg.configPresent) {
    out.push(
      '.cargo/config.toml is missing — this repo owns a Cargo.toml, so the ' +
        'cargo capability soak config must be present. Fix: declare the ' +
        'cargo capability and re-cascade.',
    )
    return out
  }
  if (cfg.minPublishAgeEnabled !== true) {
    out.push(
      `.cargo/config.toml [unstable] min-publish-age is ` +
        `${cfg.minPublishAgeEnabled ?? '(missing)'}, wanted true.`,
    )
  }
  if (cfg.globalMinPublishAgeDays !== cfg.soakDays) {
    out.push(
      `.cargo/config.toml [registry] global-min-publish-age is ` +
        `${cfg.globalMinPublishAgeDays ?? '(missing)'}, wanted ` +
        `${cfg.soakDays} (SOAK_DAYS).`,
    )
  }
  if (cfg.incompatiblePublishAgeDeny !== true) {
    out.push(
      `.cargo/config.toml [resolver] incompatible-publish-age is ` +
        `${cfg.incompatiblePublishAgeDeny ?? '(missing)'}, wanted "deny".`,
    )
  }
  if (cfg.hasOwnCargoToml && !cfg.hasTrackedLock) {
    out.push(
      'no Cargo.lock is tracked by git — the config keys above are inert ' +
        'on the stable toolchain this repo builds with, so there is no ' +
        'build-time soak enforcement.',
    )
  }
  return out
}

/**
 * True when at least one `Cargo.lock` is tracked by git under `repoRoot`.
 * Reads the git index, not the working tree, so it also catches a lock that
 * is staged but not yet built locally. Returns `false` (never throws) when
 * `repoRoot` is not a git repository.
 */
export function hasTrackedCargoLock(repoRoot: string): boolean {
  const result = spawnSync('git', ['ls-files', '--', '*Cargo.lock'], {
    cwd: repoRoot,
    stdioString: true,
  })
  if (result.status !== 0) {
    return false
  }
  return String(result.stdout ?? '').trim().length > 0
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hasOwnCargoToml = findOwnCargoManifests(REPO_ROOT).length > 0

  const configPath = path.join(REPO_ROOT, '.cargo', 'config.toml')
  const toml = existsSync(configPath)
    ? readFileSync(configPath, 'utf8')
    : undefined
  const issues = findCargoSoakConfigIssues({
    configPresent: toml !== undefined,
    globalMinPublishAgeDays:
      toml === undefined ? undefined : extractGlobalMinPublishAge(toml),
    hasOwnCargoToml,
    hasTrackedLock: hasOwnCargoToml ? hasTrackedCargoLock(REPO_ROOT) : true,
    incompatiblePublishAgeDeny:
      toml === undefined ? undefined : extractIncompatiblePublishAgeDeny(toml),
    minPublishAgeEnabled:
      toml === undefined ? undefined : extractMinPublishAgeEnabled(toml),
    soakDays: SOAK_DAYS,
  })

  if (issues.length > 0) {
    logger.fail(
      `[cargo-soak-config-is-current] the cargo soak posture drifted from ` +
        `SOAK_DAYS (scripts/fleet/constants/soak.mts):\n  ` +
        `${issues.join('\n  ')}\n  ` +
        'Fix: re-cascade `.cargo/config.toml` from template/base ' +
        '(node scripts/repo/sync-scaffolding/cli.mts --target . --fix), and ' +
        'commit a Cargo.lock if this repo builds a rust binary or library.',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      hasOwnCargoToml
        ? `[cargo-soak-config-is-current] cargo soak config + lock are ` +
            `current (${SOAK_DAYS}d).`
        : `[cargo-soak-config-is-current] cargo soak config is current ` +
            `(${SOAK_DAYS}d); no own Cargo.toml, so no lock is required.`,
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
