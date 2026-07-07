/**
 * @file Zero-dep bootstrap installer for uv (Astral) — the fleet's Python
 *   project tool. Installed in the bootstrap (release-asset, SRI-verified per
 *   platform) so a hash-locked uv install is available BEFORE the
 *   security-tools step that needs it (SkillSpector installs via a uv project +
 *   uv.lock). uv release tags have NO `v` prefix (e.g. `0.11.21`), unlike
 *   sfw/codedb/janus — so the download URL uses the bare version. Skipped (no
 *   error) when uv isn't pinned for this platform. Imports only
 *   bootstrap-common.mjs + `node:`.
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

export function installUv(platform) {
  const version = jq('uv', 'version')
  const asset = jq('uv', 'platforms', platform, 'asset')
  if (!version || !asset) {
    log('· uv not pinned for this platform — skipping')
    return undefined
  }
  const integrity = jq('uv', 'platforms', platform, 'integrity')
  const binName = jq('uv', 'binaryName') || 'uv'
  const repo = String(jq('uv', 'repository') || '').replace(/^github:/, '')
  const isZip = asset.endsWith('.zip')
  const exe = isZip ? `${binName}.exe` : binName
  const destDir = path.join(RACK_DIR, 'uv', version)
  // The uv release archives wrap the binary in a top-level dir named for the
  // asset stem (e.g. `uv-aarch64-apple-darwin/uv`); install-tool.mjs extracts
  // with no --strip-components, so the binary lands under that subdir, not at
  // destDir root (unlike a bare-binary asset like codedb).
  const assetStem = asset.replace(/\.(?:tar\.gz|tgz|zip)$/, '')
  const uvBin = path.join(destDir, assetStem, exe)
  const shimPath = path.join(BIN_DIR, exe)
  if (existsSync(uvBin)) {
    log(`✓ uv@${version} already installed at ${uvBin}`)
  } else {
    // uv release tags have NO `v` prefix — use the bare version in the URL.
    log(`Installing uv@${version} (${asset}) → ${destDir}`)
    if (
      !installTool(
        `https://github.com/${repo}/releases/download/${version}/${asset}`,
        integrity,
        destDir,
        exe,
      )
    ) {
      warn('× uv install failed — skipping shim')
      return undefined
    }
    log(`✓ uv@${version} → ${uvBin}`)
  }
  mkdirSync(BIN_DIR, { recursive: true })
  writeFileSync(shimPath, `#!/bin/bash\nexec "${uvBin}" "$@"\n`)
  chmodSync(shimPath, 0o755)
  log(`✓ uv shim → ${shimPath}`)
  return uvBin
}
