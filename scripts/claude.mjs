/**
 * @fileoverview Wrapper for Claude utilities that defers to canonical socket-registry version.
 * This wrapper ensures all Socket projects use the same Claude utilities.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const currentRepo = path.basename(path.join(__dirname, '..'))
const parentPath = path.join(__dirname, '..', '..')
const canonicalPath = path.join(parentPath, 'socket-registry', 'scripts', 'claude.mjs')
const repoPath = path.join(parentPath, 'socket-registry')

/**
 * Prompt user for Y/n confirmation
 * @param {string} question - The question to ask
 * @returns {Promise<boolean>} True if user confirms, false otherwise
 */
function promptConfirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise(resolve => {
    rl.question(`${question} (Y/n) `, answer => {
      rl.close()
      // Default to 'Y' if just Enter is pressed
      resolve(!answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

/**
 * Clone socket-registry repository
 */
async function cloneSocketRegistry() {
  console.log('\n📦 Cloning socket-registry repository...\n')

  try {
    execSync('git clone git@github.com:SocketDev/socket-registry.git', {
      cwd: parentPath,
      stdio: 'inherit'
    })
    console.log('\n✅ Successfully cloned socket-registry!\n')
    return true
  } catch (error) {
    console.error('\n❌ Failed to clone socket-registry:')
    console.error(error.message)
    console.error('\nYou can manually clone it with:')
    console.error(`  cd ${parentPath}`)
    console.error('  git clone git@github.com:SocketDev/socket-registry.git\n')
    return false
  }
}

// Main logic
async function main() {
  // If we're already in socket-registry, use the local version directly
  if (currentRepo === 'socket-registry') {
    const localPath = path.join(__dirname, 'claude.mjs')
    if (existsSync(localPath)) {
      await import(localPath)
    } else {
      console.error('Error: claude.mjs not found in socket-registry/scripts/')
      console.error('This is the canonical location for this script.')
      throw new Error('claude.mjs not found in canonical location')
    }
    return
  }

  // Check if socket-registry exists
  if (!existsSync(repoPath)) {
    console.log('╭─────────────────────────────────────────────────────────────╮')
    console.log('│  Socket Registry repository not found!                     │')
    console.log('├─────────────────────────────────────────────────────────────┤')
    console.log('│  The claude.mjs script requires socket-registry to be      │')
    console.log('│  cloned as a sibling directory.                            │')
    console.log('│                                                             │')
    console.log('│  Repository: git@github.com:SocketDev/socket-registry.git  │')
    console.log(`│  Location:   ${repoPath.padEnd(47)}│`)
    console.log('╰─────────────────────────────────────────────────────────────╯')
    console.log()

    const shouldClone = await promptConfirm('Would you like to clone socket-registry now?')

    if (shouldClone) {
      const success = await cloneSocketRegistry()
      if (!success) {
        throw new Error('Exiting due to error')
      }
    } else {
      console.log('\nPlease clone socket-registry manually:')
      console.log(`  cd ${parentPath}`)
      console.log('  git clone git@github.com:SocketDev/socket-registry.git\n')
      throw new Error('Exiting due to error')
    }
  }

  // Check if the canonical claude.mjs exists
  if (!existsSync(canonicalPath)) {
    console.log('╭─────────────────────────────────────────────────────────────╮')
    console.log('│  Canonical claude.mjs not found!                           │')
    console.log('├─────────────────────────────────────────────────────────────┤')
    console.log('│  The file should exist at:                                 │')
    console.log(`│  ${canonicalPath.length > 59 ? canonicalPath.substring(0, 56) + '...' : canonicalPath.padEnd(59)}│`)
    console.log('│                                                             │')
    console.log('│  This might be because socket-registry is out of date.     │')
    console.log('╰─────────────────────────────────────────────────────────────╯')
    console.log()

    const shouldUpdate = await promptConfirm('Would you like to update socket-registry?')

    if (shouldUpdate) {
      console.log('\n📦 Updating socket-registry...\n')
      try {
        execSync('git pull', {
          cwd: repoPath,
          stdio: 'inherit'
        })
        console.log('\n✅ Successfully updated socket-registry!\n')

        // Check again if the file exists after pulling
        if (!existsSync(canonicalPath)) {
          console.error('\n❌ claude.mjs still not found after update.')
          console.error('Please check the socket-registry repository manually.\n')
          throw new Error('Exiting due to error')
        }
      } catch (error) {
        console.error('\n❌ Failed to update socket-registry:')
        console.error(error.message)
        console.error(`\nPlease manually update:`)
        console.error(`  cd ${repoPath}`)
        console.error('  git pull\n')
        throw new Error('Exiting due to error')
      }
    } else {
      console.log('\nPlease update socket-registry manually:')
      console.log(`  cd ${repoPath}`)
      console.log('  git pull\n')
      throw new Error('Exiting due to error')
    }
  }

  // Import and run the canonical version
  try {
    // Use dynamic import with proper file:// URL for cross-platform compatibility
    const fileUrl = new URL(`file:///${canonicalPath.replace(/\\/g, '/')}`)
    await import(fileUrl.href)
  } catch (error) {
    console.error('Error loading canonical claude.mjs:', error.message)
    console.error(`Path: ${canonicalPath}`)
    throw new Error('Exiting due to error')
  }
}

// Run the main function
main().catch(error => {
  console.error('Unexpected error:', error)
  throw new Error('Exiting due to error')
})