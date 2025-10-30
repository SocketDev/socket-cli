import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

/**
 * Check version consistency across multiple package.json files.
 */
async function checkVersionConsistency() {
  const expectedVersion = process.argv[2]

  if (!expectedVersion) {
    logger.error(`${colors.red('✗')} Error: Version argument is required`)
    logger.error('Usage: node scripts/check-version-consistency.mjs <version>')
    process.exit(1)
  }

  // Remove 'v' prefix if present.
  const cleanVersion = expectedVersion.replace(/^v/, '')

  logger.log(`🔍 Checking version consistency for v${cleanVersion}...`)
  logger.log('')

  const errors = []
  const warnings = []
  const checked = []

  // Check main package.json (only if version looks like a socketbin version).
  const mainPkgPath = path.join(projectRoot, 'package.json')
  try {
    const mainPkg = JSON.parse(await fs.readFile(mainPkgPath, 'utf8'))

    // Only check root package.json if the expected version looks like a socketbin version
    // (contains timestamp like YYYYMMDD.HHmmss) or if root package version matches.
    const isSocketbinVersion = /\d{8}\.\d{6}/.test(cleanVersion)
    const shouldCheckRoot = isSocketbinVersion ? mainPkg.version === cleanVersion : true

    if (shouldCheckRoot) {
      checked.push({
        file: 'package.json',
        version: mainPkg.version,
        matches: mainPkg.version === cleanVersion,
      })

      if (mainPkg.version !== cleanVersion && !isSocketbinVersion) {
        errors.push(
          `package.json version (${mainPkg.version}) does not match expected version (${cleanVersion})`,
        )
      }
    }
  } catch (e) {
    errors.push(`Failed to read package.json: ${e.message}`)
  }

  // Check SEA npm package if it exists.
  const seaPkgPath = path.join(projectRoot, 'src/sea/npm-package/package.json')
  try {
    await fs.access(seaPkgPath)
    const seaPkg = JSON.parse(await fs.readFile(seaPkgPath, 'utf8'))
    checked.push({
      file: 'src/sea/npm-package/package.json',
      version: seaPkg.version,
      matches: seaPkg.version === cleanVersion,
    })

    if (seaPkg.version !== cleanVersion) {
      warnings.push(
        `src/sea/npm-package/package.json version (${seaPkg.version}) does not match expected version (${cleanVersion})`,
      )
      warnings.push(
        '  Note: This is expected if the SEA package version is managed separately',
      )
    }
  } catch {
    // File doesn't exist or can't be read - this is OK.
  }

  // Skip @socketbin/cli-ai package - it's not published by socketbin workflows.
  // It has its own versioning separate from the platform-specific socketbin packages.

  // Print results.
  logger.log('Checked versions:')
  for (const check of checked) {
    const icon = check.matches ? '✓' : '✗'
    const color = check.matches ? '\x1b[32m' : '\x1b[31m'
    const reset = '\x1b[0m'
    logger.log(`  ${color}${icon}${reset} ${check.file}: ${check.version}`)
  }
  logger.log('')

  // Print warnings.
  if (warnings.length > 0) {
    logger.log(`${colors.yellow('⚠')}  Warnings:`)
    for (const warning of warnings) {
      logger.log(`  ${warning}`)
    }
    logger.log('')
  }

  // Print errors and exit.
  if (errors.length > 0) {
    logger.log(`${colors.red('✗')} Errors:`)
    for (const error of errors) {
      logger.log(`  ${error}`)
    }
    logger.log('')
    logger.log('Version consistency check failed!')
    process.exit(1)
  }

  logger.log(`${colors.green('✓')} Version consistency check passed!`)
  process.exit(0)
}

checkVersionConsistency().catch(e => {
  logger.error(`${colors.red('✗')} Unexpected error:`, e)
  process.exit(1)
})
