/**
 * @file Build-signature cache helpers (content hash + sidecar file) shared
 *   by scripts/build.mts. Split out of scripts/build.mts to keep each module
 *   under the fleet file-size cap.
 */

import crypto from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import fg from 'fast-glob'

import { rootDir } from './context.mts'
import type { BuildPackageConfig } from './config.mts'

/**
 * Compute a SHA-256 signature over the contents of files matched by the
 * package's input globs. Files are sorted to keep the hash deterministic.
 */
export function computeBuildSignature(pkg: BuildPackageConfig): string {
  const files = fg.sync(pkg.inputs, {
    cwd: rootDir,
    onlyFiles: true,
    dot: true,
    absolute: true,
  })
  files.sort()

  const hash = crypto.createHash('sha256')
  for (const file of files) {
    const relative = path.relative(rootDir, file)
    hash.update(relative)
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Check if a package needs to be built. Returns true if build is needed, false
 * if can skip.
 *
 * Rebuild triggers: 1. --force 2. Missing build output 3. Missing signature
 * sidecar 4. Current input signature differs from the recorded one.
 */
export function needsBuild(
  pkg: BuildPackageConfig,
  config: { force: boolean },
): boolean {
  const { force } = { __proto__: null, ...config } as typeof config
  if (force) {
    return true
  }

  const outputPath = path.join(rootDir, pkg.outputCheck)
  if (!existsSync(outputPath)) {
    return true
  }

  const stored = readSignature(pkg)
  if (!stored) {
    return true
  }

  return computeBuildSignature(pkg) !== stored
}

export function readSignature(pkg: BuildPackageConfig): string | undefined {
  const file = signaturePath(pkg)
  if (!existsSync(file)) {
    return undefined
  }
  return readFileSync(file, 'utf8').trim()
}

/**
 * Path to the sidecar signature file written alongside the build output.
 */
export function signaturePath(pkg: BuildPackageConfig): string {
  return path.join(rootDir, `${pkg.outputCheck}.build-signature`)
}

export function writeSignature(
  pkg: BuildPackageConfig,
  signature: string,
): void {
  writeFileSync(signaturePath(pkg), `${signature}\n`, 'utf8')
}
