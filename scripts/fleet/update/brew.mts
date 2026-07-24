#!/usr/bin/env node
/**
 * @file Soak enforcement for Homebrew, which has no minimum-release-age of its
 *   own. One discovery pass over the repo's `brew install` sites feeds three
 *   modes: the DRY planner (default — reports each discovered formula/cask as
 *   cleared / held / excluded / unresolved against its tap-commit age via `gh
 *   api`, never mutates); `--write-manifest` (regenerates the repo-root
 *   Brewfile from the CI `brew install` sites under `.github/`); and `--apply`
 *   (advances every Homebrew tap pin in `constants/brew-tap-pins.mts` to the
 *   newest commit at least `soakDays` old). Install-time enforcement is the tap
 *   pin: CI checks the tap out at that >= soakDays-old SHA and runs `brew
 *   bundle` from the committed Brewfile, so every version present at that SHA
 *   is definitionally soaked. A `BREW_SOAK_EXCLUDES` formula is skipped by the
 *   age planner (reported excluded); the tap pin governs its install
 *   regardless. The pure discovery / render helpers live in `brew-parse.mts`;
 *   this file is the CLI shell (`gh` spawns + modes) and re-exports them.
 *   `soakDays` is always caller-supplied, never hardcoded. Usage: node
 *   scripts/fleet/update/brew.mts --soak-days 7 [--write-manifest | --apply].
 */

import { writeFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { BREW_TAP_PINS } from '../constants/brew-tap-pins.mts'
import {
  BREW_SOAK_EXCLUDES,
  isSoakExcluded,
} from '../constants/soak-excludes.mts'
import { REPO_ROOT } from '../paths.mts'
import { requireSoakDays } from './_shared.mts'
import {
  advanceTapPins,
  brewfilePath,
  brewTapPinsPath,
  checkBrewToolAges,
  commitsApiPath,
  dedupeBrewTools,
  findBrewToolSites,
  findManifestBrewSites,
  parseCommitDate,
  renderBrewfile,
  renderBrewTapPinsFile,
  tapFileCandidates,
} from './brew-parse.mts'

import type { BrewTool, BrewToolStatus } from './brew-parse.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

const logger = getDefaultLogger()

export * from './brew-parse.mts'

/**
 * The newest commit date for a tool, probing its tap file candidates via
 * `gh api`. Undefined when none resolve, gh is absent, or a probe errors.
 */
async function fetchToolLastModifiedViaGh(
  tool: BrewTool,
): Promise<Date | undefined> {
  for (const candidate of tapFileCandidates(tool)) {
    let date: Date | undefined
    try {
      const result = await spawn(
        'gh',
        [
          'api',
          commitsApiPath(candidate),
          '--jq',
          '.[0].commit.committer.date',
        ],
        { stdioString: true },
      )
      date = parseCommitDate(String(result.stdout ?? ''))
    } catch {
      date = undefined
    }
    if (date) {
      return date
    }
  }
  return undefined
}

function toolLabel(status: BrewToolStatus): string {
  return status.cask ? `cask ${status.name}` : status.name
}

/**
 * Newest-first commit array for `tap` at or before `until`, via `gh api`.
 */
async function fetchTapCommitsViaGh(
  tap: string,
  until: string,
): Promise<unknown> {
  const result = await spawn(
    'gh',
    ['api', `repos/${tap}/commits?until=${until}&per_page=1`],
    { stdioString: true },
  )
  return JSON.parse(String(result.stdout ?? '[]'))
}

async function writeManifestMode(
  root: string,
  soakDays: number,
): Promise<number> {
  const tools = findManifestBrewSites(root)
  writeFileSync(brewfilePath(root), renderBrewfile(tools, soakDays))
  logger.success(
    `update/brew: wrote Brewfile from ${dedupeBrewTools(tools).length} discovered CI tool(s).`,
  )
  return 0
}

async function applyMode(soakDays: number): Promise<number> {
  const advanced = await advanceTapPins(
    BREW_TAP_PINS,
    soakDays,
    new Date(),
    fetchTapCommitsViaGh,
  )
  writeFileSync(brewTapPinsPath(), renderBrewTapPinsFile(advanced))
  logger.success(
    `update/brew: advanced ${advanced.length} tap pin(s) to the newest commit >= ${soakDays}d old.`,
  )
  return 0
}

async function planMode(soakDays: number, root: string): Promise<number> {
  const all = dedupeBrewTools(findBrewToolSites(root))
  if (all.length === 0) {
    logger.info('update/brew: no brew usage found — nothing to do.')
    return 0
  }
  const excluded = all.filter(t => isSoakExcluded(BREW_SOAK_EXCLUDES, t.name))
  const tools = all.filter(t => !isSoakExcluded(BREW_SOAK_EXCLUDES, t.name))
  const statuses = await checkBrewToolAges(
    tools,
    soakDays,
    new Date(),
    fetchToolLastModifiedViaGh,
  )
  let cleared = 0
  let held = 0
  let skipped = 0
  let unresolved = 0
  logger.info(`update/brew: ${all.length} brew tool(s) in use:`)
  logger.group()
  for (const status of statuses) {
    if (status.resolved) {
      if (status.soakCleared) {
        cleared += 1
        logger.substep(
          `cleared: ${toolLabel(status)} (${Math.floor(status.ageDays!)}d in tap)`,
        )
      } else {
        held += 1
        logger.substep(
          `held: ${toolLabel(status)} (${Math.floor(status.ageDays!)}d of ${soakDays}d)`,
        )
      }
    } else if (status.explicit) {
      unresolved += 1
      logger.warn(
        `unresolved: ${toolLabel(status)} — declared but not found in its tap (renamed/removed?)`,
      )
    } else {
      // A bare token that resolves to no single tap file — an alias
      // (`python` -> `python@3.x`) or a non-tool artifact. Counted, not named.
      skipped += 1
    }
  }
  for (let i = 0, { length } = excluded; i < length; i += 1) {
    const tool = excluded[i]!
    logger.substep(`excluded: ${tool.cask ? `cask ${tool.name}` : tool.name}`)
  }
  logger.groupEnd()
  logger.info(
    `update/brew: ${cleared} cleared, ${held} held` +
      `${unresolved ? `, ${unresolved} unresolved` : ''}` +
      `${excluded.length ? `, ${excluded.length} excluded` : ''}` +
      `${skipped ? `, ${skipped} skipped (alias / not a single formula)` : ''}` +
      ` (soak ${soakDays}d).`,
  )
  // Plan-only: a held tool is not an error. Enforcement is the tap pin
  // (--apply) + the pinned `brew bundle` install in CI.
  return 0
}

export async function main(argv: string[]): Promise<number> {
  let soakDays: number
  try {
    soakDays = requireSoakDays(argv, 'update/brew')
  } catch (e) {
    logger.error(errorMessage(e))
    return 2
  }
  if (argv.includes('--apply')) {
    return applyMode(soakDays)
  }
  const root = REPO_ROOT
  if (argv.includes('--write-manifest')) {
    return writeManifestMode(root, soakDays)
  }
  return planMode(soakDays, root)
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code
    },
    (e: unknown) => {
      logger.error(errorMessage(e))
      process.exitCode = 1
    },
  )
}
