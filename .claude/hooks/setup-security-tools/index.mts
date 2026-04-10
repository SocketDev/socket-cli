#!/usr/bin/env node
// Setup script for Socket security tools.
//
// Configures three tools:
// 1. AgentShield — scans Claude AI config for prompt injection / secrets.
//    Already a devDep (ecc-agentshield); this script verifies it's installed.
// 2. Zizmor — static analysis for GitHub Actions workflows. Downloads the
//    correct binary, verifies SHA-256, caches at ~/.socket/zizmor/bin/zizmor.
// 3. SFW (Socket Firewall) — intercepts package manager commands to scan
//    for malware. Downloads binary, verifies SHA-256, creates PATH shims.
//    Enterprise vs free determined by SOCKET_API_KEY in env / .env / .env.local.

import { createHash } from 'node:crypto'
import { existsSync, createReadStream, readFileSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib/bin'
import { downloadBinary } from '@socketsecurity/lib/dlx/binary'
import { httpDownload } from '@socketsecurity/lib/http-request'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getSocketHomePath } from '@socketsecurity/lib/paths/socket'
import { spawn, spawnSync } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

// ── Zizmor constants ──

const ZIZMOR_VERSION = '1.23.1'

const ZIZMOR_CHECKSUMS: Record<string, string> = {
  __proto__: null as unknown as string,
  'zizmor-aarch64-apple-darwin.tar.gz':
    '2632561b974c69f952258c1ab4b7432d5c7f92e555704155c3ac28a2910bd717',
  'zizmor-aarch64-unknown-linux-gnu.tar.gz':
    '3725d7cd7102e4d70827186389f7d5930b6878232930d0a3eb058d7e5b47e658',
  'zizmor-x86_64-apple-darwin.tar.gz':
    '89d5ed42081dd9d0433a10b7545fac42b35f1f030885c278b9712b32c66f2597',
  'zizmor-x86_64-pc-windows-msvc.zip':
    '33c2293ff02834720dd7cd8b47348aafb2e95a19bdc993c0ecaca9c804ade92a',
  'zizmor-x86_64-unknown-linux-gnu.tar.gz':
    '67a8df0a14352dd81882e14876653d097b99b0f4f6b6fe798edc0320cff27aff',
}

const ZIZMOR_ASSET_MAP: Record<string, string> = {
  __proto__: null as unknown as string,
  'darwin-arm64': 'zizmor-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'zizmor-x86_64-apple-darwin.tar.gz',
  'linux-arm64': 'zizmor-aarch64-unknown-linux-gnu.tar.gz',
  'linux-x64': 'zizmor-x86_64-unknown-linux-gnu.tar.gz',
  'win32-x64': 'zizmor-x86_64-pc-windows-msvc.zip',
}

// ── SFW constants ──

const SFW_ENTERPRISE_CHECKSUMS: Record<string, string> = {
  __proto__: null as unknown as string,
  'linux-arm64': '671270231617142404a1564e52672f79b806f9df3f232fcc7606329c0246da55',
  'linux-x86_64': '9115b4ca8021eb173eb9e9c3627deb7f1066f8debd48c5c9d9f3caabb2a26a4b',
  'macos-arm64': 'acad0b517601bb7408e2e611c9226f47dcccbd83333d7fc5157f1d32ed2b953d',
  'macos-x86_64': '01d64d40effda35c31f8d8ee1fed1388aac0a11aba40d47fba8a36024b77500c',
  'windows-x86_64': '9a50e1ddaf038138c3f85418dc5df0113bbe6fc884f5abe158beaa9aea18d70a',
}

const SFW_FREE_CHECKSUMS: Record<string, string> = {
  __proto__: null as unknown as string,
  'linux-arm64': 'df2eedb2daf2572eee047adb8bfd81c9069edcb200fc7d3710fca98ec3ca81a1',
  'linux-x86_64': '4a1e8b65e90fce7d5fd066cf0af6c93d512065fa4222a475c8d959a6bc14b9ff',
  'macos-arm64': 'bf1616fc44ac49f1cb2067fedfa127a3ae65d6ec6d634efbb3098cfa355e5555',
  'macos-x86_64': '724ccea19d847b79db8cc8e38f5f18ce2dd32336007f42b11bed7d2e5f4a2566',
  'windows-x86_64': 'c953e62ad7928d4d8f2302f5737884ea1a757babc26bed6a42b9b6b68a5d54af',
}

const SFW_PLATFORM_MAP: Record<string, string> = {
  __proto__: null as unknown as string,
  'darwin-arm64': 'macos-arm64',
  'darwin-x64': 'macos-x86_64',
  'linux-arm64': 'linux-arm64',
  'linux-x64': 'linux-x86_64',
  'win32-x64': 'windows-x86_64',
}

const SFW_FREE_ECOSYSTEMS = ['npm', 'yarn', 'pnpm', 'pip', 'uv', 'cargo']
const SFW_ENTERPRISE_EXTRA = ['gem', 'bundler', 'nuget']

// ── Shared helpers ──

function findApiKey(): string | undefined {
  const envKey = process.env['SOCKET_API_KEY']
  if (envKey) return envKey
  for (const filename of ['.env.local', '.env']) {
    const filepath = path.join(process.cwd(), filename)
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, 'utf8')
        const match = /^SOCKET_API_KEY\s*=\s*(.+)$/m.exec(content)
        if (match) {
          return match[1]!
            .replace(/\s*#.*$/, '')      // Strip inline comments.
            .trim()                      // Strip whitespace before quote removal.
            .replace(/^["']|["']$/g, '') // Strip surrounding quotes.
        }
      } catch {
        // Ignore read errors.
      }
    }
  }
  return undefined
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: Buffer) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// ── AgentShield ──

function setupAgentShield(): boolean {
  logger.log('=== AgentShield ===')
  const bin = whichSync('agentshield', { nothrow: true })
  if (bin && typeof bin === 'string') {
    const result = spawnSync(bin, ['--version'], { stdio: 'pipe' })
    const ver = typeof result.stdout === 'string'
      ? result.stdout.trim()
      : result.stdout.toString().trim()
    logger.log(`Found: ${bin} (${ver})`)
    return true
  }
  logger.warn('Not found. Run "pnpm install" to install ecc-agentshield.')
  return false
}

// ── Zizmor ──

async function checkZizmorVersion(binPath: string): Promise<boolean> {
  try {
    const result = await spawn(binPath, ['--version'], { stdio: 'pipe' })
    const output = typeof result.stdout === 'string'
      ? result.stdout.trim()
      : result.stdout.toString().trim()
    return output.includes(ZIZMOR_VERSION)
  } catch {
    return false
  }
}

async function setupZizmor(): Promise<boolean> {
  logger.log('=== Zizmor ===')

  // Check PATH first (e.g. brew install).
  const systemBin = whichSync('zizmor', { nothrow: true })
  if (systemBin && typeof systemBin === 'string') {
    if (await checkZizmorVersion(systemBin)) {
      logger.log(`Found on PATH: ${systemBin} (v${ZIZMOR_VERSION})`)
      return true
    }
    logger.log(`Found on PATH but wrong version (need v${ZIZMOR_VERSION})`)
  }

  // Check cached binary.
  const ext = process.platform === 'win32' ? '.exe' : ''
  const binDir = path.join(getSocketHomePath(), 'zizmor', 'bin')
  const binPath = path.join(binDir, `zizmor${ext}`)
  if (existsSync(binPath) && await checkZizmorVersion(binPath)) {
    logger.log(`Cached: ${binPath} (v${ZIZMOR_VERSION})`)
    return true
  }

  // Download.
  const platformKey = `${process.platform}-${process.arch}`
  const asset = ZIZMOR_ASSET_MAP[platformKey]
  if (!asset) throw new Error(`Unsupported platform: ${platformKey}`)
  const expectedSha = ZIZMOR_CHECKSUMS[asset]
  if (!expectedSha) throw new Error(`No checksum for: ${asset}`)
  const url = `https://github.com/woodruffw/zizmor/releases/download/v${ZIZMOR_VERSION}/${asset}`
  const isZip = asset.endsWith('.zip')

  logger.log(`Downloading zizmor v${ZIZMOR_VERSION} (${asset})...`)
  const tmpFile = path.join(tmpdir(), `zizmor-${Date.now()}-${asset}`)
  try {
    await httpDownload(url, tmpFile, { sha256: expectedSha })
    logger.log('Download complete, checksum verified.')

    // Extract.
    const extractDir = path.join(tmpdir(), `zizmor-extract-${Date.now()}`)
    await fs.mkdir(extractDir, { recursive: true })
    if (isZip) {
      await spawn('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Path '${tmpFile}' -DestinationPath '${extractDir}' -Force`], { stdio: 'pipe' })
    } else {
      await spawn('tar', ['xzf', tmpFile, '-C', extractDir], { stdio: 'pipe' })
    }

    // Install.
    const extractedBin = path.join(extractDir, `zizmor${ext}`)
    if (!existsSync(extractedBin)) throw new Error(`Binary not found after extraction: ${extractedBin}`)
    await fs.mkdir(binDir, { recursive: true })
    await fs.copyFile(extractedBin, binPath)
    await fs.chmod(binPath, 0o755)
    await fs.rm(extractDir, { recursive: true, force: true })

    logger.log(`Installed to ${binPath}`)
    return true
  } finally {
    if (existsSync(tmpFile)) await fs.unlink(tmpFile).catch(() => {})
  }
}

// ── SFW ──

async function setupSfw(apiKey: string | undefined): Promise<boolean> {
  const isEnterprise = !!apiKey
  logger.log(`=== Socket Firewall (${isEnterprise ? 'enterprise' : 'free'}) ===`)

  // Platform.
  const platformKey = `${process.platform}-${process.arch}`
  const sfwPlatform = SFW_PLATFORM_MAP[platformKey]
  if (!sfwPlatform) throw new Error(`Unsupported platform: ${platformKey}`)

  // Checksum + asset.
  const checksums = isEnterprise ? SFW_ENTERPRISE_CHECKSUMS : SFW_FREE_CHECKSUMS
  const sha256 = checksums[sfwPlatform]
  if (!sha256) throw new Error(`No checksum for: ${sfwPlatform}`)
  const prefix = isEnterprise ? 'sfw' : 'sfw-free'
  const suffix = sfwPlatform.startsWith('windows') ? '.exe' : ''
  const asset = `${prefix}-${sfwPlatform}${suffix}`
  const repo = isEnterprise ? 'SocketDev/firewall-release' : 'SocketDev/sfw-free'
  const url = `https://github.com/${repo}/releases/latest/download/${asset}`
  const binaryName = isEnterprise ? 'sfw' : 'sfw-free'

  // Download (with cache + checksum).
  const { binaryPath, downloaded } = await downloadBinary({ url, name: binaryName, sha256 })
  logger.log(downloaded ? `Downloaded to ${binaryPath}` : `Cached at ${binaryPath}`)

  // Create shims.
  const isWindows = process.platform === 'win32'
  const shimDir = path.join(getSocketHomePath(), 'sfw', 'shims')
  await fs.mkdir(shimDir, { recursive: true })
  const ecosystems = [...SFW_FREE_ECOSYSTEMS]
  if (isEnterprise) {
    ecosystems.push(...SFW_ENTERPRISE_EXTRA)
    if (process.platform === 'linux') ecosystems.push('go')
  }
  const cleanPath = (process.env['PATH'] ?? '').split(path.delimiter)
    .filter(p => p !== shimDir).join(path.delimiter)
  const created: string[] = []
  for (const cmd of ecosystems) {
    const realBin = whichSync(cmd, { nothrow: true, path: cleanPath })
    if (!realBin || typeof realBin !== 'string') continue

    // Bash shim (macOS/Linux).
    const bashLines = [
      '#!/bin/bash',
      `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -vxF '${shimDir}' | paste -sd: -)"`,
    ]
    if (isEnterprise) {
      // Read API key from env at runtime — never embed secrets in scripts.
      bashLines.push(
        'if [ -z "$SOCKET_API_KEY" ]; then',
        '  for f in .env.local .env; do',
        '    if [ -f "$f" ]; then',
        '      _val="$(grep -m1 "^SOCKET_API_KEY\\s*=" "$f" | sed "s/^[^=]*=\\s*//" | sed "s/\\s*#.*//" | sed "s/^[\"\\x27]\\(.*\\)[\"\\x27]$/\\1/")"',
        '      if [ -n "$_val" ]; then SOCKET_API_KEY="$_val"; break; fi',
        '    fi',
        '  done',
        '  export SOCKET_API_KEY',
        'fi',
      )
    }
    if (!isEnterprise) {
      // Workaround: sfw-free does not yet set GIT_SSL_CAINFO (temporary).
      bashLines.push('export GIT_SSL_NO_VERIFY=true')
    }
    bashLines.push(`exec "${binaryPath}" "${realBin}" "$@"`)
    const bashContent = bashLines.join('\n') + '\n'
    const bashPath = path.join(shimDir, cmd)
    if (!existsSync(bashPath) || await fs.readFile(bashPath, 'utf8').catch(() => '') !== bashContent) {
      await fs.writeFile(bashPath, bashContent, { mode: 0o755 })
    }
    created.push(cmd)

    // Windows .cmd shim (strips shim dir from PATH, then execs through sfw).
    if (isWindows) {
      const cmdContent =
        `@echo off\r\n`
        + `set "PATH=;%PATH%;"\r\n`
        + `set "PATH=%PATH:;${shimDir};=%"\r\n`
        + `set "PATH=%PATH:~1,-1%"\r\n`
        + `"${binaryPath}" "${realBin}" %*\r\n`
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
  return true
}

// ── Main ──

async function main(): Promise<void> {
  logger.log('Setting up Socket security tools...\n')

  const apiKey = findApiKey()

  const agentshieldOk = setupAgentShield()
  logger.log('')
  const zizmorOk = await setupZizmor()
  logger.log('')
  const sfwOk = await setupSfw(apiKey)
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
  logger.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
