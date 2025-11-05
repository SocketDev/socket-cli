import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, '..')

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
  const logger = getDefaultLogger()
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('Socket Package Validation')}`)
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
  }

  // Check dist/bootstrap.js exists.
  logger.info('Checking dist/bootstrap.js...')
  const bootstrapPath = path.join(packageRoot, 'dist', 'bootstrap.js')
  if (!(await fileExists(bootstrapPath))) {
    errors.push('dist/bootstrap.js does not exist')
  } else {
    logger.success('dist/bootstrap.js exists')
  }

  // Print summary.
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue('Validation Summary')}`)
  logger.log('='.repeat(60))
  logger.log('')

  if (errors.length > 0) {
    logger.log(`${colors.red('Errors:')}`)
    logger.log('')
    for (const err of errors) {
      logger.fail(err)
    }
    logger.log('')
    logger.fail('Package validation FAILED')
    logger.log('')
    process.exit(1)
  }

  logger.success('Package validation PASSED')
  logger.log('')
  process.exit(0)
}

// Run validation.
validate().catch(e => {
  logger.error('')
  logger.fail(`Unexpected error: ${e.message}`)
  logger.error('')
  process.exit(1)
})
