/**
 * @fileoverview Monorepo helper utilities for running commands across packages.
 * Provides package detection, file-to-package mapping, and pretty UI for multi-package operations.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { logger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import colors from 'yoctocolors-cjs'

/**
 * Get all packages in the monorepo with specific scripts.
 * @param {string} scriptName - Script name to check for
 * @returns {{name: string, path: string, displayName: string}[]}
 */
export function getPackagesWithScript(scriptName) {
  const packages = []
  const packagesDir = path.join(process.cwd(), 'packages')

  // Main CLI package always has all scripts.
  const cliPackagePath = path.join(packagesDir, 'cli', 'package.json')
  if (existsSync(cliPackagePath)) {
    const pkgJson = JSON.parse(readFileSync(cliPackagePath, 'utf8'))
    if (pkgJson.scripts?.[scriptName]) {
      packages.push({
        displayName: 'cli',
        name: pkgJson.name,
        path: path.join(packagesDir, 'cli'),
      })
    }
  }

  // Check other packages that might have the script.
  const otherPackages = [
    'cli-with-sentry',
    'socket',
    'sbom-generator',
    'node-sea-builder',
    'node-smol-builder',
  ]

  for (const pkgDir of otherPackages) {
    const pkgPath = path.join(packagesDir, pkgDir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkgJson.scripts?.[scriptName]) {
        packages.push({
          displayName: pkgDir,
          name: pkgJson.name,
          path: path.join(packagesDir, pkgDir),
        })
      }
    }
  }

  return packages
}

/**
 * Determine which packages are affected by changed files.
 * @param {string[]} changedFiles - Array of relative file paths
 * @returns {{name: string, path: string, displayName: string}[]} Affected packages
 */
export function getAffectedPackages(changedFiles) {
  const affectedPkgs = new Set()
  const packages = getPackagesWithScript('lint')

  for (const file of changedFiles) {
    // Root level files affect all packages.
    if (
      !file.startsWith('packages/') &&
      (file.includes('pnpm-lock.yaml') ||
        file.includes('tsconfig') ||
        file.includes('biome.json') ||
        file.includes('eslint.config'))
    ) {
      return packages
    }

    // Map packages/* files to specific packages.
    if (file.startsWith('packages/')) {
      const parts = file.split('/')
      if (parts.length > 1) {
        const pkgDir = parts[1]
        const pkg = packages.find(p => p.displayName === pkgDir)
        if (pkg) {
          affectedPkgs.add(pkg)
        }
      }
    }

    // Scripts changes affect all packages.
    if (file.startsWith('scripts/')) {
      return packages
    }
  }

  return Array.from(affectedPkgs)
}

/**
 * Run a script on a specific package with pretty output.
 * @param {object} pkg - Package info
 * @param {string} scriptName - Script to run
 * @param {string[]} args - Additional arguments
 * @param {boolean} quiet - Suppress output
 * @returns {Promise<number>} Exit code
 */
export async function runPackageScript(pkg, scriptName, args = [], quiet = false) {
  const displayName = pkg.displayName || pkg.name

  if (!quiet) {
    logger.progress(`${displayName}: running ${scriptName}`)
  }

  const result = await spawn(
    'pnpm',
    ['--filter', pkg.name, 'run', scriptName, ...args],
    {
      cwd: process.cwd(),
      shell: WIN32,
      stdio: 'pipe',
      stdioString: true,
    },
  )

  if (result.code !== 0) {
    if (!quiet) {
      logger.clearLine()
      logger.log(`${colors.red('✗')} ${displayName}`)
    }
    if (result.stdout) {
      logger.log(result.stdout)
    }
    if (result.stderr) {
      logger.error(result.stderr)
    }
    return result.code
  }

  if (!quiet) {
    logger.clearLine()
    logger.log(`${colors.green('✓')} ${displayName}`)
  }

  return 0
}

/**
 * Run a script across multiple packages.
 * @param {Array} packages - Packages to run on
 * @param {string} scriptName - Script to run
 * @param {string[]} args - Additional arguments
 * @param {boolean} quiet - Suppress output
 * @returns {Promise<number>} Exit code (0 if all succeed, first failure code otherwise)
 */
export async function runAcrossPackages(packages, scriptName, args = [], quiet = false) {
  if (!packages.length) {
    if (!quiet) {
      logger.substep('No packages to process')
    }
    return 0
  }

  for (const pkg of packages) {
    const exitCode = await runPackageScript(pkg, scriptName, args, quiet)
    if (exitCode !== 0) {
      return exitCode
    }
  }

  return 0
}
