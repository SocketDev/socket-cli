/**
 * Test script to download security tools for VFS bundling proof-of-concept.
 * Downloads Trivy, TruffleHog, and OpenGrep for the current platform.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = getDefaultLogger()

// Map current platform to security tool binary names.
const PLATFORM_MAP = {
  __proto__: null,
  'darwin-arm64': {
    trivy: 'trivy_0.69.1_macOS-ARM64.tar.gz',
    trufflehog: 'trufflehog_3.93.1_darwin_arm64.tar.gz',
    opengrep: 'opengrep-core_osx_aarch64.tar.gz',
  },
  'darwin-x64': {
    trivy: 'trivy_0.69.1_macOS-64bit.tar.gz',
    trufflehog: 'trufflehog_3.93.1_darwin_amd64.tar.gz',
    opengrep: 'opengrep-core_osx_x86.tar.gz',
  },
  'linux-arm64': {
    trivy: 'trivy_0.69.1_Linux-ARM64.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_arm64.tar.gz',
    opengrep: 'opengrep-core_linux_aarch64.tar.gz',
  },
  'linux-x64': {
    trivy: 'trivy_0.69.1_Linux-64bit.tar.gz',
    trufflehog: 'trufflehog_3.93.1_linux_amd64.tar.gz',
    opengrep: 'opengrep-core_linux_x86.tar.gz',
  },
  'win32-x64': {
    trivy: 'trivy_0.69.1_windows-64bit.zip',
    trufflehog: 'trufflehog_3.93.1_windows_amd64.tar.gz',
    opengrep: 'opengrep-core_windows_x86.zip',
  },
}

const TOOL_REPOS = {
  __proto__: null,
  trivy: { owner: 'aquasecurity', repo: 'trivy', version: 'v0.69.1' },
  trufflehog: {
    owner: 'trufflesecurity',
    repo: 'trufflehog',
    version: 'v3.93.1',
  },
  opengrep: { owner: 'opengrep', repo: 'opengrep', version: 'v1.16.0' },
}

/**
 * Get current platform identifier.
 */
function getCurrentPlatform() {
  const platform = process.platform
  const arch = process.arch
  return `${platform}-${arch}`
}

/**
 * Download a file from GitHub releases using curl (simpler than handling streams).
 */
async function downloadFile(url, destPath) {
  logger.log(`Downloading: ${url}`)

  await safeMkdir(path.dirname(destPath))

  // Use curl for simplicity.
  const curlResult = await spawn('curl', ['-L', '-o', destPath, url], {
    stdio: 'pipe',
  })

  if (curlResult.exitCode !== 0) {
    throw new Error(`curl failed: ${curlResult.stderr}`)
  }

  const stats = await fs.stat(destPath)
  logger.log(`Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
}

/**
 * Extract binary from tar.gz archive using system tar command.
 */
async function extractFromTarGz(archivePath, outputPath, binaryName) {
  logger.log(`Extracting ${binaryName} from ${path.basename(archivePath)}...`)

  // Extract to temp directory.
  const tempDir = path.join(path.dirname(archivePath), 'temp-extract')
  await safeMkdir(tempDir)

  // Use system tar command.
  const tarResult = await spawn('tar', ['-xzf', archivePath, '-C', tempDir], {
    stdio: 'pipe',
  })

  if (tarResult.exitCode !== 0) {
    throw new Error(`tar extraction failed: ${tarResult.stderr}`)
  }

  // Find the binary.
  const files = await fs.readdir(tempDir, {
    recursive: true,
    withFileTypes: true,
  })
  const binaryFile = files.find(
    f =>
      f.isFile() && (f.name === binaryName || f.name === `${binaryName}.exe`),
  )

  if (!binaryFile) {
    throw new Error(`Binary ${binaryName} not found in archive`)
  }

  const sourcePath = path.join(
    binaryFile.parentPath || binaryFile.path,
    binaryFile.name,
  )
  await fs.copyFile(sourcePath, outputPath)

  if (process.platform !== 'win32') {
    await fs.chmod(outputPath, 0o755)
  }

  // Cleanup.
  await fs.rm(tempDir, { recursive: true, force: true })

  const stats = await fs.stat(outputPath)
  logger.log(
    `Extracted: ${binaryName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
  )
}

/**
 * Download and extract a security tool.
 */
async function downloadTool(toolName, platform) {
  const config = TOOL_REPOS[toolName]
  const assetName = PLATFORM_MAP[platform]?.[toolName]

  if (!assetName) {
    logger.warn(`${toolName} not available for platform: ${platform}`)
    return null
  }

  const outputDir = path.join(
    __dirname,
    '../../../build-infra/build/security-tools-test',
    platform,
  )
  await safeMkdir(outputDir)

  const archivePath = path.join(outputDir, assetName)
  // OpenGrep binary is named "opengrep-core" in the archive.
  const archiveBinaryName = toolName === 'opengrep' ? 'opengrep-core' : toolName
  const binaryName = toolName + (process.platform === 'win32' ? '.exe' : '')
  const binaryPath = path.join(outputDir, binaryName)

  // Skip if already downloaded.
  if (existsSync(binaryPath)) {
    const stats = await fs.stat(binaryPath)
    logger.log(
      `Already exists: ${binaryName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
    )
    return binaryPath
  }

  // Download archive.
  const url = `https://github.com/${config.owner}/${config.repo}/releases/download/${config.version}/${assetName}`
  await downloadFile(url, archivePath)

  // Extract binary.
  await extractFromTarGz(archivePath, binaryPath, archiveBinaryName)

  // Cleanup archive.
  await fs.unlink(archivePath)

  return binaryPath
}

/**
 * Main function.
 */
async function main() {
  const platform = getCurrentPlatform()

  logger.log(`Testing security tool download for platform: ${platform}`)
  logger.log('')

  const tools = ['trivy', 'trufflehog', 'opengrep']
  const toolPaths = new Map()

  for (const tool of tools) {
    try {
      const toolPath = await downloadTool(tool, platform)
      if (toolPath) {
        toolPaths.set(tool, toolPath)
      }
    } catch (e) {
      logger.error(`Failed to download ${tool}: ${e.message}`)
    }
  }

  logger.log('')
  logger.log('Downloaded tools:')
  let totalSize = 0
  for (const [tool, toolPath] of toolPaths) {
    const stats = await fs.stat(toolPath)
    const sizeMB = stats.size / 1024 / 1024
    totalSize += stats.size
    logger.log(`  ${tool}: ${toolPath}`)
    logger.log(`    Size: ${sizeMB.toFixed(2)} MB`)
  }

  logger.log('')
  logger.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)

  // Create a mapping file for build script.
  const mappingPath = path.join(
    __dirname,
    '../../../build-infra/build/security-tools-test',
    platform,
    'tool-paths.json',
  )
  const mapping = {
    __proto__: null,
    platform,
    tools: Object.fromEntries(toolPaths),
  }
  await fs.writeFile(mappingPath, JSON.stringify(mapping, null, 2))
  logger.log(`Wrote tool paths to: ${mappingPath}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
