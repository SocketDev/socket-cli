#!/usr/bin/env node
/**
 * @file `setup:brew` — install the repo's pinned Homebrew bundle locally, so a
 *   dev machine gets exactly what CI gets. Self-detecting: skips with a clear
 *   line unless the platform has Homebrew (macOS / Linuxbrew) AND the repo has
 *   enrolled by committing a root `Brewfile`. Homebrew has no minimum-release
 *   age, so the fleet enforces one with per-tap SHA pins
 *   (`constants/brew-tap-pins.mts`, owned by `update/brew.mts --apply`): this
 *   step sets `HOMEBREW_NO_INSTALL_FROM_API=1`, checks each tap out at its
 *   soaked pin, then runs `brew bundle install --no-upgrade`. It NEVER falls
 *   through to an unpinned install — a pin fetch/checkout failure fails the
 *   step loud. Mirrors the CI "Install pinned Homebrew bundle" step.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { BREW_TAP_PINS } from '../constants/brew-tap-pins.mts'
import { resolveEcosystemOptions, skipResult } from './ecosystems.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type { BrewTapPin } from '../constants/brew-tap-pins.mts'
import type {
  EcosystemStepOptions,
  EcosystemStepResult,
  RunCommand,
} from './ecosystems.mts'
import type { Logger } from '@socketsecurity/lib-stable/logger/logger'

/**
 * The `brew tap` / `brew --repository` slug for a pin tap: `owner/repo` form
 * where the `homebrew-` prefix drops (`Homebrew/homebrew-core` →
 * `homebrew/core`). Pure so it is unit-testable.
 */
export function brewTapSlug(tap: string): string {
  const [owner, repo] = tap.split('/')
  return `${(owner ?? '').toLowerCase()}/${(repo ?? '').replace(/^homebrew-/i, '')}`
}

/**
 * True when a Brewfile declares any `cask "…"` entry — the signal that the cask
 * tap must be pinned too (core-only Brewfiles skip the cask tap fetch).
 */
export function brewfileDeclaresCask(brewfileText: string): boolean {
  return /^\s*cask\s/m.test(brewfileText)
}

/**
 * The tap pins to apply for a Brewfile: always the core tap, plus the cask tap
 * only when the Brewfile declares a cask.
 */
export function tapPinsForBrewfile(brewfileText: string): BrewTapPin[] {
  const needsCask = brewfileDeclaresCask(brewfileText)
  return BREW_TAP_PINS.filter(
    pin => needsCask || pin.tap !== 'Homebrew/homebrew-cask',
  )
}

/**
 * The skip reason for `setup:brew`, or undefined when the step should run given
 * the platform and Brewfile presence. Pure so the decision is unit-testable.
 * The `brew`-on-PATH check is a runtime seam handled by `setupBrew`.
 */
export function brewSkipReason(options: {
  readonly brewfileExists: boolean
  readonly platform: NodeJS.Platform
}): string | undefined {
  const { brewfileExists, platform } = options
  if (platform !== 'darwin' && platform !== 'linux') {
    return `Homebrew is not available on ${platform}`
  }
  if (!brewfileExists) {
    return 'no repo-root Brewfile (repo has not enrolled in the pinned Homebrew bundle)'
  }
  return undefined
}

/**
 * Check one tap out at its soaked pin SHA: ensure the tap exists, resolve its
 * local git dir, depth-1 fetch the pinned commit, and check it out. Returns
 * false (after a loud fail) on any resolve/fetch/checkout error so the caller
 * never proceeds to an unpinned bundle install.
 */
async function pinTap(
  pin: BrewTapPin,
  runCommand: RunCommand,
  env: NodeJS.ProcessEnv,
  logger: Logger,
): Promise<boolean> {
  const slug = brewTapSlug(pin.tap)
  logger.log(`setup:brew — pinning ${pin.tap} at ${pin.sha}`)
  // Ensure the tap's local git checkout exists; already-tapped is fine.
  await runCommand('brew', ['tap', slug], { env, silent: true })
  const repoResult = await runCommand('brew', ['--repository', slug], {
    env,
    silent: true,
  })
  const repoDir = repoResult.stdout.trim()
  if (repoResult.exitCode !== 0 || repoDir === '') {
    logger.fail(
      `setup:brew: could not resolve the local tap checkout for ${pin.tap}.\n` +
        `  Where: brew --repository ${slug}.\n` +
        `  Saw: exit ${repoResult.exitCode}; wanted the tap's git directory.\n` +
        `  Fix: run brew tap ${slug} manually, then re-run pnpm run setup:brew.`,
    )
    return false
  }
  const fetched = await runCommand(
    'git',
    ['-C', repoDir, 'fetch', '--depth', '1', 'origin', pin.sha],
    { env },
  )
  if (fetched.exitCode !== 0) {
    logger.fail(
      `setup:brew: could not fetch the pinned commit ${pin.sha} for ${pin.tap}.\n` +
        `  Where: git -C ${repoDir} fetch --depth 1 origin ${pin.sha}.\n` +
        `  Saw: exit ${fetched.exitCode}; wanted the soaked tap commit.\n` +
        '  Fix: check network + the pin in scripts/fleet/constants/brew-tap-pins.mts, then re-run.',
    )
    return false
  }
  const checkedOut = await runCommand(
    'git',
    ['-C', repoDir, 'checkout', '-q', pin.sha],
    { env },
  )
  if (checkedOut.exitCode !== 0) {
    logger.fail(
      `setup:brew: could not check out the pinned commit ${pin.sha} for ${pin.tap}.\n` +
        `  Where: git -C ${repoDir} checkout -q ${pin.sha}.\n` +
        `  Saw: exit ${checkedOut.exitCode}; wanted the tap pinned to the soaked SHA.\n` +
        '  Fix: resolve the tap working-tree state, then re-run pnpm run setup:brew.',
    )
    return false
  }
  return true
}

/**
 * Install the repo's pinned Homebrew bundle: pin each tap at its soaked SHA,
 * then `brew bundle install --no-upgrade` from the root Brewfile.
 */
export async function setupBrew(
  options?: EcosystemStepOptions | undefined,
): Promise<EcosystemStepResult> {
  const { commandExists, logger, platform, repoRoot, runCommand } =
    resolveEcosystemOptions(options)
  const brewfile = path.join(repoRoot, 'Brewfile')
  const skip = brewSkipReason({
    brewfileExists: existsSync(brewfile),
    platform,
  })
  if (skip) {
    return skipResult(logger, 'setup:brew', skip)
  }
  if (!(await commandExists('brew'))) {
    return skipResult(
      logger,
      'setup:brew',
      `brew is not installed on this ${platform} machine (install from https://brew.sh)`,
    )
  }
  // Resolve every formula from the local git tap pinned at a soaked SHA instead
  // of the always-latest Homebrew API. Mirrors the CI setup action.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOMEBREW_NO_INSTALL_FROM_API: '1',
  }
  const brewfileText = readFileSync(brewfile, 'utf8')
  for (const pin of tapPinsForBrewfile(brewfileText)) {
    if (!(await pinTap(pin, runCommand, env, logger))) {
      return {
        ok: false,
        reason: `tap pin failed for ${pin.tap}`,
        skipped: false,
      }
    }
  }
  logger.log('setup:brew — brew bundle install --no-upgrade')
  const bundled = await runCommand(
    'brew',
    ['bundle', 'install', '--no-upgrade', `--file=${brewfile}`],
    { env },
  )
  if (bundled.exitCode !== 0) {
    logger.fail(
      'setup:brew: brew bundle install failed.\n' +
        `  Where: brew bundle install --no-upgrade --file=${brewfile}.\n` +
        `  Saw: exit ${bundled.exitCode}; wanted every Brewfile entry installed from the pinned tap.\n` +
        '  Fix: read the brew output above, resolve the formula error, then re-run pnpm run setup:brew.',
    )
    return { ok: false, reason: 'brew bundle failed', skipped: false }
  }
  logger.log('setup:brew — pinned Homebrew bundle installed.')
  return { ok: true, skipped: false }
}

if (isMainModule(import.meta.url)) {
  setupBrew().then(
    result => {
      if (!result.ok) {
        process.exitCode = 1
      }
    },
    (e: unknown) => {
      getDefaultLogger().error(e)
      process.exitCode = 1
    },
  )
}
