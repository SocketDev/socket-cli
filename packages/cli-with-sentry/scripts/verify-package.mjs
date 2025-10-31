import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, '..')

/**
 * Format a success message.
 */
function success(msg) {
  return `${colors.green('✓')} ${msg}`
}

/**
 * Format an error message.
 */
function error(msg) {
  return `${colors.red('✗')} ${msg}`
}

/**
 * Format an info message.
 */
function info(msg) {
  return `${colors.blue('ℹ')} ${msg}`
}

/**
 * Check if a file exists and is readable.
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Main validation function.
 */
async function validate() {
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('CLI with Sentry Package Validation')}`)
  logger.log('='.repeat(60))
  logger.log('')

  const errors = []

  // Check package.json exists and validate Sentry configuration.
  logger.log(info('Checking package.json...'))
  const pkgPath = path.join(packageRoot, 'package.json')
  if (!(await fileExists(pkgPath))) {
    errors.push('package.json does not exist')
  } else {
    logger.log(success('package.json exists'))

    // Validate package.json configuration.
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

    // Check @sentry/node is in dependencies.
    if (!pkg.dependencies?.['@sentry/node']) {
      errors.push('package.json missing @sentry/node in dependencies')
    } else {
      logger.log(success('@sentry/node is in dependencies'))
    }

    // Validate files array.
    const requiredInFiles = [
      'CHANGELOG.md',
      'LICENSE',
      'data/**',
      'dist/**',
      'logo-dark.png',
      'logo-light.png',
    ]
    for (const required of requiredInFiles) {
      if (!pkg.files?.includes(required)) {
        errors.push(`package.json files array missing: ${required}`)
      }
    }
    if (errors.length === 0) {
      logger.log(success('package.json files array is correct'))
    }
  }

  // Check root files exist (LICENSE, CHANGELOG.md).
  const rootFiles = ['LICENSE', 'CHANGELOG.md']
  for (const file of rootFiles) {
    logger.log(info(`Checking ${file}...`))
    const filePath = path.join(packageRoot, file)
    if (!(await fileExists(filePath))) {
      errors.push(`${file} does not exist`)
    } else {
      logger.log(success(`${file} exists`))
    }
  }

  // Check dist files exist and validate Sentry integration.
  const distFiles = ['index.js', 'cli.js.bz', 'shadow-npm-inject.js']
  for (const file of distFiles) {
    logger.log(info(`Checking dist/${file}...`))
    const filePath = path.join(packageRoot, 'dist', file)
    if (!(await fileExists(filePath))) {
      errors.push(`dist/${file} does not exist`)
    } else {
      logger.log(success(`dist/${file} exists`))
    }
  }

  // Verify Sentry is referenced in the build (check for @sentry/node require).
  logger.log(info('Checking for Sentry integration in build...'))
  const buildPath = path.join(packageRoot, 'build', 'cli.js')
  if (await fileExists(buildPath)) {
    const buildContent = await fs.readFile(buildPath, 'utf-8')
    if (!buildContent.includes('@sentry/node')) {
      errors.push('Sentry integration not found in build/cli.js')
    } else {
      logger.log(success('Sentry integration found in build'))
    }
  } else {
    errors.push('build/cli.js does not exist (required for Sentry validation)')
  }

  // Check data directory exists.
  logger.log(info('Checking data directory...'))
  const dataPath = path.join(packageRoot, 'data')
  if (!(await fileExists(dataPath))) {
    errors.push('data directory does not exist')
  } else {
    logger.log(success('data directory exists'))

    // Check data files.
    const dataFiles = [
      'alert-translations.json',
      'command-api-requirements.json',
    ]
    for (const file of dataFiles) {
      logger.log(info(`Checking data/${file}...`))
      const filePath = path.join(dataPath, file)
      if (!(await fileExists(filePath))) {
        errors.push(`data/${file} does not exist`)
      } else {
        logger.log(success(`data/${file} exists`))
      }
    }
  }

  // Print summary.
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('Validation Summary')}`)
  logger.log('='.repeat(60))
  logger.log('')

  if (errors.length > 0) {
    logger.log(`${colors.red('Errors:')}`)
    for (const err of errors) {
      logger.log(`  ${error(err)}`)
    }
    logger.log('')
    logger.log(error('Package validation FAILED'))
    logger.log('')
    process.exit(1)
  }

  logger.log(success('Package validation PASSED'))
  logger.log('')
  process.exit(0)
}

// Run validation.
validate().catch(e => {
  logger.error('')
  logger.error(error(`Unexpected error: ${e.message}`))
  logger.error('')
  process.exit(1)
})
