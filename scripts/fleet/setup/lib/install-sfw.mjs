/**
 * @file Zero-dep bootstrap installer for Socket Firewall (sfw). Lock-step with
 *   scripts/fleet/install-sfw.mts: both read the same tools.sfw-free /
 *   tools.sfw-enterprise entries and pick the SKU off the same
 *   SOCKET_API_KEY/SOCKET_API_TOKEN env keys. Part of the from-scratch
 *   bootstrap (runs before node_modules); imports only bootstrap-common.mjs +
 *   `node:`. Returns the installed sfw binary path (or undefined → shims become
 *   helpful-error stubs).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  installTool,
  jq,
  log,
  SFW_RACK_DIR,
  warn,
} from './bootstrap-common.mjs'

export function installSfw(platform, enterprise) {
  // Flavor decided by the caller via hasSocketToken() (env OR keychain),
  // lock-step with install-sfw.mts. Enterprise's private release assets auth via
  // GITHUB_TOKEN, which install-tool forwards. Everything — repository, assets,
  // binary name — is read from the chosen tool entry, so the URL isn't
  // hardcoded twice.
  const tool = enterprise ? 'sfw-enterprise' : 'sfw-free'
  const version = jq(tool, 'version')
  const asset = jq(tool, 'platforms', platform, 'asset')
  if (!version || !asset) {
    warn(
      `× ${tool} has no asset for ${platform} — skipping sfw (shims become helpful-error stubs)`,
    )
    return undefined
  }
  const integrity = jq(tool, 'platforms', platform, 'integrity')
  let binName = jq(tool, 'binaryName') || 'sfw'
  if (asset.endsWith('.exe')) {
    binName = `${binName}.exe`
  }
  // repository is `github:<owner>/<repo>` — derive the release-asset URL.
  const repo = String(jq(tool, 'repository') || '').replace(/^github:/, '')
  const sfwVerDir = path.join(SFW_RACK_DIR, version)
  const sfwBin = path.join(sfwVerDir, binName)
  if (existsSync(sfwBin)) {
    log(`✓ sfw already installed at ${sfwBin}`)
    return sfwBin
  }
  log(`Installing ${tool}@${version} (${asset}) → ${sfwVerDir}`)
  if (
    !installTool(
      `https://github.com/${repo}/releases/download/v${version}/${asset}`,
      integrity,
      sfwVerDir,
      binName,
    )
  ) {
    warn('× sfw install failed — shims become helpful-error stubs')
    return undefined
  }
  log(`✓ ${tool}@${version} → ${sfwBin}`)
  return sfwBin
}
