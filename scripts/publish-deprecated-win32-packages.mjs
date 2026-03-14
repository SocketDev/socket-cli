#!/usr/bin/env node
/**
 * Publish deprecated @socketbin/cli-win32-* packages that redirect to cli-win-*.
 *
 * This is a one-time script to publish placeholder packages for the old win32 naming.
 * These packages depend on the new win-* packages for backwards compatibility.
 *
 * Usage:
 *   node scripts/publish-deprecated-win32-packages.mjs --version=2.2.0 [--dry-run]
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const DEPRECATED_PACKAGES = [
  { oldPlatform: 'win32', newPlatform: 'win', arch: 'arm64', os: 'win32', cpu: 'arm64' },
  { oldPlatform: 'win32', newPlatform: 'win', arch: 'x64', os: 'win32', cpu: 'x64' },
]

const TEMPLATE_DIR = new URL(
  '../packages/package-builder/templates/socketbin-deprecated',
  import.meta.url,
).pathname

const BUILD_DIR = new URL(
  '../packages/package-builder/build/deprecated',
  import.meta.url,
).pathname

async function processTemplate(templatePath, context) {
  let content = await fs.readFile(templatePath, 'utf-8')
  for (const [key, value] of Object.entries(context)) {
    content = content.replaceAll(`{{${key}}}`, value)
  }
  return content
}

async function generatePackage(config, version) {
  const { oldPlatform, newPlatform, arch, os, cpu } = config
  const packageName = `socketbin-cli-${oldPlatform}-${arch}`
  const packageDir = path.join(BUILD_DIR, packageName)

  const context = {
    OLD_PLATFORM: oldPlatform,
    NEW_PLATFORM: newPlatform,
    ARCH: arch,
    OS: os,
    CPU: cpu,
  }

  await fs.mkdir(packageDir, { recursive: true })

  // Generate package.json.
  let packageJson = await processTemplate(
    path.join(TEMPLATE_DIR, 'package.json.template'),
    context,
  )
  // Set version.
  packageJson = packageJson.replace(
    '"version": "0.0.0-replaced-by-publish"',
    `"version": "${version}"`,
  )
  await fs.writeFile(path.join(packageDir, 'package.json'), packageJson)

  // Generate README.md.
  const readme = await processTemplate(
    path.join(TEMPLATE_DIR, 'README.md.template'),
    context,
  )
  await fs.writeFile(path.join(packageDir, 'README.md'), readme)

  return { packageDir, packageName }
}

async function publishPackage(packageDir, dryRun) {
  if (dryRun) {
    logger.log(`  [DRY RUN] Would publish from ${packageDir}`)
    return true
  }

  const result = await spawn(
    'npm',
    ['publish', '--provenance', '--access', 'public', '--tag', 'deprecated'],
    { cwd: packageDir, stdio: 'pipe' },
  )

  return result.code === 0
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      version: { type: 'string' },
    },
  })

  const { 'dry-run': dryRun, version } = values

  if (!version) {
    logger.error('Usage: publish-deprecated-win32-packages.mjs --version=X.Y.Z [--dry-run]')
    process.exitCode = 1
    return
  }

  logger.log('')
  logger.log('Publishing deprecated @socketbin/cli-win32-* packages')
  logger.log('='.repeat(50))
  if (dryRun) {
    logger.log('[DRY RUN MODE]')
  }
  logger.log('')

  // Verify template exists.
  if (!existsSync(TEMPLATE_DIR)) {
    logger.error(`Template directory not found: ${TEMPLATE_DIR}`)
    process.exitCode = 1
    return
  }

  // Clean build dir.
  await fs.rm(BUILD_DIR, { recursive: true, force: true })

  const results = { passed: [], failed: [] }

  for (const config of DEPRECATED_PACKAGES) {
    const { packageDir, packageName } = await generatePackage(config, version)
    logger.log(`Generated ${packageName}`)

    const success = await publishPackage(packageDir, dryRun)
    if (success) {
      results.passed.push(packageName)
      logger.log(`  Published @socketbin/cli-${config.oldPlatform}-${config.arch}`)
    } else {
      results.failed.push(packageName)
      logger.error(`  Failed to publish @socketbin/cli-${config.oldPlatform}-${config.arch}`)
    }
  }

  logger.log('')
  logger.log('Summary')
  logger.log('='.repeat(50))
  logger.log(`Published: ${results.passed.length}/${DEPRECATED_PACKAGES.length}`)
  if (results.failed.length > 0) {
    logger.error(`Failed: ${results.failed.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error('Failed:', e.message)
  process.exitCode = 1
})
