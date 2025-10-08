
/**
 * @fileoverview Build the @socketsecurity/cli package
 *
 * This builds the published npm package @socketsecurity/cli
 * without Sentry integration.
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getRootPath, log, printFooter, printHeader } from '../utils/common.mjs'
import { runCommand, runSequence } from '../utils/run-command.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '../..')
const DIST_DIR = join(ROOT_DIR, 'dist')
const BUILD_DIR = join(ROOT_DIR, 'build')
const PACKAGES_DIR = join(BUILD_DIR, 'packages')
const CLI_PACKAGE_DIR = join(PACKAGES_DIR, '@socketsecurity/cli')
const CONFIG_DIR = join(ROOT_DIR, '.config', 'packages')

/**
 * Build the @socketsecurity/cli package
 */
export async function buildSocketSecurityCLI(options = {}) {
  const { quiet = false, skipClean = false, verbose = false } = options

  if (!quiet) {
    console.log('📦 Building @socketsecurity/cli Package')
    console.log('========================================\n')
  }

  // Ensure directories exist
  await mkdir(CLI_PACKAGE_DIR, { recursive: true })

  // Step 1: Build the source if needed
  if (!existsSync(join(DIST_DIR, 'cli.js'))) {
    if (!quiet) {
      log.progress('Building source first...')
    }

    const { default: buildSocket } = await import('./build-socket-package.mjs')
    const buildResult = await buildSocket({ quiet: true, skipClean })

    if (buildResult !== 0) {
      if (!quiet) {
        log.failed('Failed to build source')
      }
      return buildResult
    }
  }

  // Step 2: Copy distribution files
  if (!quiet) {
    log.progress('Copying distribution files')
  }

  try {
    // Copy entire dist directory
    await runCommand('cp', ['-r', DIST_DIR, join(CLI_PACKAGE_DIR, 'dist')])

    // Copy package configuration
    const packageJsonPath = join(CONFIG_DIR, 'package.cli.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

    // Update package.json with current version from root
    const rootPackageJson = JSON.parse(await readFile(join(ROOT_DIR, 'package.json'), 'utf8'))
    packageJson.version = rootPackageJson.version

    await writeFile(
      join(CLI_PACKAGE_DIR, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    // Copy necessary files
    const filesToCopy = [
      'README.md',
      'LICENSE',
      'requirements.json',
      'translations.json'
    ]

    for (const file of filesToCopy) {
      const src = join(ROOT_DIR, file)
      if (existsSync(src)) {
        await copyFile(src, join(CLI_PACKAGE_DIR, file))
      }
    }

    // Copy bin directory
    await runCommand('cp', ['-r', join(ROOT_DIR, 'bin'), join(CLI_PACKAGE_DIR, 'bin')])

    // Copy shadow-bin directory if exists
    const shadowBinPath = join(ROOT_DIR, 'shadow-bin')
    if (existsSync(shadowBinPath)) {
      await runCommand('cp', ['-r', shadowBinPath, join(CLI_PACKAGE_DIR, 'shadow-bin')])
    }

  } catch (error) {
    if (!quiet) {
      log.failed(`Failed to copy files: ${error.message}`)
    }
    return 1
  }

  if (!quiet) {
    log.success('@socketsecurity/cli package built successfully')
    console.log(`   Output: ${CLI_PACKAGE_DIR}`)
    console.log()
    console.log('   To publish:')
    console.log(`   cd ${CLI_PACKAGE_DIR}`)
    console.log('   npm publish --access=public')
  }

  return 0
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const options = {
    quiet: args.includes('--quiet'),
    skipClean: args.includes('--skip-clean'),
    verbose: args.includes('--verbose')
  }

  printHeader('@socketsecurity/cli Build')

  buildSocketSecurityCLI(options)
    .then(exitCode => {
      printFooter(exitCode === 0)
      process.exit(exitCode)
    })
    .catch(error => {
      console.error('❌ Build failed:', error.message)
      process.exit(1)
    })
}

export default buildSocketSecurityCLI