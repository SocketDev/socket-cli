
/**
 * @fileoverview Version consistency checker for Socket CLI release process.
 *
 * Ensures all @socketbin packages and the main socket package have the same version.
 * This is CRITICAL for the release process to work correctly.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')

/**
 * Platform configurations for @socketbin packages.
 */
const PLATFORMS = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'win32', arch: 'arm64' },
  { platform: 'win32', arch: 'x64' },
]

/**
 * Read and parse a package.json file.
 */
async function readPackageJson(packagePath) {
  try {
    const content = await fs.readFile(packagePath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Check version consistency across all packages.
 */
async function checkVersionConsistency(targetVersion = null) {
  const errors = []
  const warnings = []
  const versions = new Map()

  console.log('🔍 Checking version consistency...\n')

  // Check main package.json version.
  const mainPackagePath = path.join(ROOT_DIR, 'package.json')
  const mainPackage = await readPackageJson(mainPackagePath)
  const mainVersion = mainPackage.version

  console.log(`📦 Main package version: ${colors.cyan(mainVersion)}`)
  versions.set('socket (main)', mainVersion)

  // If target version specified, check it matches.
  if (targetVersion && targetVersion !== mainVersion) {
    errors.push(
      `Main package version (${mainVersion}) does not match target version (${targetVersion})`
    )
  }

  // Check socket npm package (the published one).
  const npmPackagePath = path.join(ROOT_DIR, 'src', 'sea', 'npm-package', 'package.json')
  if (existsSync(npmPackagePath)) {
    const npmPackage = await readPackageJson(npmPackagePath)
    if (npmPackage) {
      const npmVersion = npmPackage.version
      console.log(`📦 Socket npm package version: ${colors.cyan(npmVersion)}`)
      versions.set('socket (npm)', npmVersion)

      if (npmVersion !== mainVersion) {
        errors.push(
          `Socket npm package version (${npmVersion}) does not match main version (${mainVersion})`
        )
      }

      // Check optionalDependencies versions.
      if (npmPackage.optionalDependencies) {
        console.log('\n📦 Checking optionalDependencies versions:')
        for (const [dep, version] of Object.entries(npmPackage.optionalDependencies)) {
          if (dep.startsWith('@socketbin/')) {
            console.log(`  ${dep}: ${colors.cyan(version)}`)
            versions.set(dep, version)

            if (version !== mainVersion && version !== targetVersion) {
              warnings.push(
                `${dep} version in optionalDependencies (${version}) does not match expected version`
              )
            }
          }
        }
      }
    }
  } else {
    warnings.push('Socket npm package not found at src/sea/npm-package/package.json')
  }

  // Check @socketbin binary packages.
  console.log('\n📦 Checking @socketbin package versions:')
  const platformChecks = await Promise.all(
    PLATFORMS.map(async ({ arch, platform }) => {
      const packageName = `@socketbin/cli-${platform}-${arch}`
      const packagePath = path.join(
        ROOT_DIR,
        'packages',
        'binaries',
        `cli-${platform}-${arch}`,
        'package.json'
      )

      if (existsSync(packagePath)) {
        const pkg = await readPackageJson(packagePath)
        if (pkg) {
          const pkgVersion = pkg.version
          return {
            packageName,
            pkgVersion,
            exists: true,
            error: pkgVersion !== mainVersion
              ? `${packageName} version (${pkgVersion}) does not match main version (${mainVersion})`
              : null
          }
        }
      }
      return {
        packageName,
        exists: false
      }
    })
  )

  // Process results in order.
  for (const result of platformChecks) {
    if (result.exists) {
      console.log(`  ${result.packageName}: ${colors.cyan(result.pkgVersion)}`)
      versions.set(result.packageName, result.pkgVersion)
      if (result.error) {
        errors.push(result.error)
      }
    } else {
      // Package doesn't exist yet (expected before first publish).
      console.log(`  ${result.packageName}: ${colors.gray('(not created yet)')}`)
    }
  }

  // Check for version mismatches.
  const uniqueVersions = new Set(versions.values())
  if (uniqueVersions.size > 1 && versions.size > 2) {
    console.log(`\n⚠️  Multiple versions detected: ${Array.from(uniqueVersions).join(', ')}`)
  }

  // Print results.
  console.log()
  if (errors.length > 0) {
    console.log(colors.red('❌ Version consistency check failed!\n'))
    errors.forEach(error => console.log(`  ${colors.red('✗')} ${error}`))

    console.log('\n' + colors.yellow('To fix version mismatches:'))
    console.log('  1. Update version in main package.json')
    console.log('  2. Run: npm version <version> --no-git-tag-version in src/sea/npm-package')
    console.log('  3. Ensure all @socketbin packages are regenerated with correct version')
    return false
  }

  if (warnings.length > 0) {
    console.log(colors.yellow('⚠️  Warnings:\n'))
    warnings.forEach(warning => console.log(`  ${colors.yellow('⚠')} ${warning}`))
  }

  console.log(colors.green('✅ All package versions are consistent!'))
  return true
}

/**
 * Main entry point.
 */
async function main() {
  // Check if a target version was provided.
  const targetVersion = process.argv[2]

  if (targetVersion) {
    console.log(`Target version: ${colors.cyan(targetVersion)}\n`)
  }

  const isConsistent = await checkVersionConsistency(targetVersion)
  process.exitCode = isConsistent ? 0 : 1
}

// Run if executed directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(colors.red('Error:'), error.message)
    process.exitCode = 1
  })
}

export { checkVersionConsistency }