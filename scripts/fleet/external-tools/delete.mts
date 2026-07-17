#!/usr/bin/env node
/**
 * @file `external-tools delete <name>` — remove a tool entry from every
 *   manifest that carries it (or a single `--target`). Dry-run by default:
 *   prints the entry it would drop from each manifest; `--apply` removes it
 *   through EditableJson so the surviving keys keep their order + formatting.
 *   Exits non-zero when the tool is in none of the target manifests. Usage:
 *   node scripts/fleet/external-tools/delete.mts <name> [--target <file>]
 *   [--apply]
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import type { EditableJsonInstance } from '@socketsecurity/lib/json/types'

import {
  loadManifest,
  relPath,
  requireValue,
  resolveTargets,
} from './_shared.mts'
import type { ExternalToolsJson, Tool } from './update.mts'

const logger = getDefaultLogger()

export interface DeleteOptions {
  name: string | undefined
  target: string | undefined
  apply: boolean
}

export function parseArgs(
  argv: string[] = process.argv.slice(2),
): DeleteOptions {
  const opts: DeleteOptions = {
    name: undefined,
    target: undefined,
    apply: false,
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--apply') {
      opts.apply = true
    } else if (a === '--target') {
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

interface Hit {
  target: string
  editable: EditableJsonInstance<ExternalToolsJson>
  entry: Tool
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const opts = parseArgs(argv)
  if (!opts.name) {
    logger.error('delete requires a tool name: delete <name> [--apply]')
    return 1
  }
  const name = opts.name
  const targets = resolveTargets({ target: opts.target })
  // First pass — find every manifest that carries the tool (a manifest that
  // can't be read is skipped, fail-soft). No writes yet, so the dry-run diff
  // below never mutates.
  const hits: Hit[] = []
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    let editable: EditableJsonInstance<ExternalToolsJson>
    try {
      editable = await loadManifest(target)
    } catch {
      continue
    }
    const entry = editable.content.tools?.[name]
    if (entry === undefined) {
      continue
    }
    hits.push({ target, editable, entry })
  }
  if (hits.length === 0) {
    logger.error(`Tool "${name}" not found in any target manifest.`)
    return 1
  }
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const { entry, target } = hits[i]!
    process.stdout.write(
      `--- ${relPath(target)} (${opts.apply ? 'remove' : 'would remove'} "${name}")\n`,
    )
    const lines = JSON.stringify(entry, null, 2).split('\n')
    for (let j = 0, { length: rows } = lines; j < rows; j += 1) {
      process.stdout.write(`- ${lines[j]!}\n`)
    }
  }
  if (!opts.apply) {
    process.stdout.write('\nDry run. Pass --apply to write.\n')
    return 0
  }
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const { editable, target } = hits[i]!
    const nextTools = { ...editable.content.tools }
    delete nextTools[name]
    editable.update({ tools: nextTools })
    await editable.save({ sort: false })
    process.stdout.write(`Removed "${name}" from ${relPath(target)}\n`)
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
