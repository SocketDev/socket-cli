/**
 * @file Zero-dep bootstrap installer for smithers (npm `smthrs`) — an
 *   AI agent-workflow orchestrator. The npm package renamed from
 *   `smithers-orchestrator`; the BINARY is still `smithers`, so the tool key,
 *   the shim, and this file keep that name and only `repository` moved.
 *   npm-registry tarball (pure JS run via
 *   node), the same shape as npm itself: a SINGLE top-level integrity.
 *   Downloaded + SRI-verified + extracted by lib/install-tool.mjs into
 *   rack/smithers/<v>; a bin/smithers shim runs the package's bin entry
 *   (src/bin/smithers.js) through system node. Skipped, no error, when smithers
 *   is absent from external-tools.json. Imports only bootstrap-common.mjs +
 *   `node:`.
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  BIN_DIR,
  installTool,
  jq,
  log,
  RACK_DIR,
  warn,
} from './bootstrap-common.mjs'

export function installSmithers() {
  const version = jq('smithers', 'version')
  const integrity = jq('smithers', 'integrity')
  if (!version || !integrity) {
    log('· smithers not pinned in external-tools.json — skipping')
    return undefined
  }
  const binName = jq('smithers', 'binaryName') || 'smithers'
  const destDir = path.join(RACK_DIR, 'smithers', version)
  // install-tool.mjs extracts the registry tarball's `package/` dir under destDir.
  const pkgDir = path.join(destDir, 'package')
  const entry = path.join(pkgDir, 'src', 'bin', 'smithers.js')
  const shimPath = path.join(BIN_DIR, binName)
  if (!existsSync(entry)) {
    // The npm package name comes from the declaration's `repository` (`npm:<name>`),
    // never a second hardcoded copy: the project renamed from
    // `smithers-orchestrator` to `smthrs`, and a hardcoded URL here would have
    // kept fetching the retired name after the pin moved. A scoped name's
    // tarball path repeats only the basename, so split that off.
    const repository = jq('smithers', 'repository') || ''
    const pkgName = repository.startsWith('npm:')
      ? repository.slice('npm:'.length)
      : repository
    if (!pkgName) {
      warn(
        '× smithers has no npm: repository in external-tools.json — skipping',
      )
      return undefined
    }
    const tarName = pkgName.slice(pkgName.lastIndexOf('/') + 1)
    const tarUrl = `https://registry.npmjs.org/${pkgName}/-/${tarName}-${version}.tgz`
    log(`Installing smithers@${version} → ${destDir}`)
    if (!installTool(tarUrl, integrity, destDir)) {
      warn('× smithers download/verify failed — skipping shim')
      return undefined
    }
    if (!existsSync(entry)) {
      warn(`× smithers tarball missing ${entry} after extract — skipping shim`)
      return undefined
    }
    log(`✓ smithers@${version} → ${pkgDir}`)
  } else {
    log(`✓ smithers@${version} already installed at ${pkgDir}`)
  }
  // Shim: run the JS entry through system node, pure-JS package, no binary.
  mkdirSync(BIN_DIR, { recursive: true })
  writeFileSync(shimPath, `#!/bin/bash\nexec node "${entry}" "$@"\n`)
  chmodSync(shimPath, 0o755)
  log(`✓ smithers shim → ${shimPath}`)
  return entry
}
