/**
 * @file Pack preflight — the tarball-level hollow gate every npm publish
 *   stands behind. Packs the publish subject with `pnpm pack` and requires
 *   every declared payload file (the literal `files` entries plus `main`,
 *   via requiredPayloadFiles) present INSIDE the packed tarball before any
 *   stage/publish command runs. The disk-level hollow gate
 *   (findHollowPackages) covers platform packages' working trees only; this
 *   gate reads the packed bytes themselves, for every package, so a manifest
 *   that declares payload its build never produced can never stage or
 *   publish a hollow tarball. Callers invoke it INSIDE the same README-pin +
 *   manifest-prune brackets as the real publish, so the inspected bytes
 *   match the upload.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { logger, runCapture } from '../shared.mts'
import { requiredPayloadFiles } from './workspace-plan.mts'
import { tarExecutable } from '../../_shared/tar-executable.mts'

import type { WorkspaceManifestShape } from './workspace.mts'

export interface PackPreflightConfig {
  /**
   * The directory `pnpm pack` runs in — the publish subject's own directory
   * (pnpm packs the cwd package and writes the tarball there).
   */
  dir: string
  manifest: WorkspaceManifestShape
  name: string
  version: string
}

/**
 * Pack the package at `config.dir` and require every declared payload file
 * (requiredPayloadFiles over `config.manifest`) inside the tarball. A `files`
 * entry naming a directory is satisfied by any contained file path (npm
 * tarballs carry file entries only, every one rooted at `package/`). The
 * preflight tarball exists only to be inspected — it is always deleted, pass
 * or fail. Returns true when every required entry is present; fails LOUD
 * (What / Where / Saw-vs-wanted / Fix) and returns false otherwise, so the
 * caller can refuse to run the publish command.
 */
export async function verifyPackedPayload(
  config: PackPreflightConfig,
): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as PackPreflightConfig
  const { dir, manifest, name, version } = cfg
  const required = requiredPayloadFiles(manifest)
  if (required.length === 0) {
    // The manifest declares no concrete payload (an .npmignore-shaped
    // package) — there is nothing the tarball can be missing; skip the pack.
    return true
  }
  const tarballName = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
  const tarballPath = path.join(dir, tarballName)
  // Ignoring scripts keeps the preflight pack byte-identical to the guarded
  // publish commands (which all pass --ignore-scripts): a prepack/postpack
  // lifecycle script must neither shape THIS tarball differently nor mutate
  // the tree the real pack reads afterwards. `pnpm pack` rejects the bare
  // --ignore-scripts flag; the --config form is its accepted spelling.
  const packed = await runCapture(
    'pnpm',
    ['pack', '--config.ignore-scripts=true'],
    dir,
  )
  try {
    const tarballExists = existsSync(tarballPath)
    if (packed.code !== 0 || !tarballExists) {
      logger.fail(
        `Pack preflight FAILED for ${name}@${version}.\n` +
          `  Where: pnpm pack in ${dir}\n` +
          `  Saw vs wanted: exit ${packed.code}, tarball ` +
          `${tarballExists ? 'present' : 'absent'}; wanted exit 0 + ` +
          `${tarballName} to inspect before any upload.\n` +
          `  Fix: make \`pnpm pack\` succeed in that directory, then re-run.`,
      )
      return false
    }
    const listing = await runCapture(
      tarExecutable(),
      ['-tzf', tarballPath],
      dir,
    )
    if (listing.code !== 0) {
      logger.fail(
        `Pack preflight FAILED for ${name}@${version}.\n` +
          `  Where: listing ${tarballPath} (tar -tzf exited ${listing.code})\n` +
          `  Saw vs wanted: an unreadable tarball; wanted its entry list to ` +
          `check the declared payload.\n` +
          `  Fix: make \`pnpm pack\` produce a readable tarball, then re-run.`,
      )
      return false
    }
    // npm roots every tarball entry at `package/`. Normalize separators (a
    // Windows tar can list `\`-joined paths) before any '/'-sensitive match.
    const entries = listing.stdout
      .split('\n')
      .map(line => normalizePath(line.trim()))
      .filter(entry => entry.length > 0)
    const missing = required.filter(rel => {
      // npm accepts leading-slash files entries ("/dist") and packs them as
      // repo-relative; strip the slashes or `wanted` becomes `package//dist`
      // and a valid tarball reads as hollow.
      const wanted = `package/${normalizePath(rel).replace(/^\/+/, '')}`
      return !entries.some(
        entry => entry === wanted || entry.startsWith(`${wanted}/`),
      )
    })
    if (missing.length > 0) {
      logger.fail(
        `Pack preflight FAILED for ${name}@${version}: the packed tarball ` +
          `is HOLLOW.\n` +
          `  Where: ${tarballPath}\n` +
          `  Saw vs wanted: missing ${missing.join(', ')}; wanted every ` +
          `literal files/main entry inside the tarball.\n` +
          `  Fix: the build must produce the declared payload before ` +
          `publishing — run it, confirm the files exist, then re-run. ` +
          `Nothing was uploaded.`,
      )
      return false
    }
    logger.log(
      `Pack preflight passed for ${name}@${version}: ${required.length} ` +
        `declared payload entr${required.length === 1 ? 'y' : 'ies'} present ` +
        `in ${tarballName}.`,
    )
    return true
  } finally {
    await safeDelete(tarballPath)
  }
}
