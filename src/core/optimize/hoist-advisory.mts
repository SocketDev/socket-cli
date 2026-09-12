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

import { safeReadFile } from '@socketsecurity/lib-stable/fs/read-file'
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import {
  assessHoistSafety,
  fetchChangelog,
  withOdaiModel,
} from '@socketsecurity/odai/node'
import type { HoistAssessment, OdaiModel } from '@socketsecurity/odai/node'

export async function assessHoistChangelog(
  model: OdaiModel,
  changelog: string,
  lowest: string,
  target: string,
  root: string,
) {
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

  return { __proto__: null, verdict, assessFailed, backend }
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
 * Odai's backend registry names. When the stamp is one of these, the model
 * itself was NOT identified — the label must say that, not repeat the token.
 */
const BACKEND_NAMES: readonly string[] = [
  'apple-fm',
  'chrome-builtin',
  'llama-server',
  'simulator',
  'windows-phi-silica',
]

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
  if (content === undefined) {
    return []
  }
  const versionsByName = new Map<string, Set<string>>()
  // ^\s{2}              — a 2-space-indented top-level package key line
  // (?:"|')?            — optional quote wrapping the key
  // ((?:@[a-z0-9-]+\/)?[a-z0-9._-]+) — group 1: name, with an optional @scope/
  // @(\d+\.\d+\.\d+(?:[-+][^'"\s]*)?) — group 2: semver, with optional pre-release/build
  // (?:"|')?\s*:        — optional closing quote, then the `:` key terminator
  const keyRe =
    /^\s{2}(?:"|')?((?:@[a-z0-9-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:[-+][^'"\s]*)?)(?:"|')?\s*:/gim
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
    ].toSorted((a, b) => a - b)
    if (majors.length >= 2) {
      duplicates.push({
        majors,
        name,
        versions: [...versions].toSorted(),
      })
    }
  }
  return duplicates
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

  try {
    return await withOdaiModel(
      async (model, { abortSignal }) => {
        const lines: HoistAdvisoryLine[] = []
        for (let i = 0, { length } = advised; i < length; i += 1) {
          const duplicate = advised[i]!
          const lowest = duplicate.versions.find(
            v => getMajorVersion(v) === duplicate.majors[0],
          )!
          const target = duplicate.versions.find(
            v =>
              getMajorVersion(v) ===
              duplicate.majors[duplicate.majors.length - 1],
          )!
          const { source, text: changelog } = await fetchChangelog(
            duplicate.name,
            { root, version: target, abortSignal },
          )

          const { verdict, assessFailed, backend } = await assessHoistChangelog(
            model,
            changelog,
            lowest,
            target,
            root,
          )

          // The model label appended to odai verdicts: the detected model identity
          // (Gemini Nano today, Gemma 4 later), queried once and cached by odai.
          // When detection fails, the stamp carries the backend's registry name
          // instead (odai names backends by interface: chrome-builtin = Chrome's
          // Prompt API, llama-server, apple-fm, windows-phi-silica, simulator) —
          // and then the label says so explicitly: the model is UNKNOWN, the host
          // is named.
          // Produces: `(odai Gemini Nano)` with a detected identity;
          // `(odai unknown model via chrome-builtin)` when only the backend is
          // known; NO label when nothing is stamped at all — a meaningless label
          // does not print.
          const via =
            backend === undefined
              ? ''
              : BACKEND_NAMES.includes(backend)
                ? ` (odai unknown model via ${backend})`
                : ` (odai ${backend})`
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
      },
      { timeoutMs: 5000 },
    )
  } catch {
    debug('odai backend unavailable; mechanical hoist advisory only')
    return advised.map(duplicate => ({
      __proto__: null,
      duplicate,
      suggestion: `${duplicate.name} sits on majors ${duplicate.majors.join(', ')} — review unifying on the higher major (odai backend unavailable; start a prepared local llama-server backend)`,
    }))
  }
}

export function nodeMajorOf(root: string): number {
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
