#!/usr/bin/env node
/**
 * Setup monorepo structure for Socket CLI.
 *
 * Creates:
 * - pnpm-workspace.yaml
 * - packages/ directory with all platform packages
 * - Minimal package.json and README.md for each platform
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const packagesDir = path.join(rootDir, 'packages')

// Platform definitions.
const platforms = [
  {
    arch: 'arm64',
    binary: 'socket',
    description: 'macOS ARM64 (Apple Silicon)',
    libc: 'system',
    name: '@socketbin/cli-darwin-arm64',
    os: 'darwin',
  },
  {
    arch: 'x64',
    binary: 'socket',
    description: 'macOS x64 (Intel)',
    libc: 'system',
    name: '@socketbin/cli-darwin-x64',
    os: 'darwin',
  },
  {
    arch: 'arm64',
    binary: 'socket',
    description: 'Linux ARM64',
    libc: 'glibc',
    name: '@socketbin/cli-linux-arm64',
    os: 'linux',
  },
  {
    arch: 'x64',
    binary: 'socket',
    description: 'Linux x64',
    libc: 'glibc',
    name: '@socketbin/cli-linux-x64',
    os: 'linux',
  },
  {
    arch: 'arm64',
    binary: 'socket',
    description: 'Alpine Linux ARM64 (musl)',
    libc: 'musl',
    name: '@socketbin/cli-alpine-arm64',
    os: 'linux',
  },
  {
    arch: 'x64',
    binary: 'socket',
    description: 'Alpine Linux x64 (musl)',
    libc: 'musl',
    name: '@socketbin/cli-alpine-x64',
    os: 'linux',
  },
  {
    arch: 'arm64',
    binary: 'socket.exe',
    description: 'Windows ARM64',
    libc: 'MSVC',
    name: '@socketbin/cli-win32-arm64',
    os: 'win32',
  },
  {
    arch: 'x64',
    binary: 'socket.exe',
    description: 'Windows x64',
    libc: 'MSVC',
    name: '@socketbin/cli-win32-x64',
    os: 'win32',
  },
]

/**
 * Generate package.json for a platform.
 */
function generatePackageJson(platform) {
  return JSON.stringify(
    {
      bin: {
        socket: `./bin/${platform.binary}`,
      },
      cpu: [platform.arch],
      description: `Socket CLI native binary for ${platform.description}`,
      files: [`bin/${platform.binary}`],
      license: 'MIT',
      name: platform.name,
      os: [platform.os],
      publishConfig: {
        access: 'public',
      },
      version: '1.0.0',
    },
    null,
    2,
  )
}

/**
 * Generate README.md for a platform.
 */
function generateReadme(platform) {
  return `# ${platform.name}

Native Socket CLI binary for **${platform.description}**.
`
}

/**
 * Generate pnpm-workspace.yaml.
 */
function generateWorkspaceConfig() {
  return `packages:
  - 'packages/*'
`
}

/**
 * Create directory structure for a platform package.
 */
async function createPlatformPackage(platform) {
  const packageName = platform.name.replace('@socketbin/cli-', '')
  const packageDir = path.join(packagesDir, `socketbin-cli-${packageName}`)
  const binDir = path.join(packageDir, 'bin')

  logger.log(`Creating ${platform.name}...`)

  // Create directories.
  await fs.mkdir(binDir, { recursive: true })

  // Write package.json.
  const packageJsonPath = path.join(packageDir, 'package.json')
  await fs.writeFile(packageJsonPath, generatePackageJson(platform) + '\n')

  // Write README.md.
  const readmePath = path.join(packageDir, 'README.md')
  await fs.writeFile(readmePath, generateReadme(platform))

  // Create placeholder for binary.
  const binaryPath = path.join(binDir, platform.binary)
  await fs.writeFile(binaryPath, '#!/usr/bin/env node\n// Placeholder\n')
  await fs.chmod(binaryPath, 0o755)

  logger.log(`  ✓ ${packageDir}`)
}

/**
 * Main entry point.
 */
async function main() {
  logger.log('Setting up Socket CLI monorepo...\n')

  // Create packages directory.
  if (!existsSync(packagesDir)) {
    logger.log('Creating packages/ directory...')
    await fs.mkdir(packagesDir, { recursive: true })
    logger.log('  ✓ packages/\n')
  }

  // Create pnpm-workspace.yaml.
  const workspaceConfigPath = path.join(rootDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspaceConfigPath)) {
    logger.log('Creating pnpm-workspace.yaml...')
    await fs.writeFile(workspaceConfigPath, generateWorkspaceConfig())
    logger.log('  ✓ pnpm-workspace.yaml\n')
  }

  // Create all platform packages.
  logger.log('Creating platform packages...\n')
  for (const platform of platforms) {
    await createPlatformPackage(platform)
  }

  logger.log('\n✓ Monorepo setup complete!\n')
  logger.log('Next steps:')
  logger.log('  1. Move current code to packages/cli/')
  logger.log('  2. Create packages/socket/ for thin wrapper')
  logger.log('  3. Create packages/socketbin-custom-node-from-source/')
  logger.log('  4. Create packages/socketbin-native-node-sea/')
  logger.log('  5. Run: pnpm install\n')
}

main().catch(error => {
  logger.error('Error setting up monorepo:', error)
  process.exit(1)
})
