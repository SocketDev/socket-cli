/*
 * @file Cargo target/ janitor. Rust build dirs are the quiet disk killers:
 *   every checkout accumulates multi-GB debug+release artifacts, and the
 *   2026-07-31 incident found ~100 GB of stale target/ dirs across ~16
 *   checkouts on a machine down to 127 MB free. Everything in target/ is
 *   regenerable by `cargo build`, so sweeping stale ones is pure recovery.
 *
 *   Modes:
 *   - positional dirs — the AGENT sweep: a session that worked in a Rust
 *     checkout sweeps the dirs it visited (`… . --fix`); the
 *     rust-target-sweep-nudge hook names this command after cargo commands.
 *   - `--fleet` — the roster's sibling checkouts.
 *   - `--projects` — every Cargo.toml checkout under the projects root
 *     (catches non-fleet Rust repos like perry, the biggest producer).
 *
 *   Staleness: a target/ whose newest top-level entry is older than
 *   `--stale-days` (default 7) is stale — an actively rebuilt tree keeps a
 *   fresh mtime and is left alone, so sweeping never fights a live session.
 *   Dry-run by default; `--fix` deletes. Sizes are reported per dir so a
 *   silent cap never reads as "nothing to sweep".
 *
 *   Usage: node scripts/fleet/rust-target-sweep.mts
 *     [<dir>…] [--fleet] [--projects] [--stale-days N] [--fix]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const DAY_MS = 24 * 60 * 60_000
const DEFAULT_STALE_DAYS = 7

/**
 * Whether a target/ dir is sweepable: its newest observed mtime is older
 * than the stale window. Pure over the observations — exported for tests.
 * A zero/negative window means "sweep regardless of freshness".
 */
export function isStaleTarget(config: {
  newestMtimeMs: number
  nowMs: number
  staleDays: number
}): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  if (cfg.staleDays <= 0) {
    return true
  }
  return cfg.nowMs - cfg.newestMtimeMs > cfg.staleDays * DAY_MS
}

/**
 * The newest mtime among the dir itself and its TOP-LEVEL entries — a cheap
 * freshness probe (a full walk of a 40 GB target/ is exactly the cost this
 * tool exists to avoid). Cargo touches the profile dirs (debug/, release/)
 * on every build, so top-level mtimes track real activity.
 */
export function newestTopLevelMtimeMs(dir: string): number {
  let newest = 0
  try {
    newest = statSync(dir).mtimeMs
    for (const entry of readdirSync(dir)) {
      try {
        const m = statSync(path.join(dir, entry)).mtimeMs
        if (m > newest) {
          newest = m
        }
      } catch {
        // A vanished entry mid-scan is fine — another actor is working here.
      }
    }
  } catch {
    return 0
  }
  return newest
}

// A cargo target dir: `<dir>/target` beside a Cargo.toml.
function targetOf(checkout: string): string | undefined {
  const target = path.join(checkout, 'target')
  return existsSync(path.join(checkout, 'Cargo.toml')) && existsSync(target)
    ? target
    : undefined
}

function duHuman(dir: string): string {
  try {
    // oxlint-disable-next-line socket/prefer-async-spawn -- one-shot sync size probe for the report line.
    const result = spawnSync('du', ['-sh', dir])
    const out = String(result.stdout ?? '').trim()
    return out.split('\t')[0] || '?'
  } catch {
    return '?'
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const fix = argv.includes('--fix')
  const fleet = argv.includes('--fleet')
  const projects = argv.includes('--projects')
  const staleDaysAt = argv.indexOf('--stale-days')
  const staleDays =
    staleDaysAt === -1 ? DEFAULT_STALE_DAYS : Number(argv[staleDaysAt + 1])
  if (!Number.isFinite(staleDays)) {
    logger.fail('--stale-days needs a number.')
    process.exitCode = 1
    return
  }
  const positional = argv.filter(
    (a, i) => !a.startsWith('--') && i !== staleDaysAt + 1,
  )
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '../..')
  const projectsRoot = path.resolve(repoRoot, '..')
  const checkouts = new Set<string>(positional.map(p => path.resolve(p)))
  if (fleet) {
    const rosterPath = path.join(
      repoRoot,
      '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
    )
    if (existsSync(rosterPath)) {
      const roster = JSON.parse(readFileSync(rosterPath, 'utf8')) as {
        repos?:
          | Array<{ name?: string | undefined } | string>
          | undefined
      }
      for (const r of roster.repos ?? []) {
        const name = typeof r === 'string' ? r : (r.name ?? '')
        if (name) {
          checkouts.add(path.join(projectsRoot, name))
        }
      }
    } else {
      logger.warn('--fleet: no roster here (member checkout?) — skipped.')
    }
  }
  if (projects) {
    for (const entry of readdirSync(projectsRoot)) {
      checkouts.add(path.join(projectsRoot, entry))
    }
  }
  if (checkouts.size === 0) {
    logger.fail('no scope: pass dirs, --fleet, or --projects.')
    process.exitCode = 1
    return
  }
  const now = Date.now()
  let swept = 0
  let stale = 0
  let fresh = 0
  const sortedCheckouts = [...checkouts].toSorted()
  for (let i = 0, { length } = sortedCheckouts; i < length; i += 1) {
    const checkout = sortedCheckouts[i]!
    const target = targetOf(checkout)
    if (!target) {
      continue
    }
    const newestMtimeMs = newestTopLevelMtimeMs(target)
    if (!isStaleTarget({ newestMtimeMs, nowMs: now, staleDays })) {
      fresh += 1
      logger.log(
        `${target}: fresh (built within ${staleDays}d) — left alone (${duHuman(target)}).`,
      )
      continue
    }
    stale += 1
    if (!fix) {
      logger.log(`${target}: STALE — would sweep ${duHuman(target)} (--fix).`)
      continue
    }
    const size = duHuman(target)
    // eslint-disable-next-line no-await-in-loop -- serial deletes; each is a large recursive unlink.
    await safeDelete(target)
    swept += 1
    logger.success(`${target}: swept ${size}.`)
  }
  logger.log('')
  logger.log(
    `rust-target-sweep summary: ${swept} swept, ${stale - swept} stale${fix ? ' (delete failed?)' : ' (dry-run)'}, ${fresh} fresh and spared.`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
