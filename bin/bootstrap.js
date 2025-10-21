// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { existsSync } = require('fs')
// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { homedir } = require('os')
// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { join } = require('path')
// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { spawnSync } = require('child_process')

const SOCKET_DLX_DIR = join(homedir(), '.socket', '_dlx')
const CLI_PACKAGE_DIR = join(SOCKET_DLX_DIR, 'cli')
const CLI_ENTRY = join(CLI_PACKAGE_DIR, 'dist', 'cli.js')

// Check if CLI exists.
if (existsSync(CLI_ENTRY)) {
  // Delegate to ~/.socket/_dlx/cli/dist/cli.js.
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
  // Download and install.
  process.stderr.write('📦 Socket CLI not found, installing...\n')
  process.stderr.write(`   Directory: ${CLI_PACKAGE_DIR}\n`)
  process.stderr.write('\n')
  process.stderr.write('❌ Not implemented yet\n')
  process.stderr.write(
    '   TODO: Download @socketsecurity/cli from npm registry\n',
  )
  process.stderr.write(`   TODO: Extract to ${CLI_PACKAGE_DIR}\n`)
  process.exit(1)
}
