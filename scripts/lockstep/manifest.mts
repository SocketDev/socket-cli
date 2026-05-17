/**
 * @fileoverview Manifest loading + sub-manifest tree resolution.
 *
 * `readManifest` parses one `lockstep.json` (or sub-manifest) and runs it
 * through the TypeBox schema; schema failures terminate the process with
 * exit 1 and a per-issue error trail (deeper than a single throw).
 *
 * `loadManifestTree` walks the top-level manifest's `includes[]` array,
 * reads each sub-manifest, and produces a flattened view: per-area
 * manifest list (preserving file boundaries for per-area reports) plus
 * a merged view (upstreams + sites union, rows concatenated). The merge
 * uses null-prototype maps to keep attacker-controlled manifest keys
 * out of the prototype chain.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { validateSchema } from '@socketsecurity/lib-stable/schema/validate'

import {
  LockstepManifestSchema,
  type Row,
  type Site,
  type Upstream,
} from './schema.mts'

import type { Manifest } from './types.mts'

const logger = getDefaultLogger()

export function readManifest(manifestPath: string): Manifest {
  if (!existsSync(manifestPath)) {
    logger.error(`lockstep: manifest not found at ${manifestPath}`)
    process.exit(1)
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    logger.error(`lockstep: could not parse ${manifestPath}`)
    logger.fail(`  ${errorMessage(e)}`)
    process.exit(1)
  }
  const result = validateSchema(LockstepManifestSchema, raw)
  if (result.ok) {
    return result.value
  }
  logger.error(`lockstep: schema validation failed for ${manifestPath}`)
  for (const issue of result.errors) {
    const loc = issue.path.length ? issue.path.join('.') : '<root>'
    logger.fail(`  ${loc}: ${issue.message}`)
  }
  process.exit(1)
}

/**
 * Resolve a manifest + all its `includes[]` sub-manifests into a single
 * flattened view. Each sub-manifest contributes its rows; the top-level
 * upstreams/sites maps are merged (top-level wins on conflict).
 */
export function loadManifestTree(rootManifestPath: string): {
  areas: Array<{ area: string; manifest: Manifest }>
  merged: Manifest
} {
  const rootManifest = readManifest(rootManifestPath)
  const rootArea = rootManifest.area ?? 'root'
  const areas: Array<{ area: string; manifest: Manifest }> = [
    { area: rootArea, manifest: rootManifest },
  ]

  const includes = rootManifest.includes ?? []
  const baseDir = path.dirname(rootManifestPath)
  for (const rel of includes) {
    const subPath = path.resolve(baseDir, rel)
    const sub = readManifest(subPath)
    const area =
      sub.area ?? path.basename(rel, '.json').replace(/^lockstep-/, '')
    areas.push({ area, manifest: sub })
  }

  // Null-prototype maps guard against prototype pollution via untrusted
  // manifest keys. Double-cast through `unknown` so the
  // `exactOptionalPropertyTypes + noUncheckedIndexedAccess` strict
  // tsconfig in some repos accepts the `__proto__` sigil.
  const mergedUpstreams: Record<string, Upstream> = {
    __proto__: null,
  } as unknown as Record<string, Upstream>
  const mergedSites: Record<string, Site> = {
    __proto__: null,
  } as unknown as Record<string, Site>

  const mergedRows: Row[] = []
  // Include order, root last so it wins on duplicate keys.
  for (const { manifest } of [...areas.slice(1), ...areas.slice(0, 1)]) {
    for (const [k, v] of Object.entries(manifest.upstreams ?? {})) {
      mergedUpstreams[k] = v
    }
    for (const [k, v] of Object.entries(manifest.sites ?? {})) {
      mergedSites[k] = v
    }
  }
  for (const { manifest } of areas) {
    mergedRows.push(...manifest.rows)
  }
  return {
    areas,
    merged: {
      upstreams: mergedUpstreams,
      sites: mergedSites,
      rows: mergedRows,
    },
  }
}
