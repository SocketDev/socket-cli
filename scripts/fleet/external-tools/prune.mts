#!/usr/bin/env node
/**
 * @file `external-tools prune` — drop stale `soakBypass` blocks from tool
 *   entries. A freshly-bumped pin that published inside the `minimumReleaseAge`
 *   soak carries a dated `soakBypass` ({ version, published, removable }) so
 *   the install-time soak check waives it until the window clears; once the
 *   release has soaked long enough the block is dead weight and should be
 *   dropped. This verb finds those cleared blocks and removes them — the
 *   manifest-side twin of the pnpm-workspace.yaml soak-exclude cleanup, and the
 *   counterpart to `soak-bypass.mts` (which ADDS the workspace entry).
 *   Staleness is decided against the LIVE soak policy: the `minimumReleaseAge`
 *   minutes are read from pnpm-workspace.yaml via ../soak-rules.mts, so a
 *   policy change re-scopes what counts as cleared (falling back to the
 *   baked-in `removable` date when a block has no parseable `published`).
 *   Multi-manifest like the other read/mutate verbs; dry-run by default,
 *   `--apply` writes through EditableJson so surviving keys keep their order.
 *   Usage: node scripts/fleet/external-tools/prune.mts [--target <file>]
 *   [--apply]
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import {
  loadManifest,
  relPath,
  requireValue,
  resolveTargets,
} from './_shared.mts'
import type { SoakBypass, Tool } from './update.mts'

import { PNPM_WORKSPACE_YAML } from '../paths.mts'
import { readSoakRules } from '../soak-rules.mts'

const logger = getDefaultLogger()

export interface PruneConfig {
  target: string | undefined
  apply: boolean
}

export function parseArgs(argv: string[] = process.argv.slice(2)): PruneConfig {
  const opts: PruneConfig = { target: undefined, apply: false }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--apply') {
      opts.apply = true
    } else if (a === '--target') {
      opts.target = requireValue(argv, i, '--target')
      i += 1
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  return opts
}

/**
 * Has a `soakBypass` block's soak window passed? Decided against the live soak
 * policy first — `published + soakMinutes <= now` — so a policy change
 * re-scopes staleness; falls back to the baked-in `removable` date only when
 * `published` is missing/unparseable. `now` is injectable for tests.
 */
export function isSoakBypassStale(
  bypass: SoakBypass,
  soakMinutes: number,
  now: number = Date.now(),
): boolean {
  const publishedMs = Date.parse(bypass.published)
  if (Number.isFinite(publishedMs)) {
    return publishedMs + soakMinutes * 60_000 <= now
  }
  const removableMs = Date.parse(bypass.removable)
  return Number.isFinite(removableMs) ? removableMs <= now : false
}

interface PrunedTool {
  name: string
  bypass: SoakBypass
  updated: Tool
}

/**
 * The tools in one manifest whose `soakBypass` has cleared, each paired with
 * the entry rewritten to drop that block (key order otherwise preserved).
 */
export function planManifestPrune(
  tools: Readonly<Record<string, Tool>>,
  soakMinutes: number,
  now: number = Date.now(),
): PrunedTool[] {
  const entries = Object.entries(tools)
  const out: PrunedTool[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const [name, tool] = entries[i]!
    const record = tool as unknown as Record<string, unknown>
    const bypass = record['soakBypass'] as SoakBypass | undefined
    if (!bypass || !isSoakBypassStale(bypass, soakMinutes, now)) {
      continue
    }
    const updated = { ...record }
    delete updated['soakBypass']
    out.push({ name, bypass, updated: updated as unknown as Tool })
  }
  return out
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const opts = parseArgs(argv)
  const { minutes: soakMinutes } = readSoakRules(PNPM_WORKSPACE_YAML)
  const now = Date.now()
  const targets = resolveTargets({ target: opts.target })
  if (targets.length === 0) {
    logger.error('No external-tools.json manifests found.')
    return 1
  }
  let anyPruned = false
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    let editable
    try {
      editable = await loadManifest(target)
    } catch (e) {
      logger.error(`Skipping unreadable ${relPath(target)}: ${errorMessage(e)}`)
      continue
    }
    const pruned = planManifestPrune(
      editable.content.tools ?? {},
      soakMinutes,
      now,
    )
    if (pruned.length === 0) {
      continue
    }
    anyPruned = true
    process.stdout.write(
      `--- ${relPath(target)} (${opts.apply ? 'prune' : 'would prune'} ${pruned.length})\n`,
    )
    const nextTools = { ...editable.content.tools }
    for (let j = 0, { length: rows } = pruned; j < rows; j += 1) {
      const { bypass, name, updated } = pruned[j]!
      process.stdout.write(
        `  ${name}: soakBypass cleared (version ${bypass.version}, removable ${bypass.removable})\n`,
      )
      nextTools[name] = updated
    }
    if (opts.apply) {
      editable.update({ tools: nextTools })
      await editable.save({ sort: false })
      process.stdout.write(`  Wrote ${relPath(target)}\n`)
    }
  }
  if (!anyPruned) {
    process.stdout.write('No stale soakBypass entries to prune.\n')
    return 0
  }
  if (!opts.apply) {
    process.stdout.write('\nDry run. Pass --apply to write.\n')
  }
  return 0
}

// Guarded so importing this module (the unit test) doesn't run the CLI. Fail-
// soft: surface the reason via logger.error, set a non-zero exit code, never a
// raw unhandled throw.
if (import.meta.main) {
  main().then(
    code => {
      process.exitCode = code
    },
    e => {
      logger.error(errorMessage(e))
      process.exitCode = 1
    },
  )
}
