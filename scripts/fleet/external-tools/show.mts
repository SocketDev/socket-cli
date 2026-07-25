#!/usr/bin/env node
/**
 * @file `external-tools show <name>` — print one tool's full entry (JSON) from
 *   every manifest that carries it (or a single `--target`). Read-only. Exits
 *   non-zero when the tool is in none of the target manifests.
 *   Usage: node scripts/fleet/external-tools/show.mts <name> [--target <file>]
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

const logger = getDefaultLogger()

export interface ShowConfig {
  name: string | undefined
  target: string | undefined
}

export function parseArgs(argv: string[] = process.argv.slice(2)): ShowConfig {
  const opts: ShowConfig = { name: undefined, target: undefined }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--target') {
      opts.target = requireValue(argv, i, '--target')
      i += 1
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown argument: ${a}`)
    } else if (opts.name === undefined) {
      opts.name = a
    } else {
      throw new Error(`Unexpected positional argument: ${a}`)
    }
  }
  return opts
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const opts = parseArgs(argv)
  if (!opts.name) {
    logger.error('show requires a tool name: show <name> [--target <file>]')
    return 1
  }
  const targets = resolveTargets({ target: opts.target })
  let found = false
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    let content
    try {
      content = (await loadManifest(target)).content
    } catch {
      continue
    }
    const entry = content.tools?.[opts.name]
    if (entry === undefined) {
      continue
    }
    found = true
    process.stdout.write(`# ${relPath(target)}\n`)
    process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`)
  }
  if (!found) {
    logger.error(`Tool "${opts.name}" not found in any target manifest.`)
    return 1
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
