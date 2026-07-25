/**
 * @file Pack-time manifest scrub — strip repo-only lifecycle scripts from the
 *   manifest that packs. The fleet manifest declares consumer-visible
 *   lifecycle scripts (`preinstall` → scripts/fleet/setup/…) whose targets
 *   are repo scaffolding the `files` field never ships, so the published
 *   tarball's manifest points at files it does not carry and every consumer
 *   install breaks (the sdk 4.0.3 incident). Same shape as the README pin in
 *   ../pin-readme.mts: rewrite the on-disk manifest around the pack, ALWAYS
 *   restore the original bytes (try/finally), and wrap EVERY pack of one
 *   release (stage, direct, approve-time verify re-pack, release-asset pack)
 *   so the integrity gates keep comparing identical bytes. npm-only: cargo
 *   manifests have no lifecycle scripts.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { findDanglingLifecycleScripts } from '../../_shared/lifecycle-scripts.mts'
import { isCoveredByFiles } from '../../_shared/pack-files.mts'
import { logger } from '../shared.mts'

import type { DanglingLifecycleScript } from '../../_shared/lifecycle-scripts.mts'

interface ManifestShape {
  files?: string[] | undefined
  scripts?: Record<string, string> | undefined
}

/**
 * The lifecycle scripts of the manifest at `subjectDir` whose `node <path>`
 * targets will not be in the pack file set — the target file is missing on
 * disk (a dangling ref) or not covered by the `files` field (repo-only
 * scaffolding npm never packs). Exported for tests.
 */
export function danglingLifecycleScriptsFor(
  manifest: ManifestShape,
  subjectDir: string,
): DanglingLifecycleScript[] {
  return findDanglingLifecycleScripts(
    manifest.scripts,
    rel =>
      existsSync(path.join(subjectDir, rel)) &&
      isCoveredByFiles(rel, manifest.files),
  )
}

/**
 * Run `fn` with the publish subject's package.json temporarily rewritten to
 * drop every lifecycle script whose target is not in the pack file set, so
 * the tarball's manifest never references files the tarball does not carry.
 * Each strip is logged loud. The original manifest bytes are ALWAYS restored
 * (try/finally); a manifest with nothing to strip runs `fn` untouched.
 * Returns `fn`'s result.
 */
export async function withPrunedPackManifest<T>(
  subjectDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const manifestPath = path.join(subjectDir, 'package.json')
  let original: string
  try {
    original = readFileSync(manifestPath, 'utf8')
  } catch {
    // No readable manifest — the pack itself will fail loud; nothing to prune.
    return await fn()
  }
  const manifest = JSON.parse(original) as ManifestShape
  const dangling = danglingLifecycleScriptsFor(manifest, subjectDir)
  if (!dangling.length || !manifest.scripts) {
    return await fn()
  }
  for (const d of dangling) {
    delete manifest.scripts[d.name]
    logger.warn(
      `[pack-manifest] stripping repo-only lifecycle script "${d.name}" ` +
        `(${d.command}) — not in the pack file set: ${d.missing.join(', ')}`,
    )
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  try {
    return await fn()
  } finally {
    writeFileSync(manifestPath, original)
  }
}
