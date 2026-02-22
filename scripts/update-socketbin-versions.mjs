/**
 * @fileoverview Update optionalDependencies in socket package.json with latest @socketbin/* versions from npm.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { spawn } from '@socketsecurity/lib/spawn'

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
    console.error(`Failed to get version for ${packageName}:`, error.message)
    return null
  }
}

async function main() {
  console.log('📦 Updating @socketbin/* versions in socket package.json...\n')

  // Read package.json.
  const pkg = JSON.parse(readFileSync(SOCKET_PKG_PATH, 'utf-8'))

  if (!pkg.optionalDependencies) {
    console.error('❌ No optionalDependencies found in socket package.json')
    process.exitCode = 1
    return
  }

  // Get all @socketbin/* packages.
  const socketbinPackages = Object.keys(pkg.optionalDependencies).filter(name =>
    name.startsWith('@socketbin/'),
  )

  if (!socketbinPackages.length) {
    console.error('❌ No @socketbin/* packages found in optionalDependencies')
    process.exitCode = 1
    return
  }

  console.log(
    `Found ${socketbinPackages.length} @socketbin/* packages to update:\n`,
  )

  // Update each package to latest version.
  const updates = []
  for (const packageName of socketbinPackages) {
    const currentVersion = pkg.optionalDependencies[packageName]
    const latestVersion = await getLatestVersion(packageName)

    if (!latestVersion) {
      console.error(`❌ Failed to get latest version for ${packageName}`)
      process.exitCode = 1
      return
    }

    updates.push({
      name: packageName,
      old: currentVersion,
      new: latestVersion,
    })

    pkg.optionalDependencies[packageName] = latestVersion
    console.log(`  ${packageName}: ${currentVersion} → ${latestVersion}`)
  }

  // Write updated package.json.
  writeFileSync(SOCKET_PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)

  console.log(`\n✓ Updated ${updates.length} package versions`)
  console.log(`✓ Wrote changes to ${SOCKET_PKG_PATH}`)
}

main().catch(error => {
  console.error('Error:', error)
  process.exitCode = 1
})
