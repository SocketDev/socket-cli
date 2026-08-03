#!/usr/bin/env node
/**
 * @file Code-as-law: a MULTI-crate cargo workspace keeps every publishable
 *   crate at a BARE release version. Its crates wire together with inter-crate
 *   deps that reference published crates.io versions (`{ workspace = true }` →
 *   a `version = "X.Y.Z"` pin), and cargo excludes prereleases from a `^X.Y.Z`
 *   range — so a `-prerelease` on any crate breaks inter-crate resolution
 *   (`cargo build` / `cargo update` fail). A single-crate workspace has no
 *   inter-crate deps, so the `-prerelease` hint is OPTIONAL there: with no hint
 *   the release bumps from the PUBLISHED version by heuristic (patch by
 *   default, minor when a feature landed; never an auto-major), and a hint just
 *   names a specific target. Publishable crates resolve via `cargo metadata`
 *   (so `[workspace.package]` inheritance is applied). Anti-skip is a separate
 *   gate (version-is-not-ahead-of-published). Fail-OPEN (skip) with no
 *   Cargo.toml, no cargo toolchain, or unreadable metadata — never a false-fail
 *   on a lane without Rust. Usage: node
 *   scripts/fleet/check/multi-crate-cargo-versions-are-bare.mts [--quiet]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { readPublishableCargoPackages } from '../publish-infra/cargo/shared.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface CargoCrateVersion {
  name: string
  version: string
}

/**
 * A prerelease/build-suffixed version (`0.1.0-prerelease`, `1.2.3-rc.1`). A
 * bare `X.Y.Z` is not one.
 */
export function isPrereleaseHint(version: string): boolean {
  return version.includes('-') || version.includes('+')
}

/**
 * Which publishable crates violate "multi-crate workspaces stay bare": with
 * more than one publishable crate, ANY crate carrying a prerelease is a
 * violation (it breaks inter-crate `^X.Y.Z` resolution). A single-crate
 * workspace has no inter-crate deps and uses the optional `-prerelease` hint,
 * so it never violates — returns `[]`. Pure; the test drives it.
 */
export function barePolicyViolations(
  packages: readonly CargoCrateVersion[],
): CargoCrateVersion[] {
  if (packages.length <= 1) {
    return []
  }
  return packages.filter(p => isPrereleaseHint(p.version))
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  if (!existsSync(path.join(REPO_ROOT, 'Cargo.toml'))) {
    return
  }
  // Fail-open (skip) on no cargo toolchain / unparseable metadata.
  const packages = await readPublishableCargoPackages().catch(() => undefined)
  if (!packages || packages.length === 0) {
    return
  }
  const violations = barePolicyViolations(packages)
  if (violations.length === 0) {
    if (!quiet) {
      logger.success(
        '[multi-crate-cargo-versions-are-bare] OK ' +
          `(${packages.length} publishable crate(s))`,
      )
    }
    return
  }
  logger.error(
    '[multi-crate-cargo-versions-are-bare] a multi-crate workspace must stay ' +
      `bare, but ${violations.map(p => `${p.name} ${p.version}`).join(', ')} ` +
      'carries a prerelease — it breaks inter-crate `^X.Y.Z` resolution. Drop ' +
      'the suffix; the release bumps from the published version.',
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    // Fail-open: a crash must not block an otherwise-valid push.
    process.exitCode = 0
  })
}
