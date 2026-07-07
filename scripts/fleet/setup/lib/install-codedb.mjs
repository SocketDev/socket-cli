/**
 * @file Zero-dep bootstrap installer for codedb (Zig code-intelligence MCP
 *   server). Raw-binary asset (the asset IS the executable). Racked at
 *   rack/codedb/<version>/codedb; a bin/codedb shim sets CODEDB_NO_TELEMETRY=1
 *   on every invocation (the documented opt-out — telemetry is NEVER on).
 *   Skipped (no error) when codedb is absent from external-tools.json. Part of
 *   the from-scratch bootstrap; imports only bootstrap-common.mjs + `node:`.
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

export function installCodedb(platform) {
  const version = jq('codedb', 'version')
  const asset = jq('codedb', 'platforms', platform, 'asset')
  if (!version || !asset) {
    log('· codedb not pinned for this platform — skipping')
    return undefined
  }
  const integrity = jq('codedb', 'platforms', platform, 'integrity')
  const destDir = path.join(RACK_DIR, 'codedb', version)
  const codedbBin = path.join(destDir, 'codedb')
  const shimPath = path.join(BIN_DIR, 'codedb')
  if (existsSync(codedbBin)) {
    log(`✓ codedb@${version} already installed at ${codedbBin}`)
  } else {
    log(`Installing codedb@${version} (${asset}) → ${destDir}`)
    if (
      !installTool(
        `https://github.com/justrach/codedb/releases/download/v${version}/${asset}`,
        integrity,
        destDir,
        'codedb',
      )
    ) {
      warn('× codedb install failed — skipping shim')
      return undefined
    }
    log(`✓ codedb@${version} → ${codedbBin}`)
  }
  // Telemetry-off shim: CODEDB_NO_TELEMETRY=1 is non-negotiable.
  mkdirSync(BIN_DIR, { recursive: true })
  writeFileSync(
    shimPath,
    `#!/bin/bash\nexport CODEDB_NO_TELEMETRY=1\nexec "${codedbBin}" "$@"\n`,
  )
  chmodSync(shimPath, 0o755)
  log(`✓ codedb shim → ${shimPath} (CODEDB_NO_TELEMETRY=1)`)
  return codedbBin
}
