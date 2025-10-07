#!/usr/bin/env node

/**
 * Publishes all placeholder packages to npm.
 * Run after signing in with: npm login
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const packages = [
  'cli-darwin-arm64',
  'cli-darwin-x64',
  'cli-linux-arm64',
  'cli-linux-x64',
  'cli-win32-arm64',
  'cli-win32-x64'
]

async function publishPackage(name) {
  const packageDir = path.join(rootDir, 'packages', 'placeholders', name)

  console.log(`Publishing @socketbin/${name}...`)

  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['publish', '--access', 'public'], {
      cwd: packageDir,
      stdio: 'inherit'
    })

    child.on('exit', code => {
      if (code === 0) {
        console.log(`✓ Published @socketbin/${name}\n`)
        resolve()
      } else {
        reject(new Error(`Failed to publish ${name}`))
      }
    })
  })
}

async function main() {
  console.log('🚀 Publishing @socketbin placeholder packages...\n')
  console.log('Make sure you are logged in as socket-bot!\n')

  try {
    for (const pkg of packages) {
      await publishPackage(pkg)
    }

    console.log('\n✅ All placeholder packages published!')
    console.log('\nNext steps:')
    console.log('1. Go to https://www.npmjs.com/settings/socketbin/integrations')
    console.log('2. Add trusted publisher for SocketDev/socket-cli')
    console.log('3. Reference workflow: .github/workflows/publish-socketbin.yml')
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

main()
