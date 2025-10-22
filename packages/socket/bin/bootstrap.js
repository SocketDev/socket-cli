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
  // Download and install CLI from npm.
  process.stderr.write('📦 Socket CLI not found, downloading...\n')
  process.stderr.write(`   Installing to: ${CLI_PACKAGE_DIR}\n`)
  process.stderr.write('\n')

  // Create directories.
  const { mkdirSync } = require('node:fs')
  mkdirSync(SOCKET_DLX_DIR, { recursive: true })

  // Download using npm pack.
  const npmPackResult = spawnSync('npm', ['pack', '@socketsecurity/cli', '--pack-destination', SOCKET_DLX_DIR], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })

  if (npmPackResult.status !== 0) {
    process.stderr.write('❌ Failed to download Socket CLI\n')
    process.stderr.write('   npm pack exited with error\n')
    process.exit(1)
  }

  const tarballName = npmPackResult.stdout.toString().trim()
  const tarballPath = join(SOCKET_DLX_DIR, tarballName)

  // Create CLI directory.
  mkdirSync(CLI_PACKAGE_DIR, { recursive: true })

  // Extract tarball.
  const tarResult = spawnSync('tar', ['-xzf', tarballPath, '-C', CLI_PACKAGE_DIR, '--strip-components=1'], {
    stdio: 'inherit',
  })

  if (tarResult.status !== 0) {
    process.stderr.write('❌ Failed to extract Socket CLI\n')
    process.stderr.write('   tar extraction failed\n')
    process.exit(1)
  }

  // Clean up tarball.
  try {
    const { unlinkSync } = require('node:fs')
    unlinkSync(tarballPath)
  } catch {
    // Ignore cleanup errors.
  }

  process.stderr.write('✅ Socket CLI installed successfully\n')
  process.stderr.write('\n')

  // Now delegate to the newly installed CLI.
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PKG_EXECPATH: process.env.PKG_EXECPATH || 'PKG_INVOKE_NODEJS',
    },
  })
  process.exit(result.status || 0)
}
