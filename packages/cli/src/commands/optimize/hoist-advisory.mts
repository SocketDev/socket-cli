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
import {
  assessHoistSafety,
  createOdaiModel,
  probeAvailability,
} from '@socketsecurity/odai'
import type { HoistAssessment } from '@socketsecurity/odai'

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
  const keyRe = /^\s{2}(?:'|")?((?:@[a-z0-9-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:[-+][^'"\s]*)?)(?:'|")?\s*:/gim
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
    const manifest = await fetchPackageManifest(
      `${duplicate.name}@${target}`,
    )
    const changelog =
      typeof manifest?.['readme'] === 'string'
        ? (manifest['readme'] as string).slice(0, 8000)
        : ''
    let verdict: HoistAssessment | undefined
    let suggestion: string
    if (changelog.length > 0) {
      const result = await assessHoistSafety(model, {
        changelog,
        currentVersion: lowest,
        minNodeSupported: nodeMajorOf(root),
        targetVersion: target,
      })
      if (result.ok && result.data !== undefined) {
        verdict = result.data
      }
    }
    if (verdict !== undefined && verdict.verdict === 'safe') {
      suggestion =
        `${duplicate.name} ${lowest} → ${target}: safe to unify — ` +
        `add \`hoistPattern: ['${duplicate.name}']\` to .npmrc`
    } else if (verdict !== undefined) {
      const reasons = verdict.breakingChanges.slice(0, 2).join('; ')
      suggestion =
        `${duplicate.name} ${lowest} → ${target}: ${verdict.verdict}` +
        (reasons ? ` (${reasons})` : verdict.reason ? ` (${verdict.reason})` : '')
    } else {
      suggestion =
        `${duplicate.name} sits on majors ${duplicate.majors.join(', ')} — ` +
        'review unifying (no changelog to assess against)'
    }
    lines.push({ duplicate, suggestion, verdict })
  }
  return lines
}
