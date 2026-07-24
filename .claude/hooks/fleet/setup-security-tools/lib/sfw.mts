// Socket Firewall (SFW) installer — downloads the enterprise or free binary,
// verifies SHA-256, and writes PATH shims for every detected package manager.
// Lives in its own file because installers.mts is at the 500-line soft cap;
// the shim-writing phase is the largest single chunk of that file.

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { getSocketHomePath } from '@socketsecurity/lib-stable/paths/socket'

import { releaseTag, resolvePlatformEntry } from './installers.mts'
import { SFW_ENTERPRISE, SFW_FREE } from './tool-config.mts'

const logger = getDefaultLogger()

export async function runSetupSfw(
  apiToken: string | undefined,
): Promise<boolean> {
  const isEnterprise = !!apiToken
  const sfwConfig = isEnterprise ? SFW_ENTERPRISE : SFW_FREE
  logger.log(
    `=== Socket Firewall (${isEnterprise ? 'enterprise' : 'free'}) ===`,
  )

  // Platform.
  const { entry: platformEntry, platformKey } = resolvePlatformEntry(
    sfwConfig.platforms,
  )
  if (!platformEntry) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }

  // Integrity + asset.
  const { asset, integrity } = platformEntry
  const repo = sfwConfig.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/${releaseTag(sfwConfig.version)}/${asset}`
  const binaryName = isEnterprise ? 'sfw' : 'sfw-free'

  // Download (with cache + integrity check).
  const { binaryPath, downloaded } = await downloadBinary({
    url,
    name: binaryName,
    integrity,
  })
  logger.log(
    downloaded ? `Downloaded to ${binaryPath}` : `Cached at ${binaryPath}`,
  )

  // Create shims.
  const isWindows = process.platform === 'win32'

  const shimDir = path.join(getSocketHomePath(), 'sfw', 'shims')
  await fs.mkdir(shimDir, { recursive: true })
  const ecosystems = [...(sfwConfig.ecosystems ?? [])]
  if (isEnterprise && process.platform === 'linux') {
    ecosystems.push('go')
  }
  const cleanPath = (process.env['PATH'] ?? '')
    .split(path.delimiter)
    .filter(p => p !== shimDir)
    .join(path.delimiter)
  const sfwBin = normalizePath(binaryPath)
  const created: string[] = []
  for (let i = 0, { length } = ecosystems; i < length; i += 1) {
    const cmd = ecosystems[i]!
    let realBin = whichSync(cmd, { nothrow: true, path: cleanPath })
    if (!realBin || typeof realBin !== 'string') {
      continue
    }
    realBin = normalizePath(realBin)

    // Bash shim (macOS/Linux/Windows Git Bash).
    const bashLines = [
      '#!/bin/bash',
      `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -vxF '${shimDir}' | paste -sd: -)"`,
    ]
    if (isEnterprise) {
      // Read API token from env at runtime — never embed secrets in
      // scripts. Either SOCKET_API_KEY or SOCKET_API_TOKEN is accepted;
      // whichever is set gets exported under both so downstream tools
      // see the value regardless of which name they read.
      //
      // Dotfile fallback (`.env` / `.env.local`) is intentionally NOT
      // checked here per CLAUDE.md token-hygiene: tokens belong in env
      // (CI) or the OS keychain (dev local), never in dotfiles. The
      // shell-rc bridge installed by setup-security-tools writes the
      // export line into ~/.zshenv so every new shell already has the
      // env var set.
      bashLines.push(
        'if [ -z "$SOCKET_API_KEY" ] && [ -n "$SOCKET_API_TOKEN" ]; then',
        '  SOCKET_API_KEY="$SOCKET_API_TOKEN"',
        'fi',
        'if [ -n "$SOCKET_API_KEY" ]; then',
        '  export SOCKET_API_KEY',
        '  SOCKET_API_TOKEN="$SOCKET_API_KEY"',
        '  export SOCKET_API_TOKEN',
        'fi',
      )
    }
    bashLines.push(`exec "${sfwBin}" "${realBin}" "$@"`)
    const bashContent = bashLines.join('\n') + '\n'
    const bashPath = path.join(shimDir, cmd)
    if (
      !existsSync(bashPath) ||
      (await fs.readFile(bashPath, 'utf8').catch(() => '')) !== bashContent
    ) {
      await fs.writeFile(bashPath, bashContent, { mode: 0o755 })
    }
    created.push(cmd)

    // Windows .cmd shim (strips shim dir from PATH, then execs through sfw).
    if (isWindows) {
      let cmdApiTokenBlock = ''
      if (isEnterprise) {
        // Mirror the bash-shim env-only resolution. Dotfile fallback
        // (`.env` / `.env.local`) is intentionally not read here — see
        // the bash-shim comment for the token-hygiene rationale. The
        // Windows CredentialManager shell-rc bridge installed by
        // setup-security-tools writes the env var for every new
        // session.
        cmdApiTokenBlock =
          `if not defined SOCKET_API_KEY (\r\n` +
          `  if defined SOCKET_API_TOKEN set "SOCKET_API_KEY=%SOCKET_API_TOKEN%"\r\n` +
          `)\r\n` +
          `if defined SOCKET_API_KEY set "SOCKET_API_TOKEN=%SOCKET_API_KEY%"\r\n`
      }
      const cmdContent =
        `@echo off\r\n` +
        `set "PATH=;%PATH%;"\r\n` +
        `set "PATH=%PATH:;${shimDir};=%"\r\n` +
        `set "PATH=%PATH:~1,-1%"\r\n` +
        cmdApiTokenBlock +
        `"${sfwBin}" "${realBin}" %*\r\n`
      const cmdPath = path.join(shimDir, `${cmd}.cmd`)
      if (
        !existsSync(cmdPath) ||
        (await fs.readFile(cmdPath, 'utf8').catch(() => '')) !== cmdContent
      ) {
        await fs.writeFile(cmdPath, cmdContent)
      }
    }
  }

  if (created.length) {
    logger.log(`Shims: ${created.join(', ')}`)
    logger.log(`Shim dir: ${shimDir}`)
    logger.log(`Activate: export PATH="${shimDir}:$PATH"`)
  } else {
    logger.warn('No supported package managers found on PATH.')
  }
  return !!created.length
}
