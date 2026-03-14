#!/usr/bin/env node
/**
 * Publish placeholder @socketbin/cli-win-* packages for trusted publishing setup.
 *
 * This is a one-time script to publish initial placeholder packages for the new
 * win-* naming convention. After this, the provenance workflow can use trusted
 * publishing.
 *
 * Usage:
 *   node scripts/publish-win-placeholder-packages.mjs [--dry-run]
 *
 * After running this, deprecate the old win32 packages:
 *   npm deprecate "@socketbin/cli-win32-x64@*" "Use @socketbin/cli-win-x64 instead"
 *   npm deprecate "@socketbin/cli-win32-arm64@*" "Use @socketbin/cli-win-arm64 instead"
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUILD_DIR = path.join(__dirname, '../packages/package-builder/build/win-placeholder')

const WIN_PACKAGES = [
  { platform: 'win', arch: 'arm64', os: 'win32', cpu: 'arm64', description: 'Windows ARM64' },
  { platform: 'win', arch: 'x64', os: 'win32', cpu: 'x64', description: 'Windows x64' },
]

// Use a placeholder version that will be replaced by the first real publish.
const PLACEHOLDER_VERSION = '0.0.0'

async function generatePackage(config) {
  const { platform, arch, os, cpu, description } = config
  const packageName = `@socketbin/cli-${platform}-${arch}`
  const packageDir = path.join(BUILD_DIR, `socketbin-cli-${platform}-${arch}`)

  await fs.mkdir(packageDir, { recursive: true })

  const packageJson = {
    name: packageName,
    version: PLACEHOLDER_VERSION,
    description: `Socket CLI binary (${description}) - Placeholder for trusted publishing setup`,
    license: 'MIT',
    os: [os],
    cpu: [cpu],
    repository: {
      type: 'git',
      url: 'git+https://github.com/SocketDev/socket-cli.git',
    },
    publishConfig: {
      access: 'public',
    },
  }

  await fs.writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n',
  )

  const readme = `# ${packageName}

Socket CLI binary for ${description}.

This is a placeholder package for trusted publishing setup.
The first real version will be published via GitHub Actions with provenance.

## Usage

This package is an optional dependency of the \`socket\` package.
You don't need to install it directly.

\`\`\`bash
npm install socket
\`\`\`
`

  await fs.writeFile(path.join(packageDir, 'README.md'), readme)

  return { packageDir, packageName }
}

async function publishPackage(packageDir, packageName, dryRun) {
  if (dryRun) {
    logger.log(`  [DRY RUN] Would publish ${packageName} from ${packageDir}`)
    return true
  }

  const result = await spawn(
    'npm',
    ['publish', '--access', 'public'],
    { cwd: packageDir, stdio: 'pipe' },
  )

  if (result.code !== 0) {
    logger.error(`  stdout: ${result.stdout}`)
    logger.error(`  stderr: ${result.stderr}`)
  }

  return result.code === 0
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
    },
  })

  const dryRun = values['dry-run']

  logger.log('')
  logger.log('Publishing placeholder @socketbin/cli-win-* packages')
  logger.log('='.repeat(55))
  if (dryRun) {
    logger.log('[DRY RUN MODE]')
  }
  logger.log('')

  // Clean build dir.
  await fs.rm(BUILD_DIR, { recursive: true, force: true })
  await fs.mkdir(BUILD_DIR, { recursive: true })

  const results = { passed: [], failed: [] }

  for (const config of WIN_PACKAGES) {
    const { packageDir, packageName } = await generatePackage(config)
    logger.log(`Generated ${packageName}`)

    const success = await publishPackage(packageDir, packageName, dryRun)
    if (success) {
      results.passed.push(packageName)
      logger.log(`  Published ${packageName}@${PLACEHOLDER_VERSION}`)
    } else {
      results.failed.push(packageName)
      logger.error(`  Failed to publish ${packageName}`)
    }
  }

  logger.log('')
  logger.log('Summary')
  logger.log('='.repeat(55))
  logger.log(`Published: ${results.passed.length}/${WIN_PACKAGES.length}`)

  if (results.passed.length > 0) {
    logger.log('')
    logger.log('Next steps:')
    logger.log('1. Set up trusted publishing in npm for these packages')
    logger.log('2. Deprecate old win32 packages:')
    logger.log('   npm deprecate "@socketbin/cli-win32-x64@*" "Use @socketbin/cli-win-x64 instead"')
    logger.log('   npm deprecate "@socketbin/cli-win32-arm64@*" "Use @socketbin/cli-win-arm64 instead"')
  }

  if (results.failed.length > 0) {
    logger.error(`Failed: ${results.failed.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error('Failed:', e.message)
  process.exitCode = 1
})
