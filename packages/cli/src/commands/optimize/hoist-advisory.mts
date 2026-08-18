/**
 * Hoisting advisory for the optimize command, odai-assisted. Cross-major
 * duplicates are where dependency issues breed (two majors of one package in
 * the tree, each pulling its own transitive world). The advisory names them
 * and, when the on-device model is present, gives each a hoist-safety
 * verdict from odai's hoist task: the model extracts the breaking changes
 * from the target's changelog and the deterministic rule decides whether
 * unifying on the higher major is safe.
 *
 * Key Functions: - findCrossMajorDuplicates: majors per package in the
 * lockfile. - hoistAdvisory: the advisory lines, odai-verdicts when the
 * backend is present, mechanical list when it is not.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { getMajor as getMajorVersion } from '../../util/semver.mts'

import { fetchPackageManifest } from '@socketsecurity/lib-stable/packages/manifest'
import { safeReadFile } from '@socketsecurity/lib-stable/fs/read-file'
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import * as odai from '@socketsecurity/odai'
import {
  assessHoistSafety,
  createOdaiModel,
  probeAvailability,
} from '@socketsecurity/odai'
import type { HoistAssessment } from '@socketsecurity/odai'

/**
 * Odai's changelog helper (odai >=0.3) with the pacote-README fallback for
 * the released line. Same contract either way: text plus its provenance.
 */
async function changelogFor(
  root: string,
  name: string,
  target: string,
): Promise<{ source: string; text: string }> {
  const helper = (odai as Record<string, unknown>)['fetchChangelog']
  if (typeof helper === 'function') {
    const result = await (
      helper as (
        name: string,
        options?: { root?: string; version?: string },
      ) => Promise<{ source: string; text: string }>
    )(name, { root, version: target })
    return result.source === 'none' ? { source: 'none', text: '' } : result
  }
  const local = findLocalChangelog(root, name)
  if (local !== undefined) {
    return { source: 'CHANGELOG.md', text: local }
  }
  const manifest = await fetchPackageManifest(`${name}@${target}`)
  const text =
    typeof manifest?.['readme'] === 'string'
      ? (manifest['readme'] as string).slice(0, 8000)
      : ''
  return {
    source: text.length > 0 ? 'registry README' : 'none',
    text,
  }
}

export type HoistDuplicate = {
  name: string
  majors: number[]
  versions: string[]
}

export type HoistAdvisoryLine = {
  duplicate: HoistDuplicate
  suggestion: string
  verdict?: HoistAssessment | undefined
}

const MAX_ADVISED = 5

/**
 * Packages present under two or more majors, from the pnpm lockfile's
 * package keys. The lockfile is the installed truth — the registry's view of
 * "latest" is irrelevant to what the tree actually carries.
 */
export async function findCrossMajorDuplicates(
  root: string,
): Promise<HoistDuplicate[]> {
  const lockPath = path.join(root, 'pnpm-lock.yaml')
  if (!existsSync(lockPath)) {
    return []
  }
  const content = await safeReadFile(lockPath, { encoding: 'utf8' })
  const versionsByName = new Map<string, Set<string>>()
  const keyRe =
    /^\s{2}(?:'|")?((?:@[a-z0-9-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:[-+][^'"\s]*)?)(?:'|")?\s*:/gim
  for (const match of content.matchAll(keyRe)) {
    const [, name, version] = match as unknown as [string, string, string]
    let versions = versionsByName.get(name)
    if (versions === undefined) {
      versions = new Set()
      versionsByName.set(name, versions)
    }
    versions.add(version)
  }
  const duplicates: HoistDuplicate[] = []
  for (const [name, versions] of versionsByName) {
    const majors = [
      ...new Set([...versions].map(v => getMajorVersion(v) ?? 0)),
    ].sort((a, b) => a - b)
    if (majors.length >= 2) {
      duplicates.push({
        majors,
        name,
        versions: [...versions].sort(),
      })
    }
  }
  return duplicates
}

function nodeMajorOf(root: string): number {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8'),
    )
    const engines = pkg['engines']?.['node'] ?? ''
    const match = /(\d+)/.exec(engines)
    return match ? Number.parseInt(match[1]!, 10) : 18
  } catch {
    return 18
  }
}

const CHANGELOG_NAMES = ['CHANGELOG.md', 'CHANGELOG', 'HISTORY.md']

/**
 * The installed copy's changelog, when the package ships one. Scoped to the
 * top level of the package dir — nested paths belong to subtrees the
 * duplicate already covers by name.
 */
function findLocalChangelog(root: string, name: string): string | undefined {
  const pkgDir = path.join(root, 'node_modules', name)
  for (const file of CHANGELOG_NAMES) {
    const candidate = path.join(pkgDir, file)
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, 'utf8').slice(0, 8000)
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/**
 * The advisory. Cap at MAX_ADVISED duplicates (the worst offenders first by
 * major spread), verdict each when odai is available, and degrade to the
 * mechanical list with the reason when it is not.
 */
export async function hoistAdvisory(
  root: string | undefined,
): Promise<HoistAdvisoryLine[]> {
  if (typeof root !== 'string' || root.length === 0) {
    debugDir({ hoistAdvisory: 'no project path' })
    return []
  }
  const duplicates = await findCrossMajorDuplicates(root)
  if (duplicates.length === 0) {
    return []
  }
  duplicates.sort(
    (a, b) => b.majors.length - a.majors.length || a.name.localeCompare(b.name),
  )
  const advised = duplicates.slice(0, MAX_ADVISED)

  const availability = await probeAvailability()
  if (!availability.available) {
    debug('odai backend unavailable; mechanical hoist advisory only')
    debugDir({ availability })
    return advised.map(duplicate => ({
      duplicate,
      suggestion:
        `${duplicate.name} sits on majors ${duplicate.majors.join(', ')} — ` +
        'review unifying on the higher major (odai backend unavailable; ' +
        'install Chrome ≥148 for the hoist-safety verdict)',
    }))
  }

  const model = await createOdaiModel()
  const lines: HoistAdvisoryLine[] = []
  for (const duplicate of advised) {
    const lowest = duplicate.versions.find(
      v => getMajorVersion(v) === duplicate.majors[0],
    )!
    const target = duplicate.versions.find(
      v => getMajorVersion(v) === duplicate.majors[duplicate.majors.length - 1],
    )!
    // Changelog source via odai's provenance helper (registry README when
    // the released odai predates it). The source is LABELED in the output so
    // a verdict's provenance is never invisible.
    const { source, text: changelog } = await changelogFor(
      root,
      duplicate.name,
      target,
    )

    let verdict: HoistAssessment | undefined
    let assessFailed = false
    let backend: string | undefined
    if (changelog.length > 0) {
      try {
        const result = await assessHoistSafety(model, {
          changelog,
          currentVersion: lowest,
          minNodeSupported: nodeMajorOf(root),
          targetVersion: target,
        })
        if (result.ok && result.data !== undefined) {
          verdict = result.data
          backend = result.model
        } else {
          assessFailed = true
        }
      } catch {
        assessFailed = true
      }
    }

    // The model label appended to odai verdicts: the detected model identity
    // (Gemini Nano today, Gemma 4 later), queried once and cached by odai,
    // with the backend's registry name as the fallback when detection fails
    // — odai names backends by interface (chrome-builtin = Chrome's Prompt
    // API, llama-server, apple-fm, windows-phi-silica, simulator) because
    // the weights behind them change.
    // Produces: `(odai Gemini Nano)` when odai stamps its identity (>=0.3);
    // NO label when nothing is stamped — the availability namespace
    // ('modern') carries no identity, and a meaningless label does not print.
    const via = backend === undefined ? '' : ` (odai ${backend})`
    let suggestion: string
    if (verdict !== undefined && verdict.verdict === 'safe') {
      suggestion =
        `${duplicate.name} ${lowest} → ${target}: safe to unify — ` +
        `add \`hoistPattern: ['${duplicate.name}']\` to .npmrc` +
        ` (assessed against ${source}${via})`
    } else if (verdict !== undefined) {
      const reasons = verdict.breakingChanges.slice(0, 2).join('; ')
      suggestion =
        `${duplicate.name} ${lowest} → ${target}: ${verdict.verdict}` +
        (reasons
          ? ` (${reasons})`
          : verdict.reason
            ? ` (${verdict.reason})`
            : '') +
        ` (assessed against ${source}${via})`
    } else if (changelog.length > 0 && assessFailed) {
      suggestion =
        `${duplicate.name} ${lowest} → ${target}: assessment failed against ` +
        `${source} — review manually`
    } else {
      suggestion =
        `${duplicate.name} sits on majors ${duplicate.majors.join(', ')} — ` +
        'review unifying (no changelog to assess against)'
    }
    lines.push({ duplicate, suggestion, verdict })
  }
  return lines
}
