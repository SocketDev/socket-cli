/**
 * @file Zero-dep bootstrap installer for pnpm — version + per-platform
 *   asset/integrity from external-tools.json, downloaded + SRI-verified +
 *   extracted by lib/install-tool.mjs. NO corepack. A darwin-x64 npm-registry
 *   JS tarball gets a node-wrapper shim (upstream dropped its SEA binary). Part
 *   of the from-scratch bootstrap (runs before node_modules); imports only the
 *   sibling bootstrap-common.mjs + `node:`.
 */

import { chmodSync, existsSync, writeFileSync } from 'node:fs'
// oxlint-disable-next-line socket/prefer-async-spawn -- pre-pnpm bootstrap (no lib spawn wrapper on disk yet).
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { installTool, jq, log, PNPM_DIR, warn } from './bootstrap-common.mjs'

export function installPnpm(platform) {
  const version = jq('pnpm', 'version')
  if (!version) {
    warn('× pnpm version missing from external-tools.json')
    process.exit(1)
  }
  const asset = jq('pnpm', 'platforms', platform, 'asset')
  const integrity = jq('pnpm', 'platforms', platform, 'integrity')
  if (!asset || !integrity) {
    warn(`× pnpm has no asset/integrity for ${platform} at v${version}`)
    process.exit(1)
  }
  const source = jq('pnpm', 'platforms', platform, 'source')
  const binaryRel = jq('pnpm', 'platforms', platform, 'binary')
  const isZip = asset.endsWith('.zip')
  const pnpmBin = path.join(PNPM_DIR, isZip ? 'pnpm.exe' : 'pnpm')

  // Idempotent: pinned version already the active one here?
  if (existsSync(pnpmBin)) {
    const v = spawnSync(pnpmBin, ['--version'], { encoding: 'utf8' })
    if (
      v.status === 0 &&
      typeof v.stdout === 'string' &&
      v.stdout.trim() === version
    ) {
      log(`✓ pnpm@${version} already installed at ${pnpmBin}`)
      return pnpmBin
    }
  }

  const url =
    source === 'npm-registry'
      ? `https://registry.npmjs.org/pnpm/-/${asset}`
      : `https://github.com/pnpm/pnpm/releases/download/v${version}/${asset}`
  log(`Installing pnpm@${version} (${asset}) → ${PNPM_DIR}`)
  if (!installTool(url, integrity, PNPM_DIR)) {
    warn('× pnpm install failed')
    process.exit(1)
  }
  // npm-registry source = a JS tarball, not a native binary: write a wrapper
  // that runs it through the system Node (matches the CI action exactly).
  if (source === 'npm-registry') {
    const binaryPath = path.join(PNPM_DIR, binaryRel || '')
    if (!binaryRel || !existsSync(binaryPath)) {
      warn(`× pnpm npm-registry tarball missing ${binaryRel} after extract`)
      process.exit(1)
    }
    writeFileSync(pnpmBin, `#!/bin/bash\nexec node "${binaryPath}" "$@"\n`)
    chmodSync(pnpmBin, 0o755)
  }
  log(`✓ pnpm@${version} → ${pnpmBin}`)
  return pnpmBin
}
