#!/usr/bin/env node
/**
 * @file Trim the CLAUDE.md fleet-canonical block under its byte cap by dropping
 *   the last `; `-clause of the fattest doc-linked bullet (its detail lives in
 *   the linked docs/agents.md page). Report-only by default; `--apply` writes.
 *   Operates on the live CLAUDE.md and, in the wheelhouse, the template source.
 *   Deterministic. Backs the `claude-md-section-size-guard` remediation and the
 *   `pnpm run fix` auto-trim. Usage: node scripts/fleet/trim-claude-md.mts #
 *   report what it would trim node scripts/fleet/trim-claude-md.mts --apply #
 *   trim in place.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import {
  applyClaudeMdTrim,
  FLEET_BLOCK_MAX_BYTES,
  fleetBlockBytes,
  trimFleetBlockToFit,
} from './lib/claude-md-trim.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

/**
 * The CLAUDE.md files this repo owns: the live root file and, in the
 * wheelhouse, the cascade-source template copy.
 */
export function claudeMdFiles(repoRoot: string): string[] {
  return [
    path.join(repoRoot, 'CLAUDE.md'),
    path.join(repoRoot, 'template', 'base', 'CLAUDE.md'),
  ]
}

function reportFile(file: string): boolean {
  if (!existsSync(file)) {
    return false
  }
  const content = readFileSync(file, 'utf8')
  const bytes = fleetBlockBytes(content)
  if (bytes === undefined) {
    return false
  }
  const rel = path.relative(REPO_ROOT, file)
  if (bytes <= FLEET_BLOCK_MAX_BYTES) {
    logger.log(
      `${rel}: fleet block ${bytes}/${FLEET_BLOCK_MAX_BYTES} bytes (ok).`,
    )
    return false
  }
  const { trims } = trimFleetBlockToFit(content)
  logger.warn(
    `${rel}: fleet block ${bytes}/${FLEET_BLOCK_MAX_BYTES} bytes — over by ` +
      `${bytes - FLEET_BLOCK_MAX_BYTES}; ${trims.length} clause-trim(s) would ` +
      `fit it. Run \`node scripts/fleet/trim-claude-md.mts --apply\`.`,
  )
  return true
}

function main(): void {
  const files = claudeMdFiles(REPO_ROOT)
  if (process.argv.includes('--apply')) {
    const results = applyClaudeMdTrim(files)
    if (results.length === 0) {
      logger.log('trim-claude-md: nothing to trim (every block under cap).')
      return
    }
    for (let i = 0, { length } = results; i < length; i += 1) {
      const r = results[i]!
      const rel = path.relative(REPO_ROOT, r.file)
      for (let j = 0, jl = r.trims.length; j < jl; j += 1) {
        logger.info(
          `${rel} L${r.trims[j]!.line + 1}: trimmed last clause of the fattest bullet`,
        )
      }
    }
    return
  }
  let anyOver = false
  for (let i = 0, { length } = files; i < length; i += 1) {
    if (reportFile(files[i]!)) {
      anyOver = true
    }
  }
  if (anyOver) {
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
