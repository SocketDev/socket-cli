/**
 * Publish placeholder packages for @socketaddon/iocraft platform binaries.
 *
 * This reserves the namespace on npm before the real packages are ready.
 * Pattern follows @socketbin/cli-* placeholder packages.
 *
 * Usage:
 *   # Publish all packages
 *   node scripts/publish-socketaddon-placeholders.mts
 *   node scripts/publish-socketaddon-placeholders.mts --dry-run
 *
 *   # Publish specific packages
 *   node scripts/publish-socketaddon-placeholders.mts --main
 *   node scripts/publish-socketaddon-placeholders.mts --darwin-arm64
 *   node scripts/publish-socketaddon-placeholders.mts --linux-x64-musl
 *   node scripts/publish-socketaddon-placeholders.mts --win-x64
 *
 *   # Publish multiple specific packages
 *   node scripts/publish-socketaddon-placeholders.mts --main --darwin-arm64 --linux-x64
 *
 *   # List available packages
 *   node scripts/publish-socketaddon-placeholders.mts --list
 */

import { spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { PLATFORM_CONFIGS } from 'build-infra/lib/platform-targets'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const isDryRun = process.argv.includes('--dry-run')
const showList = process.argv.includes('--list')

/**
 * Get list of requested platforms from command line args.
 */
function getRequestedPlatforms() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--dry-run'))

  // If --list flag, return empty array (handled separately)
  if (showList) {
    return []
  }

  // If no platform flags, publish all
  const platformFlags = args.filter((arg) => arg.startsWith('--'))
  if (!platformFlags.length) {
    return 'all'
  }

  const requested = []

  // Check for --main flag
  if (args.includes('--main')) {
    requested.push('main')
  }

  // Check for platform-specific flags
  for (const config of PLATFORM_CONFIGS) {
    const { arch, libc, releasePlatform } = config
    const muslSuffix = libc === 'musl' ? '-musl' : ''
    const platformId = `${releasePlatform}-${arch}${muslSuffix}`

    if (args.includes(`--${platformId}`)) {
      requested.push(platformId)
    }
  }

  return requested
}

/**
 * Platform-specific description suffixes.
 */
const PLATFORM_DESCRIPTIONS = {
  __proto__: null,
  'darwin-arm64': 'macOS Apple Silicon (M1, M2, M3)',
  'darwin-x64': 'macOS Intel',
  'linux-arm64': 'Linux ARM64 (glibc)',
  'linux-arm64-musl': 'Linux ARM64 (musl/Alpine)',
  'linux-x64': 'Linux x64 (glibc)',
  'linux-x64-musl': 'Linux x64 (musl/Alpine)',
  'win-arm64': 'Windows ARM64',
  'win-x64': 'Windows x64',
}

/**
 * OS mapping for package.json os field.
 */
const OS_MAP = {
  __proto__: null,
  darwin: 'darwin',
  linux: 'linux',
  win: 'win32',
}

/**
 * Generate README content for a placeholder package.
 */
function generateReadme(packageName, platformDesc) {
  return `# ${packageName}

**PLACEHOLDER PACKAGE**

This is a placeholder package to reserve the namespace for iocraft Node.js bindings.

The real package with native bindings will be published soon.

## What is this?

This package will contain native iocraft bindings for ${platformDesc}.

iocraft is a Rust-based TUI library that provides fast, beautiful terminal interfaces with React-like declarative syntax.

## Installation

Once the real package is available, it will be installed automatically as an optional dependency of:

\`\`\`bash
npm install @socketaddon/iocraft
\`\`\`

## More Information

- Repository: https://github.com/SocketDev/socket-cli
- Issues: https://github.com/SocketDev/socket-cli/issues
- Socket: https://socket.dev

---

*Placeholder package v0.0.0 - Real native bindings coming soon*
`
}

/**
 * Generate package.json for a placeholder package.
 */
function generatePackageJson(packageName, platformDesc, os, cpu) {
  return {
    name: packageName,
    version: '0.0.0',
    description: `Placeholder for iocraft native bindings (${platformDesc}). Real package coming soon.`,
    license: 'MIT',
    author: 'Socket Inc <eng@socket.dev> (https://socket.dev)',
    homepage: 'https://github.com/SocketDev/socket-cli',
    repository: {
      type: 'git',
      url: 'git+https://github.com/SocketDev/socket-cli.git',
    },
    bugs: {
      url: 'https://github.com/SocketDev/socket-cli/issues',
    },
    keywords: [
      'socket',
      'iocraft',
      'tui',
      'terminal',
      'native',
      'bindings',
      'placeholder',
      os,
      cpu,
    ].filter(Boolean),
    os: [os],
    cpu: [cpu],
    files: ['README.md'],
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    },
  }
}

/**
 * Create a placeholder package in a temporary directory.
 */
async function createPlaceholderPackage(config) {
  const { arch, cpu, libc, os, releasePlatform } = config
  const muslSuffix = libc === 'musl' ? '-musl' : ''
  const platformId = `${releasePlatform}-${arch}${muslSuffix}`
  const packageName = `@socketaddon/iocraft-${platformId}`
  const platformDesc = PLATFORM_DESCRIPTIONS[platformId]

  if (!platformDesc) {
    logger.warn(`No description for platform: ${platformId}`)
    return null
  }

  const osField = OS_MAP[releasePlatform] || releasePlatform
  const cpuField = cpu

  const tmpDir = path.join(
    process.cwd(),
    'build',
    'tmp-placeholders',
    `iocraft-${platformId}`,
  )

  await fs.mkdir(tmpDir, { recursive: true })

  const packageJson = generatePackageJson(
    packageName,
    platformDesc,
    osField,
    cpuField,
  )
  const readme = generateReadme(packageName, platformDesc)

  await fs.writeFile(
    path.join(tmpDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf-8',
  )
  await fs.writeFile(path.join(tmpDir, 'README.md'), readme, 'utf-8')

  return { packageName, platformId, tmpDir }
}

/**
 * Publish a placeholder package to npm.
 */
function publishPackage(tmpDir, packageName) {
  const args = ['publish', '--access', 'public']

  if (isDryRun) {
    args.push('--dry-run')
  }

  const result = spawnSync('npm', args, {
    cwd: tmpDir,
    encoding: 'utf-8',
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `npm publish failed with exit code ${result.status} for ${packageName}`,
    )
  }

  return result.status === 0
}

/**
 * Create the main wrapper placeholder package.
 */
async function createMainPlaceholderPackage() {
  const packageName = '@socketaddon/iocraft'
  const tmpDir = path.join(
    process.cwd(),
    'build',
    'tmp-placeholders',
    'iocraft-main',
  )

  await fs.mkdir(tmpDir, { recursive: true })

  const packageJson = {
    name: packageName,
    version: '0.0.0',
    description:
      'Placeholder for iocraft Node.js bindings (main wrapper). Real package coming soon.',
    license: 'MIT',
    type: 'module',
    author: 'Socket Inc <eng@socket.dev> (https://socket.dev)',
    homepage: 'https://github.com/SocketDev/socket-cli',
    repository: {
      type: 'git',
      url: 'git+https://github.com/SocketDev/socket-cli.git',
    },
    bugs: {
      url: 'https://github.com/SocketDev/socket-cli/issues',
    },
    keywords: [
      'socket',
      'iocraft',
      'tui',
      'terminal',
      'native',
      'bindings',
      'rust',
      'placeholder',
    ],
    files: ['README.md'],
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    },
  }

  const readme = `# @socketaddon/iocraft

**PLACEHOLDER PACKAGE**

This is a placeholder package to reserve the namespace for iocraft Node.js bindings.

The real package with platform detection and native bindings will be published soon.

## What is this?

This package will be the main wrapper for iocraft - a Rust-based TUI library that provides fast, beautiful terminal interfaces with React-like declarative syntax.

The main package will automatically load the correct platform-specific binary for your system.

## Installation

Once the real package is available, install with:

\`\`\`bash
npm install @socketaddon/iocraft
\`\`\`

## Supported Platforms

- macOS (Intel and Apple Silicon)
- Linux (x64 and ARM64, glibc and musl)
- Windows (x64 and ARM64)

## More Information

- Repository: https://github.com/SocketDev/socket-cli
- Issues: https://github.com/SocketDev/socket-cli/issues
- Socket: https://socket.dev

---

*Placeholder package v0.0.0 - Real package coming soon*
`

  await fs.writeFile(
    path.join(tmpDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf-8',
  )
  await fs.writeFile(path.join(tmpDir, 'README.md'), readme, 'utf-8')

  return { packageName, tmpDir }
}

/**
 * List all available packages.
 */
function listAvailablePackages() {
  logger.log('')
  logger.log('Available packages:')
  logger.log('='.repeat(60))
  logger.log('')
  logger.log('Main package:')
  logger.log('  --main                      @socketaddon/iocraft')
  logger.log('')
  logger.log('Platform-specific packages:')

  for (const config of PLATFORM_CONFIGS) {
    const { arch, libc, releasePlatform } = config
    const muslSuffix = libc === 'musl' ? '-musl' : ''
    const platformId = `${releasePlatform}-${arch}${muslSuffix}`
    const packageName = `@socketaddon/iocraft-${platformId}`
    const platformDesc = PLATFORM_DESCRIPTIONS[platformId]

    logger.log(`  --${platformId.padEnd(24)} ${packageName}`)
    if (platformDesc) {
      logger.log(`  ${' '.repeat(28)} (${platformDesc})`)
    }
  }

  logger.log('')
  logger.log('Examples:')
  logger.log('  node scripts/publish-socketaddon-placeholders.mts --main')
  logger.log('  node scripts/publish-socketaddon-placeholders.mts --darwin-arm64 --dry-run')
  logger.log('  node scripts/publish-socketaddon-placeholders.mts --main --linux-x64 --linux-x64-musl')
  logger.log('  node scripts/publish-socketaddon-placeholders.mts  # publish all')
  logger.log('')
}

/**
 * Main execution.
 */
async function main() {
  // Handle --list flag
  if (showList) {
    listAvailablePackages()
    return
  }

  const requestedPlatforms = getRequestedPlatforms()
  const publishAll = requestedPlatforms === 'all'

  logger.log('')
  logger.log(
    isDryRun
      ? 'Dry-run: Publishing socketaddon placeholder packages...'
      : 'Publishing socketaddon placeholder packages...',
  )
  logger.log('='.repeat(60))

  if (!publishAll) {
    logger.log(`Selected packages: ${requestedPlatforms.join(', ')}`)
  }

  logger.log('')

  const results = {
    created: [],
    failed: [],
    skipped: [],
  }

  // Publish main wrapper package.
  const shouldPublishMain = publishAll || requestedPlatforms.includes('main')

  if (shouldPublishMain) {
    try {
      const mainPkg = await createMainPlaceholderPackage()
      const { packageName, tmpDir } = mainPkg

      logger.log(`Publishing ${packageName}...`)

      if (!isDryRun) {
        const success = publishPackage(tmpDir, packageName)

        if (success) {
          logger.info(`✓ Published ${packageName}`)
          results.created.push(packageName)
        } else {
          logger.error(`✗ Failed to publish ${packageName}`)
          results.failed.push(packageName)
        }
      } else {
        logger.info(`[DRY RUN] Would publish ${packageName}`)
        results.created.push(packageName)
      }
    } catch (e) {
      logger.error('Error creating main package:', e)
      results.failed.push(`@socketaddon/iocraft (main): ${e.message}`)
    }
  } else {
    results.skipped.push('@socketaddon/iocraft (main)')
  }

  // Publish platform-specific packages.
  for (const config of PLATFORM_CONFIGS) {
    const { arch, libc, releasePlatform } = config
    const muslSuffix = libc === 'musl' ? '-musl' : ''
    const platformId = `${releasePlatform}-${arch}${muslSuffix}`

    const shouldPublish = publishAll || requestedPlatforms.includes(platformId)

    if (!shouldPublish) {
      const packageName = `@socketaddon/iocraft-${platformId}`
      results.skipped.push(packageName)
      continue
    }

    try {
      const pkgInfo = await createPlaceholderPackage(config)

      if (!pkgInfo) {
        continue
      }

      const { packageName, tmpDir } = pkgInfo

      logger.log(`Publishing ${packageName}...`)

      if (!isDryRun) {
        const success = publishPackage(tmpDir, packageName)

        if (success) {
          logger.info(`✓ Published ${packageName}`)
          results.created.push(packageName)
        } else {
          logger.error(`✗ Failed to publish ${packageName}`)
          results.failed.push(packageName)
        }
      } else {
        logger.info(`[DRY RUN] Would publish ${packageName}`)
        results.created.push(packageName)
      }
    } catch (e) {
      logger.error(`Error processing platform ${platformId}:`, e)
      results.failed.push(`${platformId}: ${e.message}`)
    }
  }

  logger.log('')
  logger.log('='.repeat(60))
  logger.log('Summary:')
  logger.log(`  Created: ${results.created.length}`)
  logger.log(`  Failed: ${results.failed.length}`)
  if (!publishAll) {
    logger.log(`  Skipped: ${results.skipped.length}`)
  }

  if (results.created.length) {
    logger.log('')
    logger.log('Created packages:')
    for (const pkg of results.created) {
      logger.log(`  - ${pkg}`)
    }
  }

  if (!publishAll && results.skipped.length) {
    logger.log('')
    logger.log('Skipped packages:')
    for (const pkg of results.skipped) {
      logger.log(`  - ${pkg}`)
    }
  }

  if (results.failed.length) {
    logger.log('')
    logger.error('Failed:')
    for (const pkg of results.failed) {
      logger.error(`  - ${pkg}`)
    }
    process.exitCode = 1
  }

  logger.log('')
}

main().catch((e) => {
  logger.error('Fatal error:', e)
  process.exitCode = 1
})
