#!/usr/bin/env node
/**
 * Update optionalDependencies in socket package.json with latest @socketbin/* versions from npm.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getPackageOutDir } from 'package-builder/scripts/paths.mjs'

const logger = getDefaultLogger()

async function getLatestVersion(packageName) {
  try {
    const result = await spawn('npm', ['view', packageName, 'version'], {
      stdioString: true,
      stripAnsi: true,
    })
    if (result.code !== 0) {
      throw new Error(result.stderr || 'npm view command failed')
    }
    return result.stdout.trim()
  } catch (e) {
    logger.error(`Failed to get version for ${packageName}:`, e.message)
    return undefined
  }
}

async function main() {
  logger.log('Updating @socketbin/* versions in socket package.json...\n')

  // Get socket package path from centralized paths.
  const socketPkgPath = join(getPackageOutDir('socket'), 'package.json')

  // Read package.json.
  const pkg = JSON.parse(readFileSync(socketPkgPath, 'utf-8'))

  if (!pkg.optionalDependencies) {
    logger.error('No optionalDependencies found in socket package.json')
    process.exitCode = 1
    return
  }

  // Get all @socketbin/* packages.
  const socketbinPackages = Object.keys(pkg.optionalDependencies).filter(name =>
    name.startsWith('@socketbin/'),
  )

  if (!socketbinPackages.length) {
    logger.error('No @socketbin/* packages found in optionalDependencies')
    process.exitCode = 1
    return
  }

  logger.log(
    `Found ${socketbinPackages.length} @socketbin/* packages to update:\n`,
  )

  // Update each package to latest version.
  const updates = []
  for (const packageName of socketbinPackages) {
    const currentVersion = pkg.optionalDependencies[packageName]
    const latestVersion = await getLatestVersion(packageName)

    if (!latestVersion) {
      logger.error(`Failed to get latest version for ${packageName}`)
      process.exitCode = 1
      return
    }

    updates.push({
      name: packageName,
      new: latestVersion,
      old: currentVersion,
    })

    pkg.optionalDependencies[packageName] = latestVersion
    logger.log(`  ${packageName}: ${currentVersion} -> ${latestVersion}`)
  }

  // Write updated package.json.
  writeFileSync(socketPkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

  logger.success(`Updated ${updates.length} package versions`)
  logger.success(`Wrote changes to ${socketPkgPath}`)
}

main().catch(e => {
  logger.error('Error:', e)
  process.exitCode = 1
})
