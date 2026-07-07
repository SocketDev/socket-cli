/**
 * @file Zero-dep bootstrap installer for fff (fff-mcp) — a fast file-search MCP
 *   server (Rust). Per-platform raw binary (the asset IS the executable,
 *   codedb-shape): version + per-platform asset/integrity from
 *   external-tools.json, GitHub release-download, SRI-verified + racked by
 *   lib/install-tool.mjs, with a bin/fff-mcp shim. Skipped (no error) when fff
 *   isn't pinned for this platform. Imports only bootstrap-common.mjs +
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

export function installFff(platform) {
  const version = jq('fff', 'version')
  const asset = jq('fff', 'platforms', platform, 'asset')
  if (!version || !asset) {
    log('· fff not pinned for this platform — skipping')
    return undefined
  }
  const integrity = jq('fff', 'platforms', platform, 'integrity')
  const binName = jq('fff', 'binaryName') || 'fff-mcp'
  const repo = String(jq('fff', 'repository') || '').replace(/^github:/, '')
  const destDir = path.join(RACK_DIR, 'fff', version)
  const fffBin = path.join(destDir, binName)
  const shimPath = path.join(BIN_DIR, binName)
  if (existsSync(fffBin)) {
    log(`✓ fff@${version} already installed at ${fffBin}`)
  } else {
    log(`Installing fff@${version} (${asset}) → ${destDir}`)
    if (
      !installTool(
        `https://github.com/${repo}/releases/download/v${version}/${asset}`,
        integrity,
        destDir,
        binName,
      )
    ) {
      warn('× fff install failed — skipping shim')
      return undefined
    }
    log(`✓ fff@${version} → ${fffBin}`)
  }
  mkdirSync(BIN_DIR, { recursive: true })
  writeFileSync(shimPath, `#!/bin/bash\nexec "${fffBin}" "$@"\n`)
  chmodSync(shimPath, 0o755)
  log(`✓ fff shim → ${shimPath}`)
  return fffBin
}
