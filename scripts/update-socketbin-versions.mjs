/**
 * @fileoverview Update optionalDependencies in socket package.json with latest @socketbin/* versions from npm.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const SOCKET_PKG_PATH = resolve('packages/socket/package.json')

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
  } catch (error) {
    logger.error(`Failed to get version for ${packageName}:`, error.message)
    return undefined
  }
}

async function main() {
  logger.log('📦 Updating @socketbin/* versions in socket package.json...\n')

  // Read package.json.
  const pkg = JSON.parse(readFileSync(SOCKET_PKG_PATH, 'utf-8'))

  if (!pkg.optionalDependencies) {
    logger.error('❌ No optionalDependencies found in socket package.json')
    process.exitCode = 1
    return
  }

  // Get all @socketbin/* packages.
  const socketbinPackages = Object.keys(pkg.optionalDependencies).filter(name =>
    name.startsWith('@socketbin/'),
  )

  if (!socketbinPackages.length) {
    logger.error('❌ No @socketbin/* packages found in optionalDependencies')
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
    // eslint-disable-next-line no-await-in-loop
    const latestVersion = await getLatestVersion(packageName)

    if (!latestVersion) {
      logger.error(`❌ Failed to get latest version for ${packageName}`)
      process.exitCode = 1
      return
    }

    updates.push({
      name: packageName,
      old: currentVersion,
      new: latestVersion,
    })

    pkg.optionalDependencies[packageName] = latestVersion
    logger.log(`  ${packageName}: ${currentVersion} → ${latestVersion}`)
  }

  // Write updated package.json.
  writeFileSync(SOCKET_PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)

  logger.success(`Updated ${updates.length} package versions`)
  logger.success(`Wrote changes to ${SOCKET_PKG_PATH}`)
}

main().catch(error => {
  logger.error('Error:', error)
  process.exitCode = 1
})
