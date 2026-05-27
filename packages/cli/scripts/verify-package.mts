import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

const logger = getDefaultLogger()

export async function validate() {
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('CLI Package Validation')}`)
  logger.log('='.repeat(60))
  logger.log('')

  const errors = []

  // Check package.json exists and has correct files array.
  logger.info('Checking package.json...')
  const pkgPath = path.join(packageRoot, 'package.json')
  if (!existsSync(pkgPath)) {
    errors.push('package.json does not exist')
  } else {
    logger.success('package.json exists')

    // Validate files array.
    let pkg
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
    } catch (e) {
      errors.push(`Failed to parse package.json: ${e.message}`)
      return errors
    }
    const requiredInFiles = [
      'CHANGELOG.md',
      'LICENSE',
      'data/**',
      'dist/**',
      'logo-dark.png',
      'logo-light.png',
    ]
    for (let i = 0, { length } = requiredInFiles; i < length; i += 1) {
      const required = requiredInFiles[i]
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
  for (let i = 0, { length } = rootFiles; i < length; i += 1) {
    const file = rootFiles[i]
    logger.info(`Checking ${file}...`)
    const filePath = path.join(packageRoot, file)
    if (!existsSync(filePath)) {
      errors.push(`${file} does not exist`)
    } else {
      logger.success(`${file} exists`)
    }
  }

  // Check dist files exist.
  const distFiles = ['index.js', 'cli.js']
  for (let i = 0, { length } = distFiles; i < length; i += 1) {
    const file = distFiles[i]
    logger.info(`Checking dist/${file}...`)
    const filePath = path.join(packageRoot, 'dist', file)
    if (!existsSync(filePath)) {
      errors.push(`dist/${file} does not exist`)
    } else {
      logger.success(`dist/${file} exists`)
    }
  }

  // Check data directory exists.
  logger.info('Checking data directory...')
  const dataPath = path.join(packageRoot, 'data')
  if (!existsSync(dataPath)) {
    errors.push('data directory does not exist')
  } else {
    logger.success('data directory exists')

    // Check data files.
    const dataFiles = [
      'alert-translations.json',
      'command-api-requirements.json',
    ]
    for (let i = 0, { length } = dataFiles; i < length; i += 1) {
      const file = dataFiles[i]
      logger.info(`Checking data/${file}...`)
      const filePath = path.join(dataPath, file)
      if (!existsSync(filePath)) {
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
    for (let i = 0, { length } = errors; i < length; i += 1) {
      const err = errors[i]
      logger.log(`  ${err}`)
    }
    logger.log('')
    logger.fail('Package validation FAILED')
    logger.log('')
    throw new Error('Package validation failed')
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
