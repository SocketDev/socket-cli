/**
 * @fileoverview Prepares @socketbin/* binary packages for publishing.
 * Updates package.json with version and buildMethod, removes private field,
 * and copies the binary to the bin/ directory.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import semver from 'semver'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

/**
 * Generates a datetime-based version string in semver format.
 * Reads base version from the current package's package.json.
 * Format: X.Y.Z-YYYYMMDD.HHmmss
 */
function generateDatetimeVersion(platform, arch, tool = 'cli') {
  // Read base version from the current package being generated.
  const basePackagePath = path.join(rootDir, 'packages', `socketbin-${tool}-${platform}-${arch}`, 'package.json')
  let baseVersion = '0.0.0'

  try {
    const basePackage = JSON.parse(require('fs').readFileSync(basePackagePath, 'utf-8'))
    const version = basePackage.version || '0.0.0'
    // Extract just the core version (X.Y.Z), ignoring any prerelease/placeholder text.
    const versionMatch = version.match(/^(\d+\.\d+\.\d+)/)
    if (versionMatch) {
      baseVersion = versionMatch[1]
    }
  } catch {
    // Fallback to 0.0.0 if package doesn't exist yet.
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `${baseVersion}-${year}${month}${day}.${hours}${minutes}${seconds}`
}

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    arch: { type: 'string' },
    version: { type: 'string' },
    tool: { type: 'string', default: 'cli' },
    outdir: { type: 'string' },
    method: { type: 'string', default: 'smol' },
  },
})

const {
  arch,
  outdir,
  platform,
  tool = 'cli',
  version: providedVersion,
  method: buildMethod = 'smol',
} = values

if (!platform || !arch) {
  getDefaultLogger().error(
    'Usage: prepublish-socketbin.mjs --platform=darwin --arch=arm64 [--version=0.0.0-20250122.143052] [--method=smol]',
  )
  process.exit(1)
}

// Clean version (remove 'v' prefix if present) or generate if not provided
const cleanVersion = providedVersion
  ? providedVersion.replace(/^v/, '')
  : generateDatetimeVersion(platform, arch, tool)

// Determine output directory - use tracked socketbin packages
const packageDir =
  outdir ||
  path.join(rootDir, 'packages', `socketbin-${tool}-${platform}-${arch}`)

// Platform display names
const platformNames = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
}

const archNames = {
  x64: 'x64',
  arm64: 'ARM64',
}

// Binary name (with .exe for Windows)
// Always use 'socket' as the binary name regardless of tool value
const binaryName = platform === 'win32' ? 'socket.exe' : 'socket'

// Update package directory structure
async function generatePackage() {
  try {
    // Ensure bin directory exists
    await fs.mkdir(path.join(packageDir, 'bin'), { recursive: true })

    // Read existing package.json
    const pkgPath = path.join(packageDir, 'package.json')
    const existingPkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

    // Update package.json with new version, buildMethod, and remove private
    const updatedPkg = {
      ...existingPkg,
      version: cleanVersion,
      buildMethod,
    }
    delete updatedPkg.private

    // Write updated package.json
    await fs.writeFile(pkgPath, `${JSON.stringify(updatedPkg, null, 2)}\n`)
    getDefaultLogger().log(`Updated: ${packageDir}/package.json`)
    getDefaultLogger().log(`  Version: ${cleanVersion}`)
    getDefaultLogger().log(`  Build method: ${buildMethod}`)

    // Check if binary exists and copy it
    const sourceBinary = path.join(
      rootDir,
      'dist',
      'sea',
      `socket-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`,
    )
    const targetBinary = path.join(packageDir, 'bin', binaryName)

    try {
      await fs.copyFile(sourceBinary, targetBinary)
      // Make executable on Unix
      if (platform !== 'win32') {
        await fs.chmod(targetBinary, 0o755)
      }
      getDefaultLogger().log(`Copied binary: ${sourceBinary} -> ${targetBinary}`)
    } catch {
      getDefaultLogger().warn(`Warning: Binary not found at ${sourceBinary}`)
      getDefaultLogger().warn('Binary should be copied manually or in CI')
    }

    getDefaultLogger().log(`\nPackage generated successfully at: ${packageDir}`)
    getDefaultLogger().log(
      `\nTo publish:\n  cd ${packageDir}\n  npm publish --provenance --access public`,
    )
  } catch (error) {
    getDefaultLogger().error('Error generating package:', error)
    process.exit(1)
  }
}

generatePackage()
