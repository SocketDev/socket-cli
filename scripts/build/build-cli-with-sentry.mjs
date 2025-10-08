
/**
 * @fileoverview Build the @socketsecurity/cli-with-sentry package
 *
 * This builds the npm package with Sentry integration included.
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
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
const SENTRY_PACKAGE_DIR = join(PACKAGES_DIR, '@socketsecurity/cli-with-sentry')
const CONFIG_DIR = join(ROOT_DIR, '.config', 'packages')

/**
 * Build the @socketsecurity/cli-with-sentry package
 */
export async function buildCLIWithSentry(options = {}) {
  const { quiet = false, skipClean = false, verbose = false } = options

  if (!quiet) {
    console.log('📦 Building @socketsecurity/cli-with-sentry Package')
    console.log('====================================================\n')
  }

  // Ensure directories exist
  await mkdir(SENTRY_PACKAGE_DIR, { recursive: true })

  // Step 1: Build the source with Sentry enabled
  if (!quiet) {
    log.progress('Building source with Sentry integration')
  }

  // Build with Sentry flag
  const buildCommands = []

  if (!skipClean) {
    buildCommands.push({
      command: 'pnpm',
      args: ['run', 'clean', '--dist', '--quiet']
    })
  }

  const rollupArgs = [
    'exec', 'rollup',
    '-c', '.config/rollup.dist.config.mjs'
  ]

  // Set environment variable for Sentry build
  const env = { ...process.env, BUILD_WITH_SENTRY: '1' }

  if (!verbose) {
    rollupArgs.push('--silent')
  }

  buildCommands.push({
    command: 'pnpm',
    args: rollupArgs,
    env
  })

  const exitCode = await runSequence(buildCommands)

  if (exitCode !== 0) {
    if (!quiet) {
      log.failed('Failed to build source with Sentry')
    }
    return exitCode
  }

  // Step 2: Copy distribution files
  if (!quiet) {
    log.progress('Assembling package')
  }

  try {
    // Copy entire dist directory
    await runCommand('cp', ['-r', DIST_DIR, join(SENTRY_PACKAGE_DIR, 'dist')])

    // Copy package configuration
    const packageJsonPath = join(CONFIG_DIR, 'package.cli-with-sentry.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

    // Update package.json with current version from root
    const rootPackageJson = JSON.parse(await readFile(join(ROOT_DIR, 'package.json'), 'utf8'))
    packageJson.version = rootPackageJson.version

    await writeFile(
      join(SENTRY_PACKAGE_DIR, 'package.json'),
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
        await copyFile(src, join(SENTRY_PACKAGE_DIR, file))
      }
    }

    // Copy bin directory
    await runCommand('cp', ['-r', join(ROOT_DIR, 'bin'), join(SENTRY_PACKAGE_DIR, 'bin')])

    // Copy shadow-bin directory if exists
    const shadowBinPath = join(ROOT_DIR, 'shadow-bin')
    if (existsSync(shadowBinPath)) {
      await runCommand('cp', ['-r', shadowBinPath, join(SENTRY_PACKAGE_DIR, 'shadow-bin')])
    }

  } catch (error) {
    if (!quiet) {
      log.failed(`Failed to assemble package: ${error.message}`)
    }
    return 1
  }

  if (!quiet) {
    log.success('@socketsecurity/cli-with-sentry package built successfully')
    console.log(`   Output: ${SENTRY_PACKAGE_DIR}`)
    console.log()
    console.log('   To publish:')
    console.log(`   cd ${SENTRY_PACKAGE_DIR}`)
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

  printHeader('@socketsecurity/cli-with-sentry Build')

  buildCLIWithSentry(options)
    .then(exitCode => {
      printFooter(exitCode === 0)
      process.exit(exitCode)
    })
    .catch(error => {
      console.error('❌ Build failed:', error.message)
      process.exit(1)
    })
}

export default buildCLIWithSentry