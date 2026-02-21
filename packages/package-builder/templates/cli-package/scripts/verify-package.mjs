import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, '..')
const logger = getDefaultLogger()

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
  logger.log(`${colors.blue('CLI Package Validation')}`)
  logger.log('='.repeat(60))
  logger.log('')

  const errors = []

  // Check package.json exists.
  logger.info('Checking package.json...')
  const pkgPath = path.join(packageRoot, 'package.json')
  if (!(await fileExists(pkgPath))) {
    errors.push('package.json does not exist')
  } else {
    logger.success('package.json exists')

    // Validate package.json configuration.
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))

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
      logger.success('package.json files array is correct')
    }
  }

  // Check root files exist (LICENSE, CHANGELOG.md).
  const rootFiles = ['LICENSE', 'CHANGELOG.md']
  for (const file of rootFiles) {
    logger.info(`Checking ${file}...`)
    const filePath = path.join(packageRoot, file)
    if (!(await fileExists(filePath))) {
      errors.push(`${file} does not exist`)
    } else {
      logger.success(`${file} exists`)
    }
  }

  // Check dist files exist.
  const distFiles = ['index.js', 'cli.js']
  for (const file of distFiles) {
    logger.info(`Checking dist/${file}...`)
    const filePath = path.join(packageRoot, 'dist', file)
    if (!(await fileExists(filePath))) {
      errors.push(`dist/${file} does not exist`)
    } else {
      logger.success(`dist/${file} exists`)
    }
  }

  // Check build/cli.js exists.
  logger.info('Checking build/cli.js...')
  const buildPath = path.join(packageRoot, 'build', 'cli.js')
  if (!(await fileExists(buildPath))) {
    errors.push('build/cli.js does not exist')
  } else {
    logger.success('build/cli.js exists')
  }

  // Check data directory exists.
  logger.info('Checking data directory...')
  const dataPath = path.join(packageRoot, 'data')
  if (!(await fileExists(dataPath))) {
    errors.push('data directory does not exist')
  } else {
    logger.success('data directory exists')

    // Check data files.
    const dataFiles = [
      'alert-translations.json',
      'command-api-requirements.json',
    ]
    for (const file of dataFiles) {
      logger.info(`Checking data/${file}...`)
      const filePath = path.join(dataPath, file)
      if (!(await fileExists(filePath))) {
        errors.push(`data/${file} does not exist`)
      } else {
        logger.success(`data/${file} exists`)
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
      logger.fail(`  ${err}`)
    }
    logger.log('')
    logger.fail('Package validation FAILED')
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.success('Package validation PASSED')
  logger.log('')
}

// Run validation.
validate().catch(e => {
  logger.error('')
  logger.fail(`Unexpected error: ${e.message}`)
  logger.error('')
  process.exitCode = 1
})
