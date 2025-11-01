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
  getDefaultLogger().log('')
  getDefaultLogger().log('='.repeat(60))
  getDefaultLogger().log(`${colors.blue('Socket Package Validation')}`)
  getDefaultLogger().log('='.repeat(60))
  getDefaultLogger().log('')

  const errors = []

  // Check package.json exists.
  getDefaultLogger().info('Checking package.json...')
  const pkgPath = path.join(packageRoot, 'package.json')
  if (!(await fileExists(pkgPath))) {
    errors.push('package.json does not exist')
  } else {
    getDefaultLogger().success('package.json exists')
  }

  // Check dist/bootstrap.js exists.
  getDefaultLogger().info('Checking dist/bootstrap.js...')
  const bootstrapPath = path.join(packageRoot, 'dist', 'bootstrap.js')
  if (!(await fileExists(bootstrapPath))) {
    errors.push('dist/bootstrap.js does not exist')
  } else {
    getDefaultLogger().success('dist/bootstrap.js exists')
  }

  // Print summary.
  getDefaultLogger().log('')
  getDefaultLogger().log('='.repeat(60))
  getDefaultLogger().log(`${colors.blue('Validation Summary')}`)
  getDefaultLogger().log('='.repeat(60))
  getDefaultLogger().log('')

  if (errors.length > 0) {
    getDefaultLogger().log(`${colors.red('Errors:')}`)
    getDefaultLogger().log('')
    for (const err of errors) {
      getDefaultLogger().fail(err)
    }
    getDefaultLogger().log('')
    getDefaultLogger().fail('Package validation FAILED')
    getDefaultLogger().log('')
    process.exit(1)
  }

  getDefaultLogger().success('Package validation PASSED')
  getDefaultLogger().log('')
  process.exit(0)
}

// Run validation.
validate().catch(e => {
  getDefaultLogger().error('')
  getDefaultLogger().fail(`Unexpected error: ${e.message}`)
  getDefaultLogger().error('')
  process.exit(1)
})
