#!/usr/bin/env node
/**
 * @file `external-tools list` — print every tool across the shipped manifests
 *   (or a single `--target`) as `name  version  (kind)`. Read-only; never
 *   writes. Fail-soft: an unreadable manifest is skipped with a logged reason,
 *   never a raw throw.
 *   Usage: node scripts/fleet/external-tools/list.mts [--target <file>]
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import {
  listTools,
  loadManifest,
  relPath,
  requireValue,
  resolveTargets,
} from './_shared.mts'

import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface ListConfig {
  target: string | undefined
}

export function parseArgs(argv: string[] = process.argv.slice(2)): ListConfig {
  const opts: ListConfig = { target: undefined }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--target') {
      opts.target = requireValue(argv, i, '--target')
      i += 1
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  return opts
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const opts = parseArgs(argv)
  const targets = resolveTargets({ target: opts.target })
  if (targets.length === 0) {
    logger.error('No external-tools.json manifests found.')
    return 1
  }
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    let content
    try {
      content = (await loadManifest(target)).content
    } catch (e) {
      logger.error(`Skipping unreadable ${relPath(target)}: ${errorMessage(e)}`)
      continue
    }
    process.stdout.write(`# ${relPath(target)}\n`)
    const summaries = listTools(content)
    for (let j = 0, { length: rows } = summaries; j < rows; j += 1) {
      const s = summaries[j]!
      process.stdout.write(`${s.name.padEnd(22)} ${s.version}  (${s.kind})\n`)
    }
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'print every external tool across the shipped manifests as name, version, kind',
  help: `Usage: node scripts/fleet/external-tools/list.mts [flags]
  --target <file>  limit the listing to one manifest file`,
}

// Guarded so importing this module, the unit test, doesn't run the CLI.
if (import.meta.main) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
