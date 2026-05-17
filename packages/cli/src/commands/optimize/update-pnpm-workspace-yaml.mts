/**
 * @fileoverview Update overrides in pnpm-workspace.yaml (pnpm 11+).
 *
 * pnpm 11+ reads `overrides:` from `pnpm-workspace.yaml` only —
 * `package.json`'s `pnpm.overrides` is ignored. socket-cli's optimize
 * command historically wrote to package.json; this helper provides
 * the YAML-write path used when the host repo declares pnpm@11+ in
 * its `packageManager` field.
 *
 * Comment preservation: uses the `yaml` package's Document API so
 * existing `pnpm-workspace.yaml` formatting (comments, ordering,
 * non-overrides keys) survives merges. The `overrides:` block is
 * created when missing.
 */

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { safeReadFile } from '@socketsecurity/lib/fs'
import { isMap, parseDocument } from 'yaml'
import type { Document, YAMLMap } from 'yaml'

import type { Overrides } from './types.mts'

/**
 * Merge `overrides` into `pnpm-workspace.yaml` at `<repoRoot>/pnpm-workspace.yaml`.
 *
 * - Existing `overrides:` block is updated in-place (entries with the
 *   same key are overwritten with the new value; new entries are
 *   appended).
 * - When the file lacks an `overrides:` block, one is added.
 * - When the file is missing entirely, a minimal one is created.
 * - Comments and other keys (catalog, packages, minimumReleaseAge,
 *   etc.) are preserved.
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
    doc.contents = doc.createNode({}) as ReturnType<Document['createNode']>
  }

  // Locate or create the `overrides:` map.
  let overridesNode = doc.get('overrides', true) as unknown
  if (!isMap(overridesNode)) {
    doc.set('overrides', overrides)
    overridesNode = doc.get('overrides', true)
  } else {
    const map = overridesNode as YAMLMap<unknown, unknown>
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
