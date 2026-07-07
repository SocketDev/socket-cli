#!/usr/bin/env node
/*
 * @file HOLD helper for the landing machinery. When the user says
 *   hold/park/wait on specific work, run this to record the paths; the
 *   auto-lander skips them and dirty-worktree-stop-guard treats them as
 *   sanctioned-dirty until cleared or expired (24h TTL).
 *
 *   Usage (from the repo root):
 *     node .claude/hooks/fleet/auto-land-on-stop/hold.mts <path…> [--note "<why>"]
 *     node .claude/hooks/fleet/auto-land-on-stop/hold.mts --list
 *     node .claude/hooks/fleet/auto-land-on-stop/hold.mts --clear <path…>
 *     node .claude/hooks/fleet/auto-land-on-stop/hold.mts --clear-all
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  clearParked,
  parkPaths,
  readParked,
  resolveParkedFile,
} from '../_shared/parked-paths.mts'

const logger = getDefaultLogger()

export function parseHoldArgs(argv: readonly string[]): {
  clear: boolean
  clearAll: boolean
  list: boolean
  note: string | undefined
  paths: string[]
} {
  const paths: string[] = []
  let clear = false
  let clearAll = false
  let list = false
  let note: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--clear') {
      clear = true
    } else if (arg === '--clear-all') {
      clearAll = true
    } else if (arg === '--list') {
      list = true
    } else if (arg === '--note') {
      note = argv[i + 1]
      i += 1
    } else {
      paths.push(arg)
    }
  }
  return { clear, clearAll, list, note, paths }
}

export function main(): void {
  const parsed = parseHoldArgs(process.argv.slice(2))
  const filePath = resolveParkedFile(
    process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd(),
  )
  const now = Date.now()
  const abs = parsed.paths.map(p => path.resolve(p))

  if (parsed.clearAll) {
    clearParked(filePath, undefined, { now })
    logger.log('cleared every parked path')
    return
  }
  if (parsed.clear) {
    if (abs.length === 0) {
      logger.error(
        'hold --clear: no paths given. Saw a bare --clear; wanted --clear <path…> or --clear-all.',
      )
      process.exitCode = 1
      return
    }
    const remaining = clearParked(filePath, abs, { now })
    logger.log(
      `cleared ${abs.length} path(s); ${remaining.length} still parked`,
    )
    return
  }
  if (parsed.list || abs.length === 0) {
    const entries = readParked(filePath, { now })
    if (entries.length === 0) {
      logger.log('nothing parked')
      return
    }
    for (const e of entries) {
      logger.log(`${e.path}${e.note ? `  — ${e.note}` : ''}`)
    }
    return
  }
  const entries = parkPaths(filePath, abs, { note: parsed.note, now })
  logger.log(
    `parked ${abs.length} path(s) (${entries.length} total). The auto-lander and ` +
      'dirty-worktree guard will skip them until cleared (--clear) or 24h pass.',
  )
}

/* c8 ignore start - entrypoint guard; exercised via subprocess in integration */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    main()
  })()
}
/* c8 ignore stop */
