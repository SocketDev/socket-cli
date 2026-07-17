#!/usr/bin/env node
/**
 * @file `external-tools edit <name>` — set fields on an EXISTING tool entry,
 *   surgically, through EditableJson so only the touched values change and the
 *   file's key order + formatting survive. Editable fields: --description
 *   <text> the human blurb --note <text> (repeat) the `notes` list
 *   (references); one note is stored as a string, several as an array --version
 *   <v> the pinned version string --platform <key> --integrity <sri> set one
 *   platform's SRI integrity --platform <key> --sha <hex> same, from a raw
 *   sha-512 hex digest (converted via the updater's hexToSri) Multi-manifest
 *   like `show` / `delete`: the edit lands in every shipped manifest that
 *   carries the tool (keeping cascaded copies in sync), or a single `--target`.
 *   Dry-run by default; `--apply` writes. A requested platform that a
 *   manifest's entry lacks is reported and that manifest is left untouched
 *   (never a partial edit), and the run exits non-zero. Usage: node
 *   scripts/fleet/external-tools/edit.mts <name> [edits …] [--target <file>]
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
import { hexToSri } from './update.mts'
import type { ExternalToolsJson, PlatformEntry, Tool } from './update.mts'

const logger = getDefaultLogger()

export interface EditOptions {
  name: string | undefined
  target: string | undefined
  apply: boolean
  description: string | undefined
  version: string | undefined
  notes: string[]
  platform: string | undefined
  integrity: string | undefined
  sha: string | undefined
}

export function parseArgs(argv: string[] = process.argv.slice(2)): EditOptions {
  const opts: EditOptions = {
    name: undefined,
    target: undefined,
    apply: false,
    description: undefined,
    version: undefined,
    notes: [],
    platform: undefined,
    integrity: undefined,
    sha: undefined,
  }
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--apply') {
      opts.apply = true
    } else if (a === '--target') {
      opts.target = requireValue(argv, i, '--target')
      i += 1
    } else if (a === '--description') {
      opts.description = requireValue(argv, i, '--description')
      i += 1
    } else if (a === '--version') {
      opts.version = requireValue(argv, i, '--version')
      i += 1
    } else if (a === '--note' || a === '--notes') {
      opts.notes.push(requireValue(argv, i, a))
      i += 1
    } else if (a === '--platform') {
      opts.platform = requireValue(argv, i, '--platform')
      i += 1
    } else if (a === '--integrity') {
      opts.integrity = requireValue(argv, i, '--integrity')
      i += 1
    } else if (a === '--sha') {
      opts.sha = requireValue(argv, i, '--sha')
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

interface ComputedEdit {
  updated: Record<string, unknown>
  changes: string[]
  problem: string | undefined
}

/**
 * Apply the requested edits to one tool entry, returning the new entry (key
 * order preserved: existing keys keep their slot, new keys append), the
 * human-readable change list, and — for a platform edit whose target key is
 * absent — a `problem` describing why this entry was left untouched.
 */
export function computeEdit(
  tool: Tool,
  options: {
    description?: string | undefined
    version?: string | undefined
    notes?: readonly string[] | undefined
    platform?: string | undefined
    integrity?: string | undefined
  },
): ComputedEdit {
  const opts = { __proto__: null, ...options } as {
    description?: string | undefined
    version?: string | undefined
    notes?: readonly string[] | undefined
    platform?: string | undefined
    integrity?: string | undefined
  }
  const updated: Record<string, unknown> = {
    ...(tool as unknown as Record<string, unknown>),
  }
  const changes: string[] = []
  if (opts.description !== undefined) {
    updated['description'] = opts.description
    changes.push('description: set')
  }
  if (opts.version !== undefined) {
    changes.push(`version: ${String(updated['version'])} → ${opts.version}`)
    updated['version'] = opts.version
  }
  const notes = opts.notes ?? []
  if (notes.length > 0) {
    updated['notes'] = notes.length === 1 ? notes[0]! : [...notes]
    changes.push(`notes: set (${notes.length})`)
  }
  if (opts.platform !== undefined && opts.integrity !== undefined) {
    const platformsRaw = updated['platforms']
    if (!platformsRaw || typeof platformsRaw !== 'object') {
      return {
        updated,
        changes,
        problem: `entry has no platforms map (can't set platform "${opts.platform}")`,
      }
    }
    const platforms = {
      ...(platformsRaw as Record<string, PlatformEntry>),
    }
    const plat = platforms[opts.platform]
    if (!plat) {
      return {
        updated,
        changes,
        problem: `entry has no platform "${opts.platform}"`,
      }
    }
    changes.push(
      `platforms.${opts.platform}.integrity: ${plat.integrity.slice(0, 20)}… → ${opts.integrity.slice(0, 20)}…`,
    )
    platforms[opts.platform] = { ...plat, integrity: opts.integrity }
    updated['platforms'] = platforms
  }
  return { updated, changes, problem: undefined }
}

interface Staged {
  target: string
  editable: EditableJsonInstance<ExternalToolsJson>
  updated: Record<string, unknown>
  changes: string[]
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const opts = parseArgs(argv)
  if (!opts.name) {
    logger.error('edit requires a tool name: edit <name> [edits …]')
    return 1
  }
  const name = opts.name
  if (opts.integrity && opts.sha) {
    logger.error('edit: pass only one of --integrity or --sha, not both.')
    return 1
  }
  // A raw sha-512 hex digest is converted to an SRI string the same way a bump
  // computes it (reusing the updater's hexToSri) — one integrity codepath.
  const integrity =
    opts.integrity ?? (opts.sha ? hexToSri(opts.sha) : undefined)
  if ((integrity !== undefined) !== (opts.platform !== undefined)) {
    logger.error(
      'edit: --platform <key> and one of --integrity/--sha must be given together.',
    )
    return 1
  }
  const hasEdit =
    opts.description !== undefined ||
    opts.version !== undefined ||
    opts.notes.length > 0 ||
    integrity !== undefined
  if (!hasEdit) {
    logger.error(
      'edit: nothing to change — pass --description / --note / --version / --platform+--integrity.',
    )
    return 1
  }
  const targets = resolveTargets({ target: opts.target })
  const staged: Staged[] = []
  let found = false
  let anyProblem = false
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
    let editable: EditableJsonInstance<ExternalToolsJson>
    try {
      editable = await loadManifest(target)
    } catch {
      continue
    }
    const tool = editable.content.tools?.[name]
    if (tool === undefined) {
      continue
    }
    found = true
    const { changes, problem, updated } = computeEdit(tool, {
      description: opts.description,
      version: opts.version,
      notes: opts.notes,
      platform: opts.platform,
      integrity,
    })
    if (problem) {
      anyProblem = true
      logger.error(`${relPath(target)}: ${problem} — left untouched.`)
      continue
    }
    staged.push({ target, editable, updated, changes })
  }
  if (!found) {
    logger.error(`Tool "${name}" not found in any target manifest.`)
    return 1
  }
  for (let i = 0, { length } = staged; i < length; i += 1) {
    const { changes, target } = staged[i]!
    process.stdout.write(
      `--- ${relPath(target)} (${opts.apply ? 'edit' : 'would edit'} "${name}")\n`,
    )
    for (let j = 0, { length: rows } = changes; j < rows; j += 1) {
      process.stdout.write(`  ${changes[j]!}\n`)
    }
  }
  if (!opts.apply) {
    process.stdout.write('\nDry run. Pass --apply to write.\n')
    return anyProblem ? 1 : 0
  }
  for (let i = 0, { length } = staged; i < length; i += 1) {
    const { editable, target, updated } = staged[i]!
    editable.update({
      tools: { ...editable.content.tools, [name]: updated as unknown as Tool },
    })
    await editable.save({ sort: false })
    process.stdout.write(`Wrote ${relPath(target)}\n`)
  }
  return anyProblem ? 1 : 0
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
