#!/usr/bin/env node
// Setup script for Socket Firewall (SFW).
//
// Downloads the correct SFW binary for the current platform, verifies its
// SHA-256 checksum, caches it via dlxBinary, and creates PATH shims for
// supported package managers.
//
// Enterprise vs free mode is determined by the presence of SOCKET_API_KEY
// in the environment or in .env / .env.local files at the project root.

import { existsSync, readFileSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib/bin'
import { downloadBinary } from '@socketsecurity/lib/dlx/binary'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { getSocketHomePath } from '@socketsecurity/lib/paths/socket'

const logger = getDefaultLogger()

// Checksums from socket-registry CI (setup/action.yml).
const ENTERPRISE_CHECKSUMS: Record<string, string> = {
  __proto__: null as unknown as string,
  'linux-x86_64': '9115b4ca8021eb173eb9e9c3627deb7f1066f8debd48c5c9d9f3caabb2a26a4b',
  'linux-arm64': '671270231617142404a1564e52672f79b806f9df3f232fcc7606329c0246da55',
  'macos-x86_64': '01d64d40effda35c31f8d8ee1fed1388aac0a11aba40d47fba8a36024b77500c',
  'macos-arm64': 'acad0b517601bb7408e2e611c9226f47dcccbd83333d7fc5157f1d32ed2b953d',
  'windows-x86_64': '9a50e1ddaf038138c3f85418dc5df0113bbe6fc884f5abe158beaa9aea18d70a',
}

const FREE_CHECKSUMS: Record<string, string> = {
  __proto__: null as unknown as string,
  'linux-x86_64': '4a1e8b65e90fce7d5fd066cf0af6c93d512065fa4222a475c8d959a6bc14b9ff',
  'linux-arm64': 'df2eedb2daf2572eee047adb8bfd81c9069edcb200fc7d3710fca98ec3ca81a1',
  'macos-x86_64': '724ccea19d847b79db8cc8e38f5f18ce2dd32336007f42b11bed7d2e5f4a2566',
  'macos-arm64': 'bf1616fc44ac49f1cb2067fedfa127a3ae65d6ec6d634efbb3098cfa355e5555',
  'windows-x86_64': 'c953e62ad7928d4d8f2302f5737884ea1a757babc26bed6a42b9b6b68a5d54af',
}

const PLATFORM_MAP: Record<string, string> = {
  __proto__: null as unknown as string,
  'darwin-arm64': 'macos-arm64',
  'darwin-x64': 'macos-x86_64',
  'linux-arm64': 'linux-arm64',
  'linux-x64': 'linux-x86_64',
  'win32-x64': 'windows-x86_64',
}

const FREE_ECOSYSTEMS = ['npm', 'yarn', 'pnpm', 'pip', 'uv', 'cargo']
const ENTERPRISE_EXTRA_ECOSYSTEMS = ['gem', 'bundler', 'nuget']

function findApiKey(): string | undefined {
  // Check environment first.
  const envKey = process.env['SOCKET_API_KEY']
  if (envKey) {
    return envKey
  }
  // Check .env and .env.local in project root.
  const projectRoot = process.cwd()
  for (const filename of ['.env', '.env.local']) {
    const filepath = path.join(projectRoot, filename)
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, 'utf8')
        const match = /^SOCKET_API_KEY=(.+)$/m.exec(content)
        if (match) {
          return match[1]!.trim()
        }
      } catch {
        // Ignore read errors.
      }
    }
  }
  return undefined
}

function getPlatformKey(): string {
  const key = `${process.platform}-${process.arch}`
  const mapped = PLATFORM_MAP[key]
  if (!mapped) {
    throw new Error(`Unsupported platform: ${key}`)
  }
  return mapped
}

function getAssetName(platformKey: string, isEnterprise: boolean): string {
  const prefix = isEnterprise ? 'sfw' : 'sfw-free'
  const suffix = platformKey.startsWith('windows') ? '.exe' : ''
  return `${prefix}-${platformKey}${suffix}`
}

function getDownloadUrl(isEnterprise: boolean, asset: string): string {
  const repo = isEnterprise ? 'SocketDev/firewall-release' : 'SocketDev/sfw-free'
  return `https://github.com/${repo}/releases/latest/download/${asset}`
}

function getShimDir(): string {
  return path.join(getSocketHomePath(), 'sfw', 'shims')
}

function getEcosystems(isEnterprise: boolean): string[] {
  const ecosystems = [...FREE_ECOSYSTEMS]
  if (isEnterprise) {
    ecosystems.push(...ENTERPRISE_EXTRA_ECOSYSTEMS)
    // Go wrapper mode is only supported on Linux.
    if (process.platform === 'linux') {
      ecosystems.push('go')
    }
  }
  return ecosystems
}

function buildShimContent(
  sfwBinPath: string,
  realBinPath: string,
  shimDir: string,
  isEnterprise: boolean,
  apiKey: string | undefined,
): string {
  const lines = [
    '#!/bin/bash',
    `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -vxF '${shimDir}' | paste -sd: -)"`,
  ]
  if (isEnterprise && apiKey) {
    lines.push(`export SOCKET_API_KEY="${apiKey}"`)
  }
  if (!isEnterprise) {
    // Workaround: sfw-free does not yet set GIT_SSL_CAINFO.
    lines.push('export GIT_SSL_NO_VERIFY=true')
  }
  lines.push(`exec "${sfwBinPath}" "${realBinPath}" "$@"`)
  return lines.join('\n') + '\n'
}

async function createShims(
  sfwBinPath: string,
  shimDir: string,
  isEnterprise: boolean,
  apiKey: string | undefined,
): Promise<string[]> {
  await fs.mkdir(shimDir, { recursive: true })
  const ecosystems = getEcosystems(isEnterprise)
  const createdShims: string[] = []
  // Strip shim dir from PATH when resolving real binaries.
  const cleanPath = (process.env['PATH'] ?? '')
    .split(path.delimiter)
    .filter(p => p !== shimDir)
    .join(path.delimiter)
  for (const cmd of ecosystems) {
    const realBin = whichSync(cmd, { nothrow: true, path: cleanPath })
    if (!realBin || typeof realBin !== 'string') {
      continue
    }
    const shimPath = path.join(shimDir, cmd)
    const content = buildShimContent(sfwBinPath, realBin, shimDir, isEnterprise, apiKey)
    // Skip if shim already exists with identical content.
    if (existsSync(shimPath)) {
      try {
        const existing = await fs.readFile(shimPath, 'utf8')
        if (existing === content) {
          createdShims.push(cmd)
          continue
        }
      } catch {
        // Overwrite on read error.
      }
    }
    await fs.writeFile(shimPath, content, { mode: 0o755 })
    createdShims.push(cmd)
  }
  return createdShims
}

async function main(): Promise<void> {
  logger.log('Setting up Socket Firewall (SFW)...')

  // Step 1: Find API key to determine mode.
  const apiKey = findApiKey()
  const isEnterprise = !!apiKey
  logger.log(`Mode: ${isEnterprise ? 'enterprise' : 'free'}`)

  // Step 2: Determine platform and pick asset + checksum.
  const platformKey = getPlatformKey()
  const checksums = isEnterprise ? ENTERPRISE_CHECKSUMS : FREE_CHECKSUMS
  const sha256 = checksums[platformKey]
  if (!sha256) {
    throw new Error(`No checksum for platform: ${platformKey}`)
  }
  const asset = getAssetName(platformKey, isEnterprise)
  const url = getDownloadUrl(isEnterprise, asset)
  const binaryName = isEnterprise ? 'sfw' : 'sfw-free'

  logger.log(`Platform: ${platformKey}`)
  logger.log(`Asset: ${asset}`)

  // Step 3: Download binary (with caching and SHA-256 verification).
  const { binaryPath, downloaded } = await downloadBinary({
    url,
    name: binaryName,
    sha256,
  })
  if (downloaded) {
    logger.log(`Downloaded SFW binary to ${binaryPath}`)
  } else {
    logger.log(`SFW binary already cached at ${binaryPath}`)
  }

  // Step 4: Create shims.
  const shimDir = getShimDir()
  const createdShims = await createShims(binaryPath, shimDir, isEnterprise, apiKey)
  if (!createdShims.length) {
    logger.warn('No supported package managers found on PATH.')
  } else {
    logger.log(`Created shims for: ${createdShims.join(', ')}`)
  }

  // Step 5: Output PATH instruction.
  logger.log('')
  logger.log('SFW setup complete.')
  logger.log(`Shim directory: ${shimDir}`)
  logger.log('')
  logger.log('Add the shim directory to the front of your PATH:')
  logger.log(`  export PATH="${shimDir}:$PATH"`)
  logger.log('')
  logger.log('To make this permanent, add the export line to your shell profile')
  logger.log('(e.g. ~/.bashrc, ~/.zshrc, or ~/.profile).')
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
