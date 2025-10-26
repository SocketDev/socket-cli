import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

/**
 * Colors for terminal output.
 */
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
}

/**
 * Format a success message.
 */
function success(msg) {
  return `${colors.green}✓${colors.reset} ${msg}`
}

/**
 * Format an error message.
 */
function error(msg) {
  return `${colors.red}✗${colors.reset} ${msg}`
}

/**
 * Format a warning message.
 */
function warning(msg) {
  return `${colors.yellow}⚠${colors.reset} ${msg}`
}

/**
 * Format an info message.
 */
function info(msg) {
  return `${colors.blue}ℹ${colors.reset} ${msg}`
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
 * Check if a file is executable.
 */
async function isExecutable(filePath) {
  try {
    const stats = await fs.stat(filePath)
    // On Unix, check if owner has execute permission.
    if (process.platform !== 'win32') {
      return !!(stats.mode & 0o100)
    }
    // On Windows, all files are considered executable if they exist.
    return true
  } catch {
    return false
  }
}

/**
 * Validate package.json fields.
 */
async function validatePackageJson() {
  logger.log(info('Validating package.json...'))

  const errors = []
  const warnings = []

  const pkgPath = path.join(projectRoot, 'dist', 'package.json')
  if (!(await fileExists(pkgPath))) {
    errors.push('dist/package.json does not exist')
    return { errors, warnings }
  }

  const pkgContent = await fs.readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(pkgContent)

  // Required fields.
  const requiredFields = ['name', 'version', 'description', 'license', 'bin']
  for (const field of requiredFields) {
    if (!pkg[field]) {
      errors.push(`package.json missing required field: ${field}`)
    }
  }

  // Validate package name.
  const validNames = [
    'socket',
    '@socketsecurity/cli',
    '@socketsecurity/cli-with-sentry',
  ]
  if (pkg.name && !validNames.includes(pkg.name)) {
    warnings.push(`Unexpected package name: ${pkg.name}`)
  }

  // Validate version format (semver).
  if (pkg.version && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.version)) {
    errors.push(`Invalid version format: ${pkg.version}`)
  }

  // Validate bin entries exist.
  if (pkg.bin && typeof pkg.bin === 'object') {
    for (const [_name, binPath] of Object.entries(pkg.bin)) {
      const fullPath = path.join(projectRoot, 'dist', binPath)
      if (!(await fileExists(fullPath))) {
        errors.push(`Binary file does not exist: ${binPath}`)
      }
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    logger.log(success('Package.json validation passed'))
  }

  return { errors, warnings }
}

/**
 * Validate dist directory structure.
 */
async function validateDistStructure() {
  logger.log(info('Validating dist directory structure...'))

  const errors = []
  const warnings = []

  // Check dist directory exists.
  const distPath = path.join(projectRoot, 'dist')
  if (!(await fileExists(distPath))) {
    errors.push('dist directory does not exist')
    return { errors, warnings }
  }

  // Required files in dist.
  const requiredFiles = ['cli.js', 'package.json']
  for (const file of requiredFiles) {
    const filePath = path.join(distPath, file)
    if (!(await fileExists(filePath))) {
      errors.push(`Required file missing: dist/${file}`)
    }
  }

  // Check CLI file size (sanity check).
  const cliPath = path.join(distPath, 'cli.js')
  if (await fileExists(cliPath)) {
    const stats = await fs.stat(cliPath)
    const sizeMB = stats.size / 1_024 / 1_024

    if (sizeMB < 5) {
      warnings.push(`CLI bundle is suspiciously small: ${sizeMB.toFixed(2)} MB`)
    } else if (sizeMB > 20) {
      warnings.push(
        `CLI bundle is larger than expected: ${sizeMB.toFixed(2)} MB`,
      )
    } else {
      logger.log(info(`CLI bundle size: ${sizeMB.toFixed(2)} MB`))
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    logger.log(success('Dist directory structure validation passed'))
  } else if (errors.length === 0) {
    logger.log(
      success('Dist directory structure validation passed (with warnings)'),
    )
  }

  return { errors, warnings }
}

/**
 * Validate binary files.
 */
async function validateBinaries() {
  logger.log(info('Validating binary files...'))

  const errors = []
  const warnings = []

  const binPath = path.join(projectRoot, 'bin')
  if (!(await fileExists(binPath))) {
    errors.push('bin directory does not exist')
    return { errors, warnings }
  }

  // Expected binary files.
  const expectedBinaries = [
    'cli.js',
    'npm-cli.js',
    'npx-cli.js',
    'pnpm-cli.js',
    'yarn-cli.js',
  ]

  for (const binary of expectedBinaries) {
    const binaryPath = path.join(binPath, binary)

    // Check existence.
    if (!(await fileExists(binaryPath))) {
      errors.push(`Binary file missing: bin/${binary}`)
      continue
    }

    // Check executable permissions (Unix only).
    if (process.platform !== 'win32') {
      if (!(await isExecutable(binaryPath))) {
        errors.push(`Binary file is not executable: bin/${binary}`)
      }
    }

    // Check shebang.
    const content = await fs.readFile(binaryPath, 'utf8')
    if (!content.startsWith('#!')) {
      warnings.push(`Binary missing shebang: bin/${binary}`)
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    logger.log(success('Binary files validation passed'))
  } else if (errors.length === 0) {
    logger.log(success('Binary files validation passed (with warnings)'))
  }

  return { errors, warnings }
}

/**
 * Validate required data files.
 */
async function validateDataFiles() {
  logger.log(info('Validating data files...'))

  const errors = []
  const warnings = []

  const dataPath = path.join(projectRoot, 'data')
  if (!(await fileExists(dataPath))) {
    errors.push('data directory does not exist')
    return { errors, warnings }
  }

  // Expected data files.
  const expectedFiles = [
    'alert-translations.json',
    'command-api-requirements.json',
  ]

  for (const file of expectedFiles) {
    const filePath = path.join(dataPath, file)
    if (!(await fileExists(filePath))) {
      errors.push(`Data file missing: data/${file}`)
    }
  }

  if (errors.length === 0) {
    logger.log(success('Data files validation passed'))
  }

  return { errors, warnings }
}

/**
 * Check for uncommitted changes.
 */
async function checkGitStatus() {
  logger.log(info('Checking for uncommitted changes...'))

  const errors = []
  const warnings = []

  try {
    const result = await spawn('git', ['status', '--porcelain'], {
      cwd: projectRoot,
    })

    if (result.status !== 0) {
      warnings.push('Unable to check git status')
      return { errors, warnings }
    }

    const output = result.stdout.trim()
    if (output) {
      warnings.push('Repository has uncommitted changes')
      logger.log(warning('Uncommitted changes detected:'))
      logger.log(output)
    } else {
      logger.log(success('No uncommitted changes'))
    }
  } catch (e) {
    warnings.push(`Git check failed: ${e.message}`)
  }

  return { errors, warnings }
}

/**
 * Validate Git tag matches version.
 */
async function validateGitTag() {
  logger.log(info('Validating Git tag...'))

  const errors = []
  const warnings = []

  try {
    // Read version from root package.json.
    const rootPkgPath = path.join(projectRoot, 'package.json')
    const rootPkg = JSON.parse(await fs.readFile(rootPkgPath, 'utf8'))
    const version = rootPkg.version

    // Check if tag exists.
    const tagName = `v${version}`
    const result = await spawn('git', ['tag', '-l', tagName], {
      cwd: projectRoot,
    })

    if (result.status !== 0) {
      warnings.push('Unable to check git tags')
      return { errors, warnings }
    }

    const output = result.stdout.trim()
    if (output === tagName) {
      logger.log(success(`Git tag ${tagName} exists`))
    } else {
      warnings.push(
        `Git tag ${tagName} does not exist (create tag before publishing)`,
      )
    }
  } catch (e) {
    warnings.push(`Git tag check failed: ${e.message}`)
  }

  return { errors, warnings }
}

/**
 * Validate dependencies are installed.
 */
async function validateDependencies() {
  logger.log(info('Validating dependencies...'))

  const errors = []
  const warnings = []

  const nodeModulesPath = path.join(projectRoot, 'node_modules')
  if (!(await fileExists(nodeModulesPath))) {
    errors.push('node_modules directory does not exist')
    errors.push('Run: pnpm install')
    return { errors, warnings }
  }

  // Check if pnpm lockfile exists.
  const lockfilePath = path.join(projectRoot, 'pnpm-lock.yaml')
  if (!(await fileExists(lockfilePath))) {
    warnings.push('pnpm-lock.yaml does not exist')
  }

  if (errors.length === 0) {
    logger.log(success('Dependencies validation passed'))
  }

  return { errors, warnings }
}

/**
 * Validate no dev dependencies in production.
 */
async function validateProductionDependencies() {
  logger.log(info('Validating production dependencies...'))

  const errors = []
  const warnings = []

  const distPkgPath = path.join(projectRoot, 'dist', 'package.json')
  if (!(await fileExists(distPkgPath))) {
    warnings.push(
      'dist/package.json does not exist, skipping production dependencies check',
    )
    return { errors, warnings }
  }

  const distPkg = JSON.parse(await fs.readFile(distPkgPath, 'utf8'))

  // Check for devDependencies (should not exist in dist).
  if (
    distPkg.devDependencies &&
    Object.keys(distPkg.devDependencies).length > 0
  ) {
    errors.push('dist/package.json contains devDependencies')
  }

  if (errors.length === 0) {
    logger.log(success('Production dependencies validation passed'))
  }

  return { errors, warnings }
}

/**
 * Main validation function.
 */
async function validate() {
  logger.log('')
  logger.log('='.repeat(60))
  logger.log(`${colors.blue}Pre-Publish Validation${colors.reset}`)
  logger.log('='.repeat(60))
  logger.log('')

  const allErrors = []
  const allWarnings = []

  // Run all validation checks.
  const checks = [
    validateDependencies,
    validatePackageJson,
    validateDistStructure,
    validateBinaries,
    validateDataFiles,
    validateProductionDependencies,
    checkGitStatus,
    validateGitTag,
  ]

  for (const check of checks) {
    const { errors, warnings } = await check()
    allErrors.push(...errors)
    allWarnings.push(...warnings)
    logger.log('')
  }

  // Print summary.
  logger.log('='.repeat(60))
  logger.log(`${colors.blue}Validation Summary${colors.reset}`)
  logger.log('='.repeat(60))
  logger.log('')

  if (allWarnings.length > 0) {
    logger.log(`${colors.yellow}Warnings:${colors.reset}`)
    for (const warn of allWarnings) {
      logger.log(`  ${warning(warn)}`)
    }
    logger.log('')
  }

  if (allErrors.length > 0) {
    logger.log(`${colors.red}Errors:${colors.reset}`)
    for (const err of allErrors) {
      logger.log(`  ${error(err)}`)
    }
    logger.log('')
    logger.log(error('Pre-publish validation FAILED'))
    logger.log('')
    process.exit(1)
  }

  logger.log(success('Pre-publish validation PASSED'))
  if (allWarnings.length > 0) {
    logger.log(
      info(`${allWarnings.length} warning(s) - review before publishing`),
    )
  }
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
