/**
 * Generate CLI package directories from templates.
 * Creates the standard CLI, CLI-with-Sentry, and socket packages.
 *
 * Usage:
 *   node scripts/generate-cli-packages.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  CLI_SENTRY_TEMPLATE_DIR,
  CLI_TEMPLATE_DIR,
  getPackageOutDir,
} from './paths.mjs'
import { copyDirectory } from './utils.mjs'

const logger = getDefaultLogger()

/**
 * Package configurations.
 */
const PACKAGES = [
  {
    name: '@socketsecurity/cli',
    outputDir: 'cli',
    templateDir: CLI_TEMPLATE_DIR,
  },
  {
    name: '@socketsecurity/cli-with-sentry',
    outputDir: 'cli-with-sentry',
    templateDir: CLI_SENTRY_TEMPLATE_DIR,
  },
  {
    // socket package is a copy of cli with different name.
    name: 'socket',
    outputDir: 'socket',
    templateDir: CLI_TEMPLATE_DIR,
  },
]

/**
 * Main generation logic.
 */
async function main() {
  logger.log('')
  logger.log('Generating CLI packages from templates...')
  logger.log('='.repeat(50))
  logger.log('')

  for (const pkg of PACKAGES) {
    const packagePath = getPackageOutDir(pkg.outputDir)

    // Copy entire template directory.
    await copyDirectory(pkg.templateDir, packagePath)

    // Update package.json name if different from template.
    const pkgJsonPath = join(packagePath, 'package.json')
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
    if (pkgJson.name !== pkg.name) {
      pkgJson.name = pkg.name
      writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, 2)}\n`)
    }

    logger.success(`Generated ${pkg.name} package`)
  }

  logger.log('')
}

main().catch(e => {
  logger.error('Package generation failed:', e)
  process.exitCode = 1
})
