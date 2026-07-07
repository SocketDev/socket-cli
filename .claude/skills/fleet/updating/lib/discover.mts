#!/usr/bin/env node
/*
 * Read-only work-list probe for the `updating` umbrella skill's discovery phase.
 *
 * The umbrella's discovery barrier (SKILL.md "What runs inline vs. in the
 * Workflow") needs one cheap, deterministic answer per update category: "does
 * this apply, and what is the work?". Doing those probes ad-hoc in shell drifts
 * (the lockstep exit-code map, the default-branch fallback chain, the coverage
 * script preference order each have a canonical owner already). This runner
 * collects every probe in one place and emits a single structured JSON object
 * the Workflow can fan out from — without mutating anything.
 *
 * Probes, all read-only:
 *
 * - lockstep — `pnpm run lockstep --json` when `lockstep.json` exists; exit 2 =
 *   drift (actionable), exit 1 = schema error (stop), exit 0 = clean.
 * - submodules — `.gitmodules` entries that are un-pinned or behind their
 *   recorded gitlink (a superproject SHA newer than the checked-out one).
 * - coverage — whether the repo declares a coverage script at all.
 * - pricing — whether the model-pricing snapshot is stale per the same marker
 *   the `pricing-data-is-current` check reads.
 *
 * Usage: node .claude/skills/fleet/updating/lib/discover.mts [<repo-root>]
 *   Defaults to process.cwd(). Always exits 0 — this is a probe, not a gate; the
 *   work it finds is carried in the JSON `categories[]`, not the exit code.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { spawn } from '@socketsecurity/lib/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib/process/spawn/errors'

import { resolveDefaultBranch } from '../../_shared/scripts/git-default-branch.mts'

const logger = getDefaultLogger()

// Days after the model-pricing snapshot date before the data is stale. Kept in
// lockstep with `scripts/fleet/check/pricing-data-is-current.mts` FRESHNESS_DAYS
// — both anchor to the weekly `updating` cadence.
const PRICING_FRESHNESS_DAYS = 10

// `<!-- MODEL-PRICING-SNAPSHOT: 2026-06-11 -- ... -->`. Captures the ISO date.
const PRICING_SNAPSHOT_RE = /MODEL-PRICING-SNAPSHOT:\s*(\d{4}-\d{2}-\d{2})\b/

export type DiscoveryCategory =
  | 'coverage'
  | 'lockstep'
  | 'pricing'
  | 'submodules'

export interface DiscoveryItem {
  /**
   * Whether this category applies (the repo carries the relevant artifact).
   */
  readonly applies: boolean
  /**
   * Whether applicable work was found (drift, staleness, behind submodules).
   * Always false when `applies` is false.
   */
  readonly actionable: boolean
  /**
   * Human-readable one-liners describing the work; empty when not actionable.
   */
  readonly items: readonly string[]
  /**
   * Set when the probe itself failed (e.g. lockstep schema error, exit 1). The
   * caller treats a `blocked` category as stop-the-line, not advisory.
   */
  readonly blocked?: boolean | undefined
}

export interface DiscoveryResult {
  readonly base: string
  readonly categories: Readonly<Record<DiscoveryCategory, DiscoveryItem>>
  readonly cwd: string
}

function makeItem(options: {
  readonly actionable?: boolean | undefined
  readonly applies: boolean
  readonly blocked?: boolean | undefined
  readonly items?: readonly string[] | undefined
}): DiscoveryItem {
  const opts = {
    __proto__: null,
    actionable: false,
    blocked: undefined,
    items: [],
    ...options,
  } as {
    actionable: boolean
    applies: boolean
    blocked: boolean | undefined
    items: readonly string[]
  }
  return {
    __proto__: null,
    actionable: opts.applies && opts.actionable,
    applies: opts.applies,
    blocked: opts.blocked,
    items: opts.items,
  } as DiscoveryItem
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

export async function probeCoverage(cwd: string): Promise<DiscoveryItem> {
  const pkg = readJson(path.join(cwd, 'package.json'))
  const scripts =
    pkg && typeof pkg === 'object' && 'scripts' in pkg
      ? (pkg as { scripts?: Record<string, unknown> | undefined }).scripts
      : undefined
  const names = ['cover', 'coverage', 'test:cover'] as const
  const found = scripts
    ? names.find(name => typeof scripts[name] === 'string')
    : undefined
  if (!found) {
    return makeItem({ applies: false })
  }
  // Presence is the signal; whether the badge moved is decided by
  // make-coverage-badge.mts at apply time, not re-derived here.
  return makeItem({
    actionable: true,
    applies: true,
    items: [`coverage script \`${found}\` — refresh README badge`],
  })
}

export async function probeLockstep(cwd: string): Promise<DiscoveryItem> {
  if (!existsSync(path.join(cwd, 'lockstep.json'))) {
    return makeItem({ applies: false })
  }
  try {
    await spawn('pnpm', ['run', 'lockstep', '--json'], {
      cwd,
      stdioString: true,
    })
    // Exit 0 — clean.
    return makeItem({ applies: true })
  } catch (e) {
    if (isSpawnError(e)) {
      const code = typeof e.code === 'number' ? e.code : -1
      if (code === 2) {
        return makeItem({
          actionable: true,
          applies: true,
          items: ['lockstep drift — run per-row auto-bumps'],
        })
      }
      // Exit 1 (schema error) or any other failure stops the line.
      return makeItem({
        applies: true,
        blocked: true,
        items: [`lockstep validation failed (exit ${String(code)})`],
      })
    }
    return makeItem({
      applies: true,
      blocked: true,
      items: [errorMessage(e)],
    })
  }
}

export async function probePricing(cwd: string): Promise<DiscoveryItem> {
  const docPath = path.join(
    cwd,
    'docs',
    'agents.md',
    'fleet',
    'skill-model-routing.md',
  )
  if (!existsSync(docPath)) {
    return makeItem({ applies: false })
  }
  let text = ''
  try {
    text = readFileSync(docPath, 'utf8')
  } catch {
    return makeItem({ applies: false })
  }
  const match = PRICING_SNAPSHOT_RE.exec(text)
  if (!match?.[1]) {
    return makeItem({ applies: false })
  }
  const snapshot = new Date(`${match[1]}T00:00:00Z`)
  if (Number.isNaN(snapshot.getTime())) {
    return makeItem({ applies: false })
  }
  const ageDays = Math.floor((Date.now() - snapshot.getTime()) / 86_400_000)
  if (ageDays <= PRICING_FRESHNESS_DAYS) {
    return makeItem({ applies: true })
  }
  return makeItem({
    actionable: true,
    applies: true,
    items: [
      `model-pricing snapshot is ${String(ageDays)} days old — re-source`,
    ],
  })
}

export async function probeSubmodules(
  cwd: string,
  base: string,
): Promise<DiscoveryItem> {
  const gitmodules = path.join(cwd, '.gitmodules')
  if (!existsSync(gitmodules)) {
    return makeItem({ applies: false })
  }
  // `git submodule status` marks behind/un-initialized entries with a leading
  // '+' (checked-out SHA differs from the recorded gitlink) or '-' (not
  // initialized). A clean entry has a leading space.
  let stdout = ''
  try {
    const result = await spawn('git', ['submodule', 'status'], {
      cwd,
      stdioString: true,
    })
    stdout = String(result.stdout ?? '')
  } catch (e) {
    return makeItem({
      applies: true,
      blocked: true,
      items: [errorMessage(e)],
    })
  }
  const behind: string[] = []
  const lines = stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line) {
      continue
    }
    const marker = line[0]
    if (marker === '-' || marker === '+') {
      behind.push(line.trim())
    }
  }
  if (behind.length === 0) {
    return makeItem({ applies: true })
  }
  return makeItem({
    actionable: true,
    applies: true,
    items: behind.map(
      entry => `submodule out of sync (base ${base}): ${entry}`,
    ),
  })
}

export async function discover(cwd: string): Promise<DiscoveryResult> {
  const base = await resolveDefaultBranch({ cwd })
  const [coverage, lockstep, pricing, submodules] = await Promise.all([
    probeCoverage(cwd),
    probeLockstep(cwd),
    probePricing(cwd),
    probeSubmodules(cwd, base),
  ])
  return {
    __proto__: null,
    base,
    categories: {
      __proto__: null,
      coverage,
      lockstep,
      pricing,
      submodules,
    },
    cwd,
  } as DiscoveryResult
}

async function main(): Promise<void> {
  const cwd = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
  const result = await discover(cwd)
  logger.log(JSON.stringify(result, null, 2))
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  // A probe never blocks: report empty and exit clean so the umbrella can carry
  // on with the categories that did resolve.
  process.exitCode = 0
})
