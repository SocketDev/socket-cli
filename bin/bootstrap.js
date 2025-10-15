#!/usr/bin/env node

const { existsSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const SOCKET_CLI_DIR = join(homedir(), '.socket', '_socket')
const CLI_ENTRY = join(SOCKET_CLI_DIR, 'index.js')

// Check if CLI exists
if (existsSync(CLI_ENTRY)) {
  // Delegate to ~/.socket/_socket
  const result = spawnSync(
    process.execPath,
    [CLI_ENTRY, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PKG_EXECPATH: process.env.PKG_EXECPATH || 'PKG_INVOKE_NODEJS',
      },
    },
  )
  process.exit(result.status || 0)
} else {
  // Download and install
  console.error('📦 Socket CLI not found, installing...')
  console.error(`   Directory: ${SOCKET_CLI_DIR}`)
  console.error()
  console.error('❌ Not implemented yet')
  console.error('   TODO: Download tarball from npm registry')
  console.error('   TODO: Extract to ~/.socket/_socket')
  process.exit(1)
}
