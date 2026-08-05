#!/usr/bin/env node
/**
 * @file Aggregate the guard-event log into per-hook precision stats. Every
 *   block/notify verdict lands in
 *   `.cache/fleet/guard-events/events.jsonl`; this reads it and
 *   reports, per hook: blocks, notifies, distinct files, and RETRY-SUSPECTS —
 *   the same hook blocking the same file 2+ times inside a short window,
 *   which is what an operator word-golfing around a false positive looks
 *   like. A hook that tops the retry-suspect column is a matcher to tune,
 *   found from data instead of incident reports.
 *   Usage: node scripts/fleet/guard-stats.mts [--json]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import type { ScriptMeta } from './_shared/run-main.mts'
import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

// Two blocks on one hook+file within this window count as a retry pair.
export const RETRY_WINDOW_MS = 10 * 60 * 1000

export interface GuardEvent {
  readonly ts: number
  readonly kind: 'block' | 'notify'
  readonly hook?: string | undefined
  readonly tool?: string | undefined
  readonly file?: string | undefined
  readonly message?: string | undefined
}

export interface HookStats {
  readonly hook: string
  readonly blocks: number
  readonly notifies: number
  readonly files: number
  readonly retrySuspects: number
}

export function parseEvents(raw: string): GuardEvent[] {
  const out: GuardEvent[] = []
  const lines = raw.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line) {
      continue
    }
    try {
      const parsed = JSON.parse(line) as GuardEvent
      if (typeof parsed.ts === 'number' && parsed.kind) {
        out.push(parsed)
      }
    } catch {
      // A torn line from a rotation race — skip it.
    }
  }
  return out
}

export function aggregate(events: readonly GuardEvent[]): HookStats[] {
  const byHook = new Map<
    string,
    {
      blocks: number
      notifies: number
      files: Set<string>
      blockTimes: Map<string, number[]>
    }
  >()
  for (let i = 0, { length } = events; i < length; i += 1) {
    const e = events[i]!
    const hook = e.hook ?? '(unattributed)'
    let entry = byHook.get(hook)
    if (!entry) {
      entry = {
        blocks: 0,
        notifies: 0,
        files: new Set(),
        blockTimes: new Map(),
      }
      byHook.set(hook, entry)
    }
    if (e.file) {
      entry.files.add(e.file)
    }
    if (e.kind === 'block') {
      entry.blocks += 1
      const key = e.file ?? '(no file)'
      const times = entry.blockTimes.get(key)
      if (times) {
        times.push(e.ts)
      } else {
        entry.blockTimes.set(key, [e.ts])
      }
    } else {
      entry.notifies += 1
    }
  }
  const stats: HookStats[] = []
  for (const [hook, entry] of byHook) {
    let retrySuspects = 0
    for (const times of entry.blockTimes.values()) {
      const sorted = times.toSorted((a, b) => a - b)
      for (let i = 1, { length } = sorted; i < length; i += 1) {
        if (sorted[i]! - sorted[i - 1]! <= RETRY_WINDOW_MS) {
          retrySuspects += 1
        }
      }
    }
    stats.push({
      hook,
      blocks: entry.blocks,
      notifies: entry.notifies,
      files: entry.files.size,
      retrySuspects,
    })
  }
  return stats.toSorted(
    (a, b) => b.retrySuspects - a.retrySuspects || b.blocks - a.blocks,
  )
}

export function main(): number {
  const dir = path.join(REPO_ROOT, '.cache', 'fleet', 'guard-events')
  const sources = ['events.1.jsonl', 'events.jsonl']
    .map(name => path.join(dir, name))
    .filter(p => existsSync(p))
  if (sources.length === 0) {
    logger.log('guard-stats: no guard events recorded yet.')
    return 0
  }
  const events = sources.flatMap(p => parseEvents(readFileSync(p, 'utf8')))
  const stats = aggregate(events)
  if (process.argv.includes('--json')) {
    logger.log(JSON.stringify({ events: events.length, stats }, undefined, 2))
    return 0
  }
  logger.log(
    `guard-stats: ${events.length} event(s). retry-suspects = same hook blocking the same file twice within ${RETRY_WINDOW_MS / 60_000}m (the word-golf / false-positive proxy).`,
  )
  logger.log('')
  logger.log(
    '  hook                                     blocks  notify  files  retry-suspects',
  )
  for (let i = 0, { length } = stats; i < length; i += 1) {
    const s = stats[i]!
    logger.log(
      `  ${s.hook.padEnd(40)} ${String(s.blocks).padStart(6)} ${String(s.notifies).padStart(7)} ${String(s.files).padStart(6)} ${String(s.retrySuspects).padStart(15)}`,
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'aggregate the guard-event log into per-hook precision and retry-suspect stats',
  help: `Usage: node scripts/fleet/guard-stats.mts [flags]
  --json  print the stats as JSON`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
