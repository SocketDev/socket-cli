/**
 * @file Update overrides in pnpm-workspace.yaml (pnpm 11+). pnpm 11+ reads
 *   `overrides:` from `pnpm-workspace.yaml` only — `package.json`'s
 *   `pnpm.overrides` is ignored. socket-cli's optimize command historically
 *   wrote to package.json; this helper provides the YAML-write path used when
 *   the host repo declares pnpm@11+ in its `packageManager` field. Comment
 *   preservation: uses the `yaml` package's Document API so existing
 *   `pnpm-workspace.yaml` formatting, comments, ordering, non-overrides keys
 *   survives merges. The `overrides:` block is created when missing.
 */

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { safeReadFile } from '@socketsecurity/lib-stable/fs/read-file'
import { isMap, parseDocument } from 'yaml'
import type { Document } from 'yaml'

import type { Overrides } from './types.mts'

/**
 * The fleet soak policy: no dependency younger than 7 days installs. pnpm
 * reads `minimumReleaseAge` (minutes) from pnpm-workspace.yaml and refuses
 * resolutions published more recently — the freshpub-typosquat gate.
 */
export const SOAK_MIN_RELEASE_AGE_MINUTES = 10_080

export type MinReleaseAgeOutcome = 'added' | 'present' | 'raised'

/**
 * Enforce the soak policy in `<repoRoot>/pnpm-workspace.yaml`: add
 * `minimumReleaseAge` when absent, raise it when it sits below the fleet
 * floor, leave it when it already meets the floor. Comments and other keys
 * are preserved (same Document API as the overrides merge).
 */
export async function ensurePnpmWorkspaceMinReleaseAge(
  repoRoot: string,
): Promise<MinReleaseAgeOutcome> {
  const yamlPath = path.join(repoRoot, 'pnpm-workspace.yaml')
  const existing = existsSync(yamlPath)
    ? await safeReadFile(yamlPath, { encoding: 'utf8' })
    : undefined

  if (!existing) {
    // Fresh file: write the minimal document directly so the key lands in
    // the same plain style as a hand-written pnpm-workspace.yaml.
    writeFileSync(
      yamlPath,
      `minimumReleaseAge: ${SOAK_MIN_RELEASE_AGE_MINUTES}\n`,
      'utf8',
    )
    return 'added'
  }

  const doc: Document = parseDocument(existing, { keepSourceTokens: true })

  const current = doc.get('minimumReleaseAge')
  const currentMinutes = typeof current === 'number' ? current : undefined
  if (
    currentMinutes !== undefined &&
    currentMinutes >= SOAK_MIN_RELEASE_AGE_MINUTES
  ) {
    return 'present'
  }
  doc.set('minimumReleaseAge', SOAK_MIN_RELEASE_AGE_MINUTES)
  writeFileSync(yamlPath, doc.toString(), 'utf8')
  return currentMinutes === undefined ? 'added' : 'raised'
}

/**
 * Merge `overrides` into `pnpm-workspace.yaml` at
 * `<repoRoot>/pnpm-workspace.yaml`.
 *
 * - Existing `overrides:` block is updated in-place (entries with the same key
 *   are overwritten with the new value; new entries are appended).
 * - When the file lacks an `overrides:` block, one is added.
 * - When the file is missing entirely, a minimal one is created.
 * - Comments and other keys (catalog, packages, minimumReleaseAge, etc.) are
 *   preserved.
 */
export async function updatePnpmWorkspaceYamlOverrides(
  repoRoot: string,
  overrides: Overrides,
): Promise<void> {
  const yamlPath = path.join(repoRoot, 'pnpm-workspace.yaml')
  const existing = existsSync(yamlPath)
    ? await safeReadFile(yamlPath, { encoding: 'utf8' })
    : undefined

  let doc: Document
  if (existing) {
    doc = parseDocument(existing, { keepSourceTokens: true })
  } else {
    // Minimal new file. The Document is empty until we add `overrides:`.
    doc = parseDocument('', { keepSourceTokens: true })
    doc.contents = doc.createNode({})
  }

  // Locate or create the `overrides:` map.
  let overridesNode = doc.get('overrides', true)
  if (!isMap(overridesNode)) {
    doc.set('overrides', overrides)
    overridesNode = doc.get('overrides', true)
  } else {
    const map = overridesNode
    for (const [key, value] of Object.entries(overrides)) {
      map.set(key, value)
    }
  }

  const output = doc.toString({
    // Preserve typical pnpm-workspace.yaml conventions: 2-space indent,
    // double-quoted strings only when necessary.
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0,
  })

  writeFileSync(yamlPath, output, 'utf8')
}
