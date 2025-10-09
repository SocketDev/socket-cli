#!/usr/bin/env node

/**
 * @fileoverview Publish Socket CLI binaries using Node.js SEA to @socketbin packages
 *
 * This script builds and publishes platform-specific binaries to npm as separate packages.
 * Each platform gets its own @socketbin/cli-{platform}-{arch} package for easy installation.
 *
 * Node SEA (Single Executable Applications) is more reliable in CI than yao-pkg
 * and doesn't depend on external patches.
 */

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { promisify } from 'node:util'
import { exec as execCallback } from 'node:child_process'

const exec = promisify(execCallback)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build', 'sea')
const DIST_DIR = path.join(ROOT_DIR, 'dist')
const TEMPLATES_DIR = path.join(__dirname, 'sea-templates')

/**
 * Platform configurations for @socketbin packages
 */
const PLATFORMS = {
  'darwin-arm64': {
    name: 'macOS ARM64 (Apple Silicon)',
    node: 'node20-macos-arm64',
    binary: 'socket',
    package: '@socketbin/cli-darwin-arm64',
  },
  'darwin-x64': {
    name: 'macOS x64 (Intel)',
    node: 'node20-macos-x64',
    binary: 'socket',
    package: '@socketbin/cli-darwin-x64',
  },
  'linux-arm64': {
    name: 'Linux ARM64',
    node: 'node20-linux-arm64',
    binary: 'socket',
    package: '@socketbin/cli-linux-arm64',
  },
  'linux-x64': {
    name: 'Linux x64',
    node: 'node20-linux-x64',
    binary: 'socket',
    package: '@socketbin/cli-linux-x64',
  },
  'win32-arm64': {
    name: 'Windows ARM64',
    node: 'node20-win-arm64',
    binary: 'socket.exe',
    package: '@socketbin/cli-win32-arm64',
  },
  'win32-x64': {
    name: 'Windows x64',
    node: 'node20-win-x64',
    binary: 'socket.exe',
    package: '@socketbin/cli-win32-x64',
  },
  // Optional additional platforms
  'linux-armv7': {
    name: 'Linux ARMv7 (32-bit ARM)',
    node: 'node20-linux-armv7',
    binary: 'socket',
    package: '@socketbin/cli-linux-armv7',
    optional: true,
  },
  'alpine-x64': {
    name: 'Alpine Linux x64 (musl)',
    node: 'node20-alpine-x64',
    binary: 'socket',
    package: '@socketbin/cli-alpine-x64',
    optional: true,
  },
  'alpine-arm64': {
    name: 'Alpine Linux ARM64 (musl)',
    node: 'node20-alpine-arm64',
    binary: 'socket',
    package: '@socketbin/cli-alpine-arm64',
    optional: true,
  },
}

/**
 * Check Node.js version for SEA support
 */
function checkNodeVersion() {
  const version = process.version
  const [major, minor] = version.slice(1).split('.').map(Number)

  if (major < 20 || (major === 20 && minor < 12)) {
    throw new Error(`Node.js SEA requires v20.12.0+ or v22+ (current: ${version})`)
  }

  return { major, minor, version }
}

/**
 * Build SEA binary for a specific platform
 */
async function buildSEABinary(platform, arch) {
  const platformKey = `${platform}-${arch}`
  const config = PLATFORMS[platformKey]

  if (!config) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }

  console.log(`\n📦 Building ${config.name}...`)

  // Ensure dist files exist
  if (!existsSync(path.join(DIST_DIR, 'cli.js'))) {
    console.log('   Building distribution files...')
    await runCommand('pnpm', ['run', 'build'])
  }

  // Create build directory
  await fs.mkdir(BUILD_DIR, { recursive: true })

  // Create SEA configuration
  const seaConfig = {
    main: path.join(DIST_DIR, 'cli.js'),
    output: path.join(BUILD_DIR, `${platformKey}.blob`),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
  }

  const configPath = path.join(BUILD_DIR, `${platformKey}-config.json`)
  await fs.writeFile(configPath, JSON.stringify(seaConfig, null, 2))

  // Generate blob
  console.log('   Generating SEA blob...')
  await runCommand('node', ['--experimental-sea-config', configPath])

  // Platform-specific binary creation
  const binaryPath = path.join(BUILD_DIR, platformKey, config.binary)
  await fs.mkdir(path.dirname(binaryPath), { recursive: true })

  if (platform === 'win32') {
    // Windows: Copy node.exe and inject blob
    await fs.copyFile(process.execPath, binaryPath)
    await runCommand('npx', [
      'postject',
      binaryPath,
      'NODE_SEA_BLOB',
      seaConfig.output,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ])
  } else {
    // Unix: Copy node and inject blob
    await fs.copyFile(process.execPath, binaryPath)
    await runCommand('npx', [
      'postject',
      binaryPath,
      'NODE_SEA_BLOB',
      seaConfig.output,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ])

    // Make executable
    await fs.chmod(binaryPath, 0o755)

    // Sign on macOS if available
    if (platform === 'darwin') {
      try {
        await runCommand('codesign', ['--sign', '-', binaryPath], { quiet: true })
      } catch (e) {
        console.warn('   Warning: codesign not available, binary may require user approval')
      }
    }
  }

  // Calculate checksum
  const fileBuffer = await fs.readFile(binaryPath)
  const hash = createHash('sha256').update(fileBuffer).digest('hex')

  // Get file size
  const stats = await fs.stat(binaryPath)
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

  console.log(`   ✅ Built: ${config.binary} (${sizeMB} MB)`)
  console.log(`   SHA256: ${hash}`)

  return {
    path: binaryPath,
    hash,
    size: stats.size,
    config,
  }
}

/**
 * Create package.json for a binary package
 */
async function createBinaryPackage(binary, version) {
  const { config, hash, size } = binary
  const packageDir = path.join(BUILD_DIR, config.package)

  await fs.mkdir(packageDir, { recursive: true })

  // Copy binary
  const binaryDest = path.join(packageDir, config.binary)
  await fs.copyFile(binary.path, binaryDest)

  // Create package.json
  const packageJson = {
    name: config.package,
    version,
    description: `Socket CLI binary for ${config.name}`,
    keywords: ['socket', 'cli', 'security', 'binary', config.name.toLowerCase()],
    author: 'Socket Inc.',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/SocketDev/socket-cli.git',
      directory: 'packages/binaries',
    },
    files: [config.binary, 'README.md'],
    bin: {
      socket: config.binary,
    },
    os: [config.package.includes('darwin') ? 'darwin' :
         config.package.includes('win32') ? 'win32' :
         config.package.includes('alpine') ? 'linux' : 'linux'],
    cpu: [config.package.includes('arm64') ? 'arm64' :
          config.package.includes('armv7') ? 'arm' :
          config.package.includes('x64') ? 'x64' : 'x64'],
    engines: {
      node: '>=18.0.0',
    },
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    },
    socketSecurity: {
      version: '1.0.0',
    },
    _meta: {
      binaryHash: hash,
      binarySize: size,
      buildDate: new Date().toISOString(),
      nodeVersion: process.version,
    },
  }

  await fs.writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n'
  )

  // Create README
  const readme = `# ${config.package}

Socket CLI binary package for ${config.name}.

## Installation

\`\`\`bash
npm install -g ${config.package}
\`\`\`

## Usage

After installation, the \`socket\` command will be available:

\`\`\`bash
socket --version
socket --help
\`\`\`

## Binary Details

- **Platform:** ${config.name}
- **Size:** ${(size / 1024 / 1024).toFixed(2)} MB
- **SHA256:** ${hash}
- **Build Date:** ${new Date().toISOString()}

## About

This package contains a platform-specific binary for the Socket CLI.
For more information, visit: https://github.com/SocketDev/socket-cli

## License

MIT © Socket Inc.
`

  await fs.writeFile(path.join(packageDir, 'README.md'), readme)

  console.log(`📦 Created package: ${config.package}@${version}`)

  return packageDir
}

/**
 * Publish package to npm
 */
async function publishPackage(packageDir, options = {}) {
  const { dryRun = false, otp } = options
  const packageJson = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'))

  console.log(`\n📤 Publishing ${packageJson.name}@${packageJson.version}...`)

  const args = ['publish', '--access', 'public']

  // Add provenance for trusted publishing
  args.push('--provenance')

  if (dryRun) {
    args.push('--dry-run')
  }

  if (otp) {
    args.push('--otp', otp)
  }

  try {
    await runCommand('npm', args, { cwd: packageDir })
    console.log(`   ✅ Published ${packageJson.name}@${packageJson.version}`)
    return true
  } catch (error) {
    console.error(`   ❌ Failed to publish ${packageJson.name}: ${error.message}`)
    return false
  }
}

/**
 * Run command helper
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { quiet = false, cwd = ROOT_DIR } = options

    const child = spawn(command, args, {
      cwd,
      stdio: quiet ? 'pipe' : 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('exit', code => {
      if (code === 0) {
        resolve(code)
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(' ')}`))
      }
    })

    child.on('error', reject)
  })
}

/**
 * Get version from package.json
 */
async function getVersion() {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf8')
  )
  return packageJson.version
}

/**
 * Main function
 */
async function main() {
  const { values } = parseArgs({
    options: {
      platform: {
        type: 'string',
        multiple: true,
      },
      version: {
        type: 'string',
      },
      'dry-run': {
        type: 'boolean',
        default: false,
      },
      'skip-build': {
        type: 'boolean',
        default: false,
      },
      'skip-optional': {
        type: 'boolean',
        default: false,
      },
      otp: {
        type: 'string',
      },
      help: {
        type: 'boolean',
        default: false,
      },
    },
    allowPositionals: false,
    strict: false,
  })

  if (values.help) {
    console.log(`
Socket CLI SEA Publisher
========================

Builds and publishes Socket CLI binaries to @socketbin packages using Node.js SEA.

Usage: node scripts/publish-sea.mjs [options]

Options:
  --platform=PLATFORM  Specific platform(s) to build (can specify multiple)
  --version=VERSION    Version to publish (default: from package.json)
  --dry-run           Perform dry-run without publishing
  --skip-build        Skip building binaries (use existing)
  --skip-optional     Skip optional platforms (armv7, alpine)
  --otp=CODE          npm OTP for publishing
  --help              Show this help

Platforms:
  darwin-arm64   macOS Apple Silicon      @socketbin/cli-darwin-arm64
  darwin-x64     macOS Intel              @socketbin/cli-darwin-x64
  linux-arm64    Linux ARM64              @socketbin/cli-linux-arm64
  linux-x64      Linux x64                @socketbin/cli-linux-x64
  win32-arm64    Windows ARM64            @socketbin/cli-win32-arm64
  win32-x64      Windows x64              @socketbin/cli-win32-x64

Optional:
  linux-armv7    Linux ARMv7 (32-bit)     @socketbin/cli-linux-armv7
  alpine-x64     Alpine Linux x64         @socketbin/cli-alpine-x64
  alpine-arm64   Alpine Linux ARM64       @socketbin/cli-alpine-arm64

Examples:
  # Build and publish all platforms
  node scripts/publish-sea.mjs

  # Build specific platforms
  node scripts/publish-sea.mjs --platform=darwin-arm64 --platform=linux-x64

  # Dry run
  node scripts/publish-sea.mjs --dry-run

  # With OTP
  node scripts/publish-sea.mjs --otp=123456

Notes:
  - Requires Node.js v20.12.0+ or v22+ for SEA support
  - Uses trusted publishing with --provenance flag
  - Each platform publishes as a separate npm package
  - Binaries are built using Node.js native SEA (Single Executable Applications)
`)
    process.exit(0)
  }

  console.log('🚀 Socket CLI SEA Publisher')
  console.log('===========================\n')

  try {
    // Check Node version
    const { version: nodeVersion } = checkNodeVersion()
    console.log(`Node.js version: ${nodeVersion} ✅`)

    // Get version
    const version = values.version || await getVersion()
    console.log(`Publishing version: ${version}\n`)

    // Determine which platforms to build
    let platformsToBuild = values.platform || []

    if (platformsToBuild.length === 0) {
      // Build all platforms
      platformsToBuild = Object.entries(PLATFORMS)
        .filter(([_, config]) => !values['skip-optional'] || !config.optional)
        .map(([key]) => key)
    }

    console.log('Platforms to build:')
    platformsToBuild.forEach(p => {
      const config = PLATFORMS[p]
      if (config) {
        console.log(`  - ${p}: ${config.name}`)
      }
    })

    // Build binaries
    const binaries = []

    if (!values['skip-build']) {
      console.log('\n🔨 Building binaries...')

      for (const platformKey of platformsToBuild) {
        const [platform, arch] = platformKey.split('-')

        try {
          const binary = await buildSEABinary(platform, arch)
          binaries.push(binary)
        } catch (error) {
          console.error(`❌ Failed to build ${platformKey}: ${error.message}`)
          if (!values['dry-run']) {
            throw error
          }
        }
      }
    } else {
      console.log('\n⏭️  Skipping build (using existing binaries)')

      // Find existing binaries
      for (const platformKey of platformsToBuild) {
        const config = PLATFORMS[platformKey]
        const binaryPath = path.join(BUILD_DIR, platformKey, config.binary)

        if (existsSync(binaryPath)) {
          const fileBuffer = await fs.readFile(binaryPath)
          const hash = createHash('sha256').update(fileBuffer).digest('hex')
          const stats = await fs.stat(binaryPath)

          binaries.push({
            path: binaryPath,
            hash,
            size: stats.size,
            config,
          })
        } else {
          console.warn(`⚠️  Binary not found: ${binaryPath}`)
        }
      }
    }

    if (binaries.length === 0) {
      throw new Error('No binaries to publish')
    }

    // Create packages
    console.log('\n📦 Creating npm packages...')
    const packages = []

    for (const binary of binaries) {
      const packageDir = await createBinaryPackage(binary, version)
      packages.push(packageDir)
    }

    // Publish packages
    console.log('\n🚀 Publishing to npm...')

    if (values['dry-run']) {
      console.log('   (Dry run - no packages will be published)')
    }

    const results = []
    for (const packageDir of packages) {
      const success = await publishPackage(packageDir, {
        dryRun: values['dry-run'],
        otp: values.otp,
      })
      results.push(success)
    }

    // Summary
    console.log('\n📊 Summary')
    console.log('==========')

    const successCount = results.filter(r => r).length
    const failCount = results.filter(r => !r).length

    console.log(`✅ Successfully published: ${successCount}`)
    if (failCount > 0) {
      console.log(`❌ Failed: ${failCount}`)
    }

    if (values['dry-run']) {
      console.log('\n(This was a dry run - no packages were actually published)')
    }

    // Exit with appropriate code
    process.exit(failCount > 0 ? 1 : 0)

  } catch (error) {
    console.error('\n❌ Publishing failed:', error.message)
    process.exit(1)
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error)
}

export default main