// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { homedir, tmpdir } = require('node:os')
// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { join } = require('node:path')
// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { spawnSync } = require('node:child_process')
// eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
const { brotliDecompressSync } = require('node:zlib')

const SOCKET_DLX_DIR = join(homedir(), '.socket', '_dlx')
const CLI_PACKAGE_DIR = join(SOCKET_DLX_DIR, 'cli')
const CLI_ENTRY = join(CLI_PACKAGE_DIR, 'dist', 'cli.js')
const CLI_ENTRY_BZ = join(CLI_PACKAGE_DIR, 'dist', 'cli.js.bz')

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
  const result = spawnSync(
    process.execPath,
    [tempCliPath, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PKG_EXECPATH: process.env.PKG_EXECPATH || 'PKG_INVOKE_NODEJS',
      },
    },
  )

  // Clean up temp file.
  try {
    // eslint-disable-next-line no-restricted-syntax, n/prefer-global/process
    const { unlinkSync } = require('node:fs')
    unlinkSync(tempCliPath)
  } catch {
    // Ignore cleanup errors.
  }

  process.exit(result.status || 0)
} else if (existsSync(CLI_ENTRY)) {
  // Fallback to uncompressed CLI.
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
