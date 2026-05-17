#!/usr/bin/env node
// Setup script for Socket security tools.
//
// Configures three tools:
// 1. AgentShield — scans Claude AI config for prompt injection / secrets.
//    Downloaded as npm package via dlx (pinned version, cached).
// 2. Zizmor — static analysis for GitHub Actions workflows. Downloads the
//    correct binary, verifies SHA-256, cached via the dlx system.
// 3. SFW (Socket Firewall) — intercepts package manager commands to scan
//    for malware. Downloads binary, verifies SHA-256, creates PATH shims.
//    Enterprise vs free determined by SOCKET_API_TOKEN (canonical) or
//    SOCKET_API_KEY (deprecated alias) in env / .env / .env.local.

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { PackageURL } from '@socketregistry/packageurl-js-stable'
import { Type } from '@sinclair/typebox'

import { whichSync } from '@socketsecurity/lib-stable/bin'
import { downloadBinary } from '@socketsecurity/lib-stable/dlx/binary'
import { downloadPackage } from '@socketsecurity/lib-stable/dlx/package'
import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { safeDelete } from '@socketsecurity/lib-stable/fs'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { getSocketHomePath } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/spawn'
import { parseSchema } from '@socketsecurity/lib-stable/schema/parse'

const logger = getDefaultLogger()

// ── Tool config loaded from external-tools.json (self-contained) ──

const checksumEntrySchema = Type.Object({
  asset: Type.String(),
  sha256: Type.String(),
})

const toolSchema = Type.Object({
  description: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  purl: Type.Optional(Type.String()),
  integrity: Type.Optional(Type.String()),
  repository: Type.Optional(Type.String()),
  release: Type.Optional(Type.String()),
  checksums: Type.Optional(Type.Record(Type.String(), checksumEntrySchema)),
  ecosystems: Type.Optional(Type.Array(Type.String())),
})

const configSchema = Type.Object({
  description: Type.Optional(Type.String()),
  tools: Type.Record(Type.String(), toolSchema),
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// external-tools.json lives one level up at the hook root
// (.claude/hooks/setup-security-tools/external-tools.json) — keep it
// out of `lib/` so it's discoverable as a top-level config file rather
// than buried as an implementation detail. Fall back to a sibling path
// so an early-installed copy in lib/ still resolves during onboarding.
const configPath = (() => {
  const parentPath = path.join(__dirname, '..', 'external-tools.json')
  if (existsSync(parentPath)) {
    return parentPath
  }
  return path.join(__dirname, 'external-tools.json')
})()
const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'))
const config = parseSchema(configSchema, rawConfig)

const AGENTSHIELD = config.tools['agentshield']!
const ZIZMOR = config.tools['zizmor']!
const SFW_FREE = config.tools['sfw-free']!
const SFW_ENTERPRISE = config.tools['sfw-enterprise']!

// ── Shared helpers ──

function findApiToken(): string | undefined {
  // SOCKET_API_TOKEN is the canonical env var; SOCKET_API_KEY is the
  // deprecated alias kept readable for one cycle so existing dev
  // setups don't break in lockstep with the rename.
  const envToken =
    process.env['SOCKET_API_TOKEN'] ?? process.env['SOCKET_API_KEY']
  if (envToken) return envToken
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  for (const filename of ['.env.local', '.env']) {
    const filepath = path.join(projectDir, filename)
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, 'utf8')
        const match =
          /^SOCKET_API_TOKEN\s*=\s*(.+)$/m.exec(content) ??
          /^SOCKET_API_KEY\s*=\s*(.+)$/m.exec(content)
        if (match) {
          return match[1]!
            .replace(/\s*#.*$/, '')      // Strip inline comments.
            .trim()                      // Strip whitespace before quote removal.
            .replace(/^["']|["']$/g, '') // Strip surrounding quotes.
        }
      } catch (e) {
        // We already checked existsSync; ENOENT here means a race with
        // an external delete (rare, ignorable). Anything else (EACCES,
        // EISDIR, decode failure) is a real signal — log it so the
        // operator can fix the perms / encoding instead of wondering
        // why their .env-stored token isn't being picked up.
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          const msg = e instanceof Error ? e.message : String(e)
          logger.warn(`could not read ${filepath}: ${msg}`)
        }
      }
    }
  }
  return undefined
}

// ── AgentShield ──

export async function setupAgentShield(): Promise<boolean> {
  logger.log('=== AgentShield ===')
  const purl = PackageURL.fromString(AGENTSHIELD.purl!)
  if (purl.type !== 'npm') {
    throw new Error(`Unsupported PURL type "${purl.type}" — only npm is supported`)
  }
  const npmPackage = purl.namespace ? `${purl.namespace}/${purl.name}` : purl.name!
  const version = AGENTSHIELD.version ?? purl.version
  const packageSpec = version ? `${npmPackage}@${version}` : npmPackage

  logger.log(`Installing ${packageSpec} via dlx...`)
  const { binaryPath, installed } = await downloadPackage({
    package: packageSpec,
    binaryName: 'agentshield',
  })

  // Verify the installed package matches the pinned version.
  //
  // Don't trust the binary's --version self-report: ecc-agentshield's
  // compiled bundle has a hardcoded version string that has drifted
  // from the published package.json (e.g. binary reports "1.5.0"
  // while npm latest + published package.json both say "1.4.0").
  // That's an upstream packaging issue; the authoritative answer
  // is the dlx-cached package.json, which is what npm actually
  // delivered after integrity-hash verification.
  if (version) {
    const pkgJsonPath = path.join(
      path.dirname(binaryPath),
      '..',
      'ecc-agentshield',
      'package.json',
    )
    let installedVersion: string | undefined
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
        version?: unknown
      }
      if (typeof pkgJson.version === 'string') {
        installedVersion = pkgJson.version
      }
    } catch {
      // Fall through — treat as unverifiable rather than fail.
    }
    if (installedVersion && installedVersion !== version) {
      logger.warn(
        `Version mismatch: pinned ${version}, installed ${installedVersion}`,
      )
      return false
    }
    const reportedVersion = installedVersion ?? version
    logger.log(
      installed
        ? `Installed: ${binaryPath} (${reportedVersion})`
        : `Cached: ${binaryPath} (${reportedVersion})`,
    )
  } else {
    logger.log(installed ? `Installed: ${binaryPath}` : `Cached: ${binaryPath}`)
  }
  return true
}

// ── Zizmor ──

async function checkZizmorVersion(binPath: string): Promise<boolean> {
  try {
    const result = await spawn(binPath, ['--version'], { stdio: 'pipe' })
    const output = typeof result.stdout === 'string'
      ? result.stdout.trim()
      : result.stdout.toString().trim()
    return ZIZMOR.version ? output.includes(ZIZMOR.version) : false
  } catch {
    return false
  }
}

export async function setupZizmor(): Promise<boolean> {
  logger.log('=== Zizmor ===')

  // Check PATH first (e.g. brew install).
  const systemBin = whichSync('zizmor', { nothrow: true })
  if (systemBin && typeof systemBin === 'string') {
    if (await checkZizmorVersion(systemBin)) {
      logger.log(`Found on PATH: ${systemBin} (v${ZIZMOR.version})`)
      return true
    }
    logger.log(`Found on PATH but wrong version (need v${ZIZMOR.version})`)
  }

  // Download archive via dlx (handles caching + checksum).
  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const platformEntry = ZIZMOR.checksums?.[platformKey]
  if (!platformEntry) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }
  const { asset, sha256: expectedSha } = platformEntry
  const repo = ZIZMOR.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/v${ZIZMOR.version}/${asset}`

  logger.log(`Downloading zizmor v${ZIZMOR.version} (${asset})...`)
  const { binaryPath: archivePath, downloaded } = await downloadBinary({
    url,
    name: `zizmor-${ZIZMOR.version}-${asset}`,
    sha256: expectedSha,
  })
  logger.log(downloaded ? 'Download complete, checksum verified.' : `Using cached archive: ${archivePath}`)

  // Extract binary from the cached archive.
  const ext = process.platform === 'win32' ? '.exe' : ''
  const binPath = path.join(path.dirname(archivePath), `zizmor${ext}`)
  if (existsSync(binPath) && await checkZizmorVersion(binPath)) {
    logger.log(`Cached: ${binPath} (v${ZIZMOR.version})`)
    return true
  }

  const isZip = asset.endsWith('.zip')
  // mkdtemp is collision-safe, unlike Date.now()-only naming.
  const extractDir = await fs.mkdtemp(path.join(tmpdir(), 'zizmor-extract-'))
  try {
    if (isZip) {
      await spawn('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`], { stdio: 'pipe' })
    } else {
      await spawn('tar', ['xzf', archivePath, '-C', extractDir], { stdio: 'pipe' })
    }
    const extractedBin = path.join(extractDir, `zizmor${ext}`)
    if (!existsSync(extractedBin)) throw new Error(`Binary not found after extraction: ${extractedBin}`)
    await fs.copyFile(extractedBin, binPath)
    await fs.chmod(binPath, 0o755)
  } finally {
    // Cleanup is fail-open by design — a tempdir we couldn't delete
    // (EPERM / EBUSY / ENOTEMPTY) shouldn't prevent the install from
    // reporting success — but the silent swallow loses the signal,
    // and orphaned tempdirs accumulate on the user's machine. Log
    // and continue.
    await safeDelete(extractDir).catch(e => {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`cleanup of extract dir failed (${extractDir}): ${msg}`)
    })
  }

  logger.log(`Installed to ${binPath}`)
  return true
}

// ── SFW ──

export async function setupSfw(
  apiToken: string | undefined,
): Promise<boolean> {
  const isEnterprise = !!apiToken
  const sfwConfig = isEnterprise ? SFW_ENTERPRISE : SFW_FREE
  logger.log(`=== Socket Firewall (${isEnterprise ? 'enterprise' : 'free'}) ===`)

  // Platform.
  const platformKey = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
  const platformEntry = sfwConfig.checksums?.[platformKey]
  if (!platformEntry) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }

  // Checksum + asset.
  const { asset, sha256 } = platformEntry
  const repo = sfwConfig.repository?.replace(/^[^:]+:/, '') ?? ''
  const url = `https://github.com/${repo}/releases/download/${sfwConfig.version}/${asset}`
  const binaryName = isEnterprise ? 'sfw' : 'sfw-free'

  // Download (with cache + checksum).
  const { binaryPath, downloaded } = await downloadBinary({ url, name: binaryName, sha256 })
  logger.log(downloaded ? `Downloaded to ${binaryPath}` : `Cached at ${binaryPath}`)

  // Create shims.
  const isWindows = process.platform === 'win32'

  const shimDir = path.join(getSocketHomePath(), 'sfw', 'shims')
  await fs.mkdir(shimDir, { recursive: true })
  const ecosystems = [...(sfwConfig.ecosystems ?? [])]
  if (isEnterprise && process.platform === 'linux') {
    ecosystems.push('go')
  }
  const cleanPath = (process.env['PATH'] ?? '').split(path.delimiter)
    .filter(p => p !== shimDir).join(path.delimiter)
  const sfwBin = normalizePath(binaryPath)
  const created: string[] = []
  for (const cmd of ecosystems) {
    let realBin = whichSync(cmd, { nothrow: true, path: cleanPath })
    if (!realBin || typeof realBin !== 'string') continue
    realBin = normalizePath(realBin)

    // Bash shim (macOS/Linux/Windows Git Bash).
    const bashLines = [
      '#!/bin/bash',
      `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -vxF '${shimDir}' | paste -sd: -)"`,
    ]
    if (isEnterprise) {
      // Read API token from env at runtime — never embed secrets in
      // scripts. SOCKET_API_TOKEN is canonical; SOCKET_API_KEY is the
      // deprecated alias kept for one cycle. Whichever name is set
      // gets exported under both so downstream tools see the value
      // regardless of which name they read.
      bashLines.push(
        'if [ -z "$SOCKET_API_TOKEN" ] && [ -n "$SOCKET_API_KEY" ]; then',
        '  SOCKET_API_TOKEN="$SOCKET_API_KEY"',
        'fi',
        'if [ -z "$SOCKET_API_TOKEN" ]; then',
        '  for f in .env.local .env; do',
        '    if [ -f "$f" ]; then',
        '      _val="$(grep -m1 "^SOCKET_API_TOKEN\\s*=" "$f" | sed "s/^[^=]*=\\s*//" | sed "s/\\s*#.*//" | sed "s/^[\"\\x27]\\(.*\\)[\"\\x27]$/\\1/")"',
        '      if [ -z "$_val" ]; then',
        '        _val="$(grep -m1 "^SOCKET_API_KEY\\s*=" "$f" | sed "s/^[^=]*=\\s*//" | sed "s/\\s*#.*//" | sed "s/^[\"\\x27]\\(.*\\)[\"\\x27]$/\\1/")"',
        '      fi',
        '      if [ -n "$_val" ]; then SOCKET_API_TOKEN="$_val"; break; fi',
        '    fi',
        '  done',
        'fi',
        'if [ -n "$SOCKET_API_TOKEN" ]; then',
        '  export SOCKET_API_TOKEN',
        '  SOCKET_API_KEY="$SOCKET_API_TOKEN"',
        '  export SOCKET_API_KEY',
        'fi',
      )
    }
    bashLines.push(`exec "${sfwBin}" "${realBin}" "$@"`)
    const bashContent = bashLines.join('\n') + '\n'
    const bashPath = path.join(shimDir, cmd)
    if (!existsSync(bashPath) || await fs.readFile(bashPath, 'utf8').catch(() => '') !== bashContent) {
      await fs.writeFile(bashPath, bashContent, { mode: 0o755 })
    }
    created.push(cmd)

    // Windows .cmd shim (strips shim dir from PATH, then execs through sfw).
    if (isWindows) {
      let cmdApiTokenBlock = ''
      if (isEnterprise) {
        // Read API token from .env files at runtime — mirrors the bash
        // shim logic. SOCKET_API_TOKEN is canonical; SOCKET_API_KEY is
        // the deprecated alias kept for one cycle.
        cmdApiTokenBlock =
          `if not defined SOCKET_API_TOKEN (\r\n`
          + `  if defined SOCKET_API_KEY set "SOCKET_API_TOKEN=%SOCKET_API_KEY%"\r\n`
          + `)\r\n`
          + `if not defined SOCKET_API_TOKEN (\r\n`
          + `  for %%F in (.env.local .env) do (\r\n`
          + `    if exist "%%F" (\r\n`
          + `      for /f "tokens=1,* delims==" %%A in ('findstr /b "SOCKET_API_TOKEN" "%%F"') do (\r\n`
          + `        set "SOCKET_API_TOKEN=%%B"\r\n`
          + `      )\r\n`
          + `      for /f "tokens=1,* delims==" %%A in ('findstr /b "SOCKET_API_KEY" "%%F"') do (\r\n`
          + `        if not defined SOCKET_API_TOKEN set "SOCKET_API_TOKEN=%%B"\r\n`
          + `      )\r\n`
          + `    )\r\n`
          + `  )\r\n`
          + `)\r\n`
          + `if defined SOCKET_API_TOKEN set "SOCKET_API_KEY=%SOCKET_API_TOKEN%"\r\n`
      }
      const cmdContent =
        `@echo off\r\n`
        + `set "PATH=;%PATH%;"\r\n`
        + `set "PATH=%PATH:;${shimDir};=%"\r\n`
        + `set "PATH=%PATH:~1,-1%"\r\n`
        + cmdApiTokenBlock
        + `"${sfwBin}" "${realBin}" %*\r\n`
      const cmdPath = path.join(shimDir, `${cmd}.cmd`)
      if (!existsSync(cmdPath) || await fs.readFile(cmdPath, 'utf8').catch(() => '') !== cmdContent) {
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

// ── Main ──

async function main(): Promise<void> {
  logger.log('Setting up Socket security tools...\n')

  const apiToken = findApiToken()

  const agentshieldOk = await setupAgentShield()
  logger.log('')
  const zizmorOk = await setupZizmor()
  logger.log('')
  const sfwOk = await setupSfw(apiToken)
  logger.log('')

  logger.log('=== Summary ===')
  logger.log(`AgentShield: ${agentshieldOk ? 'ready' : 'NOT AVAILABLE'}`)
  logger.log(`Zizmor:      ${zizmorOk ? 'ready' : 'FAILED'}`)
  logger.log(`SFW:         ${sfwOk ? 'ready' : 'FAILED'}`)

  if (agentshieldOk && zizmorOk && sfwOk) {
    logger.log('\nAll security tools ready.')
  } else {
    logger.warn('\nSome tools not available. See above.')
  }
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
