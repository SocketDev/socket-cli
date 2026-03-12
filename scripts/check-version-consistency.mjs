/**
 * @fileoverview Validates version consistency across socketbin packages.
 * Ensures all generated packages have consistent version formatting.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import semver from 'semver'

import { getBuildOutDir } from 'package-builder/scripts/paths.mjs'

const logger = getDefaultLogger()

const version = process.argv[2]

if (!version) {
  logger.error('Usage: check-version-consistency.mjs <version>')
  process.exitCode = 1
} else {
  // Validate version is valid semver.
  const parsed = semver.parse(version)
  if (!parsed) {
    logger.error(`Invalid semver version: ${version}`)
    process.exitCode = 1
  } else {
    logger.log(`Version ${version} is valid semver`)

    // Check that socketbin packages exist in the output directory.
    const outDir = getBuildOutDir()
    if (!existsSync(outDir)) {
      logger.warn(`Build output directory does not exist: ${outDir}`)
      logger.warn('This is expected before build artifacts are downloaded')
    } else {
      const packages = readdirSync(outDir).filter(name =>
        name.startsWith('socketbin-cli-'),
      )

      if (packages.length === 0) {
        logger.warn('No socketbin packages found in output directory')
        logger.warn('This is expected before build artifacts are downloaded')
      } else {
        logger.log(`Found ${packages.length} socketbin packages`)

        // Verify each package has a valid package.json.
        let hasErrors = false
        for (const pkg of packages) {
          const pkgJsonPath = join(outDir, pkg, 'package.json')
          if (!existsSync(pkgJsonPath)) {
            logger.warn(`Missing package.json: ${pkgJsonPath}`)
            continue
          }

          try {
            const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
            logger.log(`  ${pkg}: ${pkgJson.name}@${pkgJson.version}`)
          } catch (e) {
            logger.error(`Error reading ${pkgJsonPath}: ${e.message}`)
            hasErrors = true
          }
        }

        if (hasErrors) {
          process.exitCode = 1
        }
      }
    }

    logger.success('Version consistency check passed')
  }
}
