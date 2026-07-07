/**
 * @file Zero-dep bootstrap installer for janus (divmain/janus) — a
 *   single-binary utility some Socket workflows opt into (not a security tool).
 *   GitHub release tarball; version + per-platform asset/integrity from
 *   external-tools.json, SRI-verified + extracted by lib/install-tool.mjs into
 *   rack/janus/<v>, with a bin/janus shim. Skipped (no error) when janus isn't
 *   pinned for this platform. Imports only bootstrap-common.mjs + `node:`.
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

export function installJanus(platform) {
  const version = jq('janus', 'version')
  const asset = jq('janus', 'platforms', platform, 'asset')
  if (!version || !asset) {
    log('· janus not pinned for this platform — skipping')
    return undefined
  }
  const integrity = jq('janus', 'platforms', platform, 'integrity')
  const binName = jq('janus', 'binaryName') || 'janus'
  const repo = String(jq('janus', 'repository') || '').replace(/^github:/, '')
  const destDir = path.join(RACK_DIR, 'janus', version)
  const janusBin = path.join(destDir, binName)
  const shimPath = path.join(BIN_DIR, binName)
  if (existsSync(janusBin)) {
    log(`✓ janus@${version} already installed at ${janusBin}`)
  } else {
    log(`Installing janus@${version} (${asset}) → ${destDir}`)
    if (
      !installTool(
        `https://github.com/${repo}/releases/download/v${version}/${asset}`,
        integrity,
        destDir,
        binName,
      )
    ) {
      warn('× janus install failed — skipping shim')
      return undefined
    }
    log(`✓ janus@${version} → ${janusBin}`)
  }
  mkdirSync(BIN_DIR, { recursive: true })
  writeFileSync(shimPath, `#!/bin/bash\nexec "${janusBin}" "$@"\n`)
  chmodSync(shimPath, 0o755)
  log(`✓ janus shim → ${shimPath}`)
  return janusBin
}
