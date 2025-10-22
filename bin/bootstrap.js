const { spawnSync } = require('node:child_process')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { homedir, tmpdir } = require('node:os')
const { join } = require('node:path')
const { brotliDecompressSync } = require('node:zlib')

const SOCKET_DLX_DIR = join(homedir(), '.socket', '_dlx')
const CLI_PACKAGE_DIR = join(SOCKET_DLX_DIR, 'cli')
const CLI_ENTRY = join(CLI_PACKAGE_DIR, 'dist', 'cli.js')
const CLI_ENTRY_BZ = join(CLI_PACKAGE_DIR, 'dist', 'cli.js.bz')

// Get command-line arguments, defaulting to empty array if not yet available.
const args = process.argv ? process.argv.slice(2) : []

// Check for brotli-compressed CLI first.
if (existsSync(CLI_ENTRY_BZ)) {
  // Read compressed file.
  const compressed = readFileSync(CLI_ENTRY_BZ)

  // Decompress with brotli.
  const decompressed = brotliDecompressSync(compressed)

  // Write to temporary file and execute.
  // Using a temp file allows us to maintain spawn behavior for proper stdio handling.
  const tempCliPath = join(tmpdir(), `socket-cli-${process.pid}.js`)
  writeFileSync(tempCliPath, decompressed)

  // Delegate to decompressed CLI.
  const result = spawnSync(process.execPath, [tempCliPath, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PKG_EXECPATH: process.env.PKG_EXECPATH || 'PKG_INVOKE_NODEJS',
    },
  })

  // Clean up temp file.
  try {
    const { unlinkSync } = require('node:fs')
    unlinkSync(tempCliPath)
  } catch {
    // Ignore cleanup errors.
  }

  process.exit(result.status || 0)
} else if (existsSync(CLI_ENTRY)) {
  // Fallback to uncompressed CLI.
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PKG_EXECPATH: process.env.PKG_EXECPATH || 'PKG_INVOKE_NODEJS',
    },
  })
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
