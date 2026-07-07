/**
 * @file Zero-dep bootstrap installer for smithers (smithers-orchestrator) — an
 *   AI agent-workflow orchestrator. npm-registry tarball (pure JS run via
 *   node), the same shape as npm itself: a SINGLE top-level integrity.
 *   Downloaded + SRI-verified + extracted by lib/install-tool.mjs into
 *   rack/smithers/<v>; a bin/smithers shim runs the package's bin entry
 *   (src/bin/smithers.js) through system node. Skipped (no error) when smithers
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
    const tarUrl = `https://registry.npmjs.org/smithers-orchestrator/-/smithers-orchestrator-${version}.tgz`
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
  // Shim: run the JS entry through system node (pure-JS package, no binary).
  mkdirSync(BIN_DIR, { recursive: true })
  writeFileSync(shimPath, `#!/bin/bash\nexec node "${entry}" "$@"\n`)
  chmodSync(shimPath, 0o755)
  log(`✓ smithers shim → ${shimPath}`)
  return entry
}
