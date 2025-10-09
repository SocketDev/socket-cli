#!/usr/bin/env node

/**
 * @fileoverview Check for newer yao-pkg Node versions available
 *
 * This script checks if there are newer Node.js versions available in yao-pkg
 * that Socket needs to update its socket-node patches for.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '..')

/**
 * Load socket-node version from config
 */
const socketNodeConfig = JSON.parse(
  readFileSync(join(ROOT_DIR, '.config', 'socket-node.json'), 'utf8')
)
const SOCKET_NODE_VERSION = socketNodeConfig.version

/**
 * Fetch and check yao-pkg Node versions
 */
async function checkYaoPkgVersions() {
  console.log('🔍 Checking yao-pkg Node versions...')
  console.log(`📦 Current socket-node version: v${SOCKET_NODE_VERSION}`)
  console.log()

  try {
    const response = await fetch('https://api.github.com/repos/yao-pkg/pkg-fetch/contents/patches')
    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`)
    }

    const data = await response.json()

    // Extract Node versions from patch filenames
    const versions = data
      .filter(file => file.name && file.name.startsWith('node.v'))
      .map(file => {
        const match = file.name.match(/node\.v(\d+\.\d+\.\d+)/)
        return match ? match[1] : null
      })
      .filter(Boolean)
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number)
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number)
        if (aMajor !== bMajor) return bMajor - aMajor
        if (aMinor !== bMinor) return bMinor - aMinor
        return bPatch - aPatch
      })

    // Group versions by major
    const versionsByMajor = {}
    for (const version of versions) {
      const major = version.split('.')[0]
      if (!versionsByMajor[major]) {
        versionsByMajor[major] = []
      }
      versionsByMajor[major].push(version)
    }

    // Find latest for each major version
    const latestByMajor = {}
    for (const major of Object.keys(versionsByMajor).sort((a, b) => Number(b) - Number(a))) {
      latestByMajor[major] = versionsByMajor[major][0]
    }

    // Check if there's a newer version than what we're using
    const currentParts = SOCKET_NODE_VERSION.split('.').map(Number)
    const currentMajor = currentParts[0]

    const newerVersions = versions.filter(v => {
      const parts = v.split('.').map(Number)
      // Only check same major version for patch updates
      if (parts[0] !== currentMajor) return false
      if (parts[1] > currentParts[1]) return true
      if (parts[1] === currentParts[1] && parts[2] > currentParts[2]) return true
      return false
    })

    // Display results
    console.log('📊 Available yao-pkg Node versions by major:')
    console.log('─'.repeat(50))

    for (const [major, latest] of Object.entries(latestByMajor)) {
      const allVersions = versionsByMajor[major]
      const isCurrentMajor = major === String(currentMajor)
      const marker = isCurrentMajor ? ' ← Current major' : ''

      console.log(`Node ${major}.x: v${latest}${marker}`)
      if (allVersions.length > 1) {
        console.log(`  All ${major}.x versions: ${allVersions.slice(0, 5).map(v => `v${v}`).join(', ')}${allVersions.length > 5 ? ` (+ ${allVersions.length - 5} more)` : ''}`)
      }
    }

    console.log()

    if (newerVersions.length > 0) {
      console.log(colors.magenta('═'.repeat(70)))
      console.log(colors.magenta('║') + ' 🎉 🕺 ' + colors.bold(colors.cyan(`NEW VERSIONS AVAILABLE FOR NODE ${currentMajor}!`)) + ' 👯 🎉')
      console.log(colors.magenta('═'.repeat(70)))
      console.log(colors.magenta('║') + ' Current socket-node: ' + colors.dim(`v${SOCKET_NODE_VERSION}`))
      console.log(colors.magenta('║') + ' ' + colors.bold(colors.green(`Newer versions: ${newerVersions.map(v => `v${v}`).join(', ')}`)))
      console.log(colors.magenta('║'))
      console.log(colors.magenta('║') + ' 📝 ' + colors.bold('ACTION REQUIRED:'))
      console.log(colors.magenta('║') + ' 1. Review the changes in Node.js ' + colors.cyan(`v${newerVersions[0]}`))
      console.log(colors.magenta('║') + ' 2. Update socket-node patches for the new version')
      console.log(colors.magenta('║') + ' 3. Test thoroughly with the new version')
      console.log(colors.magenta('║') + ' 4. Update version in ' + colors.cyan('.config/socket-node.json'))
      console.log(colors.magenta('║'))
      console.log(colors.magenta('║') + ' 📚 Node.js changelog:')
      console.log(colors.magenta('║') + ' ' + colors.blue(`https://github.com/nodejs/node/releases/tag/v${newerVersions[0]}`))
      console.log(colors.magenta('═'.repeat(70)))

      process.exitCode = 1 // Exit with error to signal updates available
    } else {
      console.log('✅ You are using the latest Node ' + currentMajor + ' version available in yao-pkg!')
      console.log()
      console.log('💡 Tips:')
      console.log('  - Run this script regularly to check for updates')
      console.log('  - Consider upgrading to a newer major version if available')
      console.log('  - Always test thoroughly after updating Node versions')
    }

  } catch (error) {
    console.error('❌ Failed to check versions:', error.message)
    console.error()
    console.error('Troubleshooting:')
    console.error('  - Check your internet connection')
    console.error('  - Verify GitHub API is accessible')
    console.error('  - Try again in a few minutes')
    process.exitCode = 1
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkYaoPkgVersions()
}

export default checkYaoPkgVersions