
/**
 * @fileoverview Publish Socket CLI binaries using yao-pkg to @socketbin packages
 *
 * This script builds and publishes platform-specific binaries to npm as separate packages.
 * Each platform gets its own @socketbin/cli-{platform}-{arch} package for easy installation.
 *
 * Yao-pkg provides broader compatibility and smaller binaries than Node SEA,
 * supporting Node 18, 20, 22, and 24.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_DIR = path.join(ROOT_DIR, 'build', 'yao')
const DIST_DIR = path.join(ROOT_DIR, 'dist')
const PKG_CONFIG = path.join(ROOT_DIR, '.config', 'pkg.json')

/**
 * Platform configurations for @socketbin packages
 */
const PLATFORMS = {
  'darwin-arm64': {
    name: 'macOS ARM64 (Apple Silicon)',
    pkgTarget: 'macos-arm64',
    binary: 'socket',
    package: '@socketbin/cli-darwin-arm64',
  },
  'darwin-x64': {
    name: 'macOS x64 (Intel)',
    pkgTarget: 'macos-x64',
    binary: 'socket',
    package: '@socketbin/cli-darwin-x64',
  },
  'linux-arm64': {
    name: 'Linux ARM64',
    pkgTarget: 'linux-arm64',
    binary: 'socket',
    package: '@socketbin/cli-linux-arm64',
  },
  'linux-x64': {
    name: 'Linux x64',
    pkgTarget: 'linux-x64',
    binary: 'socket',
    package: '@socketbin/cli-linux-x64',
  },
  'win32-arm64': {
    name: 'Windows ARM64',
    pkgTarget: 'win-arm64',
    binary: 'socket.exe',
    package: '@socketbin/cli-win32-arm64',
  },
  'win32-x64': {
    name: 'Windows x64',
    pkgTarget: 'win-x64',
    binary: 'socket.exe',
    package: '@socketbin/cli-win32-x64',
  },
  // Optional additional platforms
  'linux-armv7': {
    name: 'Linux ARMv7 (32-bit ARM)',
    pkgTarget: 'linux-armv7',
    binary: 'socket',
    package: '@socketbin/cli-linux-armv7',
    optional: true,
  },
  'alpine-x64': {
    name: 'Alpine Linux x64 (musl)',
    pkgTarget: 'alpine-x64',
    binary: 'socket',
    package: '@socketbin/cli-alpine-x64',
    optional: true,
  },
  'alpine-arm64': {
    name: 'Alpine Linux ARM64 (musl)',
    pkgTarget: 'alpine-arm64',
    binary: 'socket',
    package: '@socketbin/cli-alpine-arm64',
    optional: true,
  },
}

/**
 * Detect latest supported Node version from yao-pkg
 */
async function detectLatestNodeVersion() {
  console.log('🔍 Detecting latest yao-pkg Node version...')

  try {
    const response = await fetch('https://api.github.com/repos/yao-pkg/pkg-fetch/contents/patches')
    const data = await response.json()

    // Extract Node versions from patch filenames
    const versions = data
      .filter(file => file.name.startsWith('node.v'))
      .map(file => {
        const match = file.name.match(/node\.v(\d+\.\d+\.\d+)/)
        return match ? match[1] : null
      })
      .filter(Boolean)
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number)
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number)
        if (aMajor !== bMajor) {return bMajor - aMajor}
        if (aMinor !== bMinor) {return bMinor - aMinor}
        return bPatch - aPatch
      })

    // Find latest for each major version
    const v24 = versions.find(v => v.startsWith('24.'))
    const v22 = versions.find(v => v.startsWith('22.'))
    const v20 = versions.find(v => v.startsWith('20.'))
    const v18 = versions.find(v => v.startsWith('18.'))

    const latest = v24 || v22 || v20 || v18 || '24.9.0'
    console.log(`   Found: v${latest} (supports v18, v20, v22, v24)`)

    return latest
  } catch (e) {
    console.warn('   Failed to auto-detect, using default: v24.9.0')
    return '24.9.0'
  }
}

/**
 * Build binary using yao-pkg for a specific platform
 */
async function buildYaoBinary(platform, arch, nodeVersion) {
  const platformKey = `${platform}-${arch}`
  const config = PLATFORMS[platformKey]

  if (!config) {
    throw new Error(`Unsupported platform: ${platformKey}`)
  }

  console.log(`\n📦 Building ${config.name}...`)
  console.log(`   Using Node v${nodeVersion}`)

  // Ensure dist files exist
  if (!existsSync(path.join(DIST_DIR, 'cli.js'))) {
    console.log('   Building distribution files...')
    await runCommand('pnpm', ['run', 'build'])
  }

  // Create build directory
  const platformDir = path.join(BUILD_DIR, platformKey)
  await fs.mkdir(platformDir, { recursive: true })
  const outputPath = path.join(platformDir, config.binary)

  // For Alpine platforms, use Docker to build with musl libc
  if (platformKey.startsWith('alpine-')) {
    console.log('   🐳 Using Docker for Alpine/musl build...')

    // Use the build-binary.mjs script with Docker flag
    const buildArgs = [
      'node',
      path.join(__dirname, 'build', 'build-binary.mjs'),
      '--mode=yao-pkg',
      '--platform=alpine',
      `--arch=${arch}`,
      `--node-version=${nodeVersion}`,
      `--output=${outputPath}`,
      '--docker'
    ]

    await runCommand('pnpm', ['exec', ...buildArgs])
  } else {
    // Standard yao-pkg build for non-Alpine platforms
    const majorVersion = nodeVersion.split('.')[0]
    const pkgTarget = `node${majorVersion}-${config.pkgTarget}`

    console.log(`   Target: ${pkgTarget}`)

    const pkgArgs = [
      'exec', 'pkg',
      PKG_CONFIG,
      '--targets', pkgTarget,
      '--output', outputPath,
      '--compress', 'GZip',  // Use compression for smaller binaries
    ]

    // Add minification in production
    const env = { ...process.env }
    if (process.env.NODE_ENV === 'production') {
      env.MINIFY = '1'
    }

    await runCommand('pnpm', pkgArgs, { env })
  }

  // Calculate checksum
  const fileBuffer = await fs.readFile(outputPath)
  const hash = createHash('sha256').update(fileBuffer).digest('hex')

  // Get file size
  const stats = await fs.stat(outputPath)
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

  console.log(`   ✅ Built: ${config.binary} (${sizeMB} MB)`)
  console.log(`   SHA256: ${hash}`)

  return {
    path: outputPath,
    hash,
    size: stats.size,
    config,
  }
}

/**
 * Create package.json for a binary package
 */
async function createBinaryPackage(binary, version, nodeVersion) {
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
    description: `Socket CLI binary for ${config.name} (yao-pkg build)`,
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
    libc: config.package.includes('alpine') ? ['musl'] : undefined,
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
      buildTool: 'yao-pkg',
      nodeVersion: `v${nodeVersion}`,
      binaryHash: hash,
      binarySize: size,
      buildDate: new Date().toISOString(),
    },
  }

  await fs.writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n'
  )

  // Create README
  const readme = `# ${config.package}

Socket CLI binary package for ${config.name}.

Built with yao-pkg for Node.js v${nodeVersion}.

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
- **Build Tool:** yao-pkg
- **Node Version:** v${nodeVersion}
- **Build Date:** ${new Date().toISOString()}

## Compatibility

This binary is built with yao-pkg and includes Node.js v${nodeVersion} runtime.
No additional Node.js installation is required on the target system.${
  config.package.includes('alpine') ? `

### Alpine Linux / musl libc

This binary is specifically built for Alpine Linux and other musl-based distributions.
It is linked against musl libc for optimal compatibility with Docker containers and
lightweight Linux distributions.` : ''
}

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
    const { cwd = ROOT_DIR, env = process.env, quiet = false } = options

    const child = spawn(command, args, {
      cwd,
      env,
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
      'node-version': {
        type: 'string',
      },
      'auto-detect': {
        type: 'boolean',
        default: true,
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
Socket CLI Yao-PKG Publisher
=============================

Builds and publishes Socket CLI binaries to @socketbin packages using yao-pkg.

Usage: node scripts/publish-yao.mjs [options]

Options:
  --platform=PLATFORM    Specific platform(s) to build (can specify multiple)
  --version=VERSION      Version to publish (default: from package.json)
  --node-version=VERSION Node.js version for yao-pkg (default: auto-detect latest)
  --auto-detect          Auto-detect latest yao-pkg Node version (default: true)
  --dry-run             Perform dry-run without publishing
  --skip-build          Skip building binaries (use existing)
  --skip-optional       Skip optional platforms (armv7, alpine)
  --otp=CODE            npm OTP for publishing
  --help                Show this help

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
  # Build and publish all platforms with auto-detected Node version
  node scripts/publish-yao.mjs

  # Build specific platforms
  node scripts/publish-yao.mjs --platform=darwin-arm64 --platform=linux-x64

  # Use specific Node version
  node scripts/publish-yao.mjs --node-version=24.9.0

  # Dry run
  node scripts/publish-yao.mjs --dry-run

  # With OTP
  node scripts/publish-yao.mjs --otp=123456

Notes:
  - yao-pkg supports Node.js v18, v20, v22, and v24
  - Produces smaller binaries than Node SEA
  - Better compatibility across different systems
  - Uses trusted publishing with --provenance flag
  - Each platform publishes as a separate npm package
`)
    process.exit(0)
  }

  console.log('🚀 Socket CLI Yao-PKG Publisher')
  console.log('================================\n')

  try {
    // Get or detect Node version
    let nodeVersion = values['node-version']
    if (!nodeVersion && values['auto-detect']) {
      nodeVersion = await detectLatestNodeVersion()
    } else {
      nodeVersion = nodeVersion || '24.9.0'
      console.log(`Using specified Node version: v${nodeVersion}`)
    }

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
      console.log('\n🔨 Building binaries with yao-pkg...')

      for (const platformKey of platformsToBuild) {
        const [platform, arch] = platformKey.split('-')

        try {
          const binary = await buildYaoBinary(platform, arch, nodeVersion)
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
      const packageDir = await createBinaryPackage(binary, version, nodeVersion)
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

    console.log(`\nBuild Details:`)
    console.log(`  - Tool: yao-pkg`)
    console.log(`  - Node version: v${nodeVersion}`)
    console.log(`  - Package version: ${version}`)

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