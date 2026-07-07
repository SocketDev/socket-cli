/**
 * @file Zero-dep bootstrap installer for npm — pinned, SRI-verified, no
 *   self-update. node ships a bundled npm; this overrides it to the pinned
 *   version. Lock-step with scripts/fleet/install-npm.mts (the post-deps,
 *   lib-based path): both read the SAME tools.npm pin + integrity and both
 *   drive the DOWNLOADED `node bin/npm-cli.js install -gf` rather than `npm
 *   install -g npm`, so the resident npm never updates itself. npm is
 *   platform-agnostic — ONE registry tarball — so a single top-level integrity.
 *   Part of the from-scratch bootstrap; imports only bootstrap-common.mjs +
 *   `node:`.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- pre-pnpm bootstrap (no lib spawn wrapper on disk yet).
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { installTool, jq, log, RACK_DIR, warn } from './bootstrap-common.mjs'

export function installNpm() {
  const version = jq('npm', 'version')
  const integrity = jq('npm', 'integrity')
  if (!version || !integrity) {
    log('· npm not pinned in external-tools.json — keeping node-bundled npm')
    return
  }
  const destDir = path.join(RACK_DIR, 'npm', version)
  // install-tool.mjs extracts the npm tarball's `package/` dir under destDir.
  const pkgDir = path.join(destDir, 'package')
  const npmCli = path.join(pkgDir, 'bin', 'npm-cli.js')
  const tarUrl = `https://registry.npmjs.org/npm/-/npm-${version}.tgz`
  log(`Installing npm@${version} → ${destDir}`)
  if (!installTool(tarUrl, integrity, destDir)) {
    warn('× npm download/verify failed — keeping node-bundled npm')
    return
  }
  if (!existsSync(npmCli)) {
    warn(`× extracted npm tarball missing ${npmCli} — keeping node-bundled npm`)
    return
  }
  // Drive the DOWNLOADED npm-cli.js to install itself globally over the bundled
  // npm. Never `npm install -g npm`: the resident npm never updates itself.
  const r = spawnSync(process.execPath, [npmCli, 'install', '-gf', pkgDir], {
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    warn(`× npm self-install via npm-cli.js failed (exit ${r.status})`)
    return
  }
  log(`✓ npm@${version} installed (no self-update path)`)
}
