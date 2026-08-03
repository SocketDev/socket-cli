/*
 * @file The lockstep manifest write for a multi-package workspace: every
 *   publishable manifest moves to the same version in one pass, so a release
 *   cannot leave members straddling two versions.
 *
 *   Split out of bump.mts, which was past the 1000-line hard cap.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  checkVersionLockstep,
  planLockstepManifestWrites,
} from '../publish-infra/npm/workspace-plan.mts'
import { runInherit } from '../publish-infra/shared.mts'
import { resolveNpmWorkspaceLayout } from '../publish-infra/npm/workspace.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

import type { NpmWorkspaceLayout } from '../publish-infra/npm/workspace.mts'

const logger = getDefaultLogger()

/**
 * Apply the multi-package LOCKSTEP bump: rewrite every publishable member
 * manifest (+ the versioned root) to `nextVersion` — root `version` field and
 * exact sibling pins (the loader's optionalDependencies rows) together — then
 * invoke each member's own platform-package generator so the generated
 * `npm/<platformId>/` manifests re-derive from the bumped main manifest, and
 * re-verify lockstep afterwards. Returns the written manifest rel-paths, or
 * undefined after failing loud (a non-zero generator or post-generator drift
 * never ships a half-applied bump).
 */
export async function applyLockstepBump(
  layout: NpmWorkspaceLayout,
  nextVersion: string,
): Promise<string[] | undefined> {
  const siblingNames = layout.packages.map(pkg => pkg.name)
  const inputs = layout.packages.map(pkg => ({
    name: pkg.name,
    raw: readFileSync(pkg.manifestPath, 'utf8'),
    relManifestPath: pkg.relManifestPath,
    siblingNames,
  }))
  if (layout.versionSource.relManifestPath === 'package.json') {
    // The root manifest carries the version, the stuie shape — it moves in
    // lockstep too.
    inputs.push({
      name: '',
      raw: readFileSync(path.join(layout.rootPath, 'package.json'), 'utf8'),
      relManifestPath: 'package.json',
      siblingNames,
    })
  }
  const writes = planLockstepManifestWrites(inputs, nextVersion)
  for (const write of writes) {
    writeThroughMirrorLock(
      path.join(layout.rootPath, write.relManifestPath),
      write.updated,
    )
  }
  // Generated platform dirs re-derive from the bumped main manifest via the
  // repo's OWN generator (make-npm-dirs) — the engine invokes it, never
  // reimplements it.
  const generators = [
    ...new Set(
      layout.packages
        .map(pkg => pkg.generatorPath)
        .filter(generatorPath => generatorPath !== undefined),
    ),
  ]
  for (let i = 0, { length } = generators; i < length; i += 1) {
    const generatorPath = generators[i]!
    logger.log(
      `[bump] regenerating platform packages: node ` +
        `${path.relative(layout.rootPath, generatorPath)}`,
    )
    // eslint-disable-next-line no-await-in-loop -- serial by design: generators rewrite the tree
    const code = await runInherit(
      process.execPath,
      [generatorPath],
      layout.rootPath,
    )
    if (code !== 0) {
      logger.fail(
        `[bump] the platform-package generator exited ${code}.\n` +
          `  Where: ${generatorPath}\n` +
          `  Saw vs wanted: a non-zero generator exit; wanted regenerated ` +
          `npm/<platformId>/ manifests at ${nextVersion}.\n` +
          `  Fix: run it directly and repair the generator — the bump never ` +
          `ships half-regenerated platform dirs.`,
      )
      return undefined
    }
  }
  // The generator derives platform manifests from the bumped main manifest;
  // verify it actually converged — a generator that pins its own version
  // would silently break lockstep here.
  const drift = checkVersionLockstep(resolveNpmWorkspaceLayout(layout.rootPath))
  if (drift.length > 0) {
    logger.fail(
      `[bump] version lockstep is broken AFTER the platform-package ` +
        `generator ran:\n${drift.map(line => `    ${line}`).join('\n')}\n` +
        `  Fix: make the generator derive name/version from its package's ` +
        `own manifest (never a hard-coded version), then re-run.`,
    )
    return undefined
  }
  return writes.map(write => write.relManifestPath)
}
