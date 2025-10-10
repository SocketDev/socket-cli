
/**
 * @fileoverview Enhanced binary builder supporting both yao-pkg and Node SEA
 *
 * Features:
 * - Automatic Node version detection from yao-pkg
 * - Support for native Node.js SEA (Single Executable Applications)
 * - Docker-based cross-compilation for Linux ARM
 * - Configurable build modes
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import colors from 'yoctocolors-cjs'

import { signBinary } from './code-signing.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '../..')
const BUILD_DIR = join(ROOT_DIR, 'build')
const DIST_DIR = join(ROOT_DIR, 'dist')

/**
 * Load socket-node version from config
 */
const socketNodeConfig = JSON.parse(
  await readFile(join(ROOT_DIR, '.config', 'socket-node.json'), 'utf8')
)
const SOCKET_NODE_VERSION = socketNodeConfig.version

/**
 * Check for newer yao-pkg Node versions and notify if updates available
 */
async function checkYaoPkgNodeVersions() {
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

    // Find latest versions for each major
    const v24 = versions.find(v => v.startsWith('24.'))
    const v22 = versions.find(v => v.startsWith('22.'))
    const v20 = versions.find(v => v.startsWith('20.'))

    // Check if there's a newer version than what we're using
    const currentParts = SOCKET_NODE_VERSION.split('.').map(Number)
    const newerVersions = versions.filter(v => {
      const parts = v.split('.').map(Number)
      // Only check same major version for patch updates
      if (parts[0] !== currentParts[0]) {return false}
      if (parts[1] > currentParts[1]) {return true}
      if (parts[1] === currentParts[1] && parts[2] > currentParts[2]) {return true}
      return false
    })

    if (newerVersions.length > 0) {
      console.log('\n' + colors.magenta('═'.repeat(70)))
      console.log(colors.magenta('║') + ' 🎉 🕺 ' + colors.bold(colors.cyan('NEW YAO-PKG NODE VERSIONS AVAILABLE!')) + ' 👯 🎉')
      console.log(colors.magenta('═'.repeat(70)))
      console.log(colors.magenta('║') + ' Current socket-node version: ' + colors.dim(`v${SOCKET_NODE_VERSION}`))
      console.log(colors.magenta('║') + ' ' + colors.bold(colors.green(`Newer versions available: ${newerVersions.map(v => `v${v}`).join(', ')}`)))
      console.log(colors.magenta('║'))
      console.log(colors.magenta('║') + ' 📝 ' + colors.bold('ACTION REQUIRED:'))
      console.log(colors.magenta('║') + ' 1. Update socket-node patches for the new Node version')
      console.log(colors.magenta('║') + ' 2. Test thoroughly with the new version')
      console.log(colors.magenta('║') + ' 3. Update version in ' + colors.cyan('.config/socket-node.json'))
      console.log(colors.magenta('║'))
      console.log(colors.magenta('║') + ' Latest versions by major:')
      if (v24) {console.log(colors.magenta('║') + `   Node 24: ${colors.cyan(`v${v24}`)}`)}
      if (v22) {console.log(colors.magenta('║') + `   Node 22: ${colors.cyan(`v${v22}`)}`)}
      if (v20) {console.log(colors.magenta('║') + `   Node 20: ${colors.cyan(`v${v20}`)}`)}
      console.log(colors.magenta('═'.repeat(70)) + '\n')
    }

    return {
      current: SOCKET_NODE_VERSION,
      available: { v24, v22, v20 },
      hasUpdates: newerVersions.length > 0,
      newerVersions
    }
  } catch (e) {
    // Silently continue with current version if check fails
    return {
      current: SOCKET_NODE_VERSION,
      available: {},
      hasUpdates: false,
      newerVersions: []
    }
  }
}

/**
 * Build configuration
 */
const BUILD_MODES = {
  'yao-pkg': {
    name: 'Yao PKG',
    description: 'Uses yao-pkg for maximum compatibility',
    nodeVersions: ['18.x', '20.x', '22.x', '24.x'],
    platforms: ['linux', 'macos', 'win'],
    architectures: ['x64', 'arm64'],
  },
  'node-sea': {
    name: 'Node.js SEA',
    description: 'Native Node.js Single Executable Applications (v20.12+)',
    minNodeVersion: '20.12.0',
    platforms: ['linux', 'macos', 'win'],
    architectures: ['x64', 'arm64'],
  }
}

/**
 * Docker configurations for cross-compilation
 */
const DOCKER_CONFIGS = {
  'linux-arm64': {
    image: 'multiarch/ubuntu-core:arm64-focal',
    dockerfile: `
FROM multiarch/ubuntu-core:arm64-focal
RUN apt-get update && apt-get install -y \\
    build-essential \\
    python3 \\
    git \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \\
    && apt-get install -y nodejs

WORKDIR /app
`,
    buildCmd: 'docker run --rm -v $(pwd):/app linux-arm64-builder npm run build:binary'
  },
  'linux-arm32': {
    image: 'multiarch/ubuntu-core:armhf-focal',
    dockerfile: `
FROM multiarch/ubuntu-core:armhf-focal
RUN apt-get update && apt-get install -y \\
    build-essential \\
    python3 \\
    git \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \\
    && apt-get install -y nodejs

WORKDIR /app
`,
    buildCmd: 'docker run --rm -v $(pwd):/app linux-arm32-builder npm run build:binary'
  },
  'alpine-x64': {
    image: 'node:20-alpine',
    dockerfile: `
FROM node:20-alpine

# Install build essentials for Alpine (musl libc)
RUN apk add --no-cache \\
    build-base \\
    python3 \\
    git \\
    bash \\
    curl

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
`,
    buildCmd: 'docker run --rm -v $(pwd):/app alpine-x64-builder sh -c "pnpm install --frozen-lockfile && pnpm run build:binary"'
  },
  'alpine-arm64': {
    image: 'node:20-alpine',
    platform: 'linux/arm64',
    dockerfile: `
FROM --platform=linux/arm64 node:20-alpine

# Install build essentials for Alpine ARM64 (musl libc)
RUN apk add --no-cache \\
    build-base \\
    python3 \\
    git \\
    bash \\
    curl

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
`,
    buildCmd: 'docker run --rm --platform linux/arm64 -v $(pwd):/app alpine-arm64-builder sh -c "pnpm install --frozen-lockfile && pnpm run build:binary"'
  }
}

/**
 * Build with yao-pkg
 */
async function buildWithYaoPkg(options) {
  const { arch, isAlpine = false, nodeVersion, output, platform } = options

  console.log('🚀 Building with yao-pkg')
  console.log(`   Platform: ${platform}${isAlpine ? ' (Alpine/musl)' : ''}`)
  console.log(`   Architecture: ${arch}`)
  console.log(`   Node version: v${nodeVersion}`)

  // Ensure dist files exist
  if (!existsSync(join(DIST_DIR, 'cli.js'))) {
    console.log('📦 Building distribution files...')
    await runCommand('pnpm', ['run', 'build'])
  }

  // Prepare pkg target
  // Note: yao-pkg uses 'linux' target for both glibc and musl builds
  // The musl variant is built when running inside Alpine Docker container
  const majorVersion = nodeVersion.split('.')[0]
  const targetPlatform = platform === 'alpine' ? 'linux' : platform
  const pkgTarget = `node${majorVersion}-${targetPlatform}-${arch}`

  // Run pkg
  const pkgArgs = [
    'exec', 'pkg',
    join(ROOT_DIR, '.config', 'pkg.json'),
    '--targets', pkgTarget,
    '--output', output
  ]

  await runCommand('pnpm', pkgArgs)

  console.log(`✅ Built: ${output}`)
}

/**
 * Build with Node.js SEA
 */
async function buildWithNodeSea(options) {
  const { arch, output, platform } = options

  console.log('🚀 Building with Node.js SEA')
  console.log(`   Platform: ${platform}`)
  console.log(`   Architecture: ${arch}`)

  // Check Node version
  const nodeVersion = process.version
  const [major, minor] = nodeVersion.slice(1).split('.').map(Number)

  if (major < 20 || (major === 20 && minor < 12)) {
    throw new Error(`Node.js SEA requires Node v20.12.0 or later (current: ${nodeVersion})`)
  }

  // Build SEA configuration
  const seaConfig = {
    main: join(DIST_DIR, 'cli.js'),
    output: join(BUILD_DIR, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false, // Can enable for faster startup
    useCodeCache: true
  }

  // Create SEA config file
  const configPath = join(BUILD_DIR, 'sea-config.json')
  await mkdir(BUILD_DIR, { recursive: true })
  await writeFile(configPath, JSON.stringify(seaConfig, null, 2))

  // Generate blob
  console.log('📦 Generating SEA blob...')
  await runCommand('node', ['--experimental-sea-config', configPath])

  // Use our patched socket-node instead of system Node
  // This ensures SEA binaries have our security patches (disable -e, restrict -r, etc.)
  const socketNodePath = join(BUILD_DIR, 'socket-node', `v${SOCKET_NODE_VERSION}`, 'out', 'Signed', 'node')
  const fallbackPath = join(BUILD_DIR, 'socket-node', `v${SOCKET_NODE_VERSION}`, 'out', 'Release', 'node')

  let nodeExe
  if (existsSync(socketNodePath)) {
    nodeExe = socketNodePath
    console.log('   Using signed socket-node binary')
  } else if (existsSync(fallbackPath)) {
    nodeExe = fallbackPath
    console.log('   Using release socket-node binary')
  } else {
    throw new Error(`Socket-node binary not found. Run 'node scripts/build/build-socket-node.mjs' first.\n   Expected: ${socketNodePath}\n   Or: ${fallbackPath}`)
  }

  const seaExe = output

  if (platform === 'win') {
    // Windows: Use signtool if available
    await runCommand('copy', [nodeExe, seaExe], { shell: true })
    await runCommand('npx', ['postject', seaExe, 'NODE_SEA_BLOB', seaConfig.output,
      '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'])
  } else {
    // Unix: Copy and inject
    await runCommand('cp', [nodeExe, seaExe])
    await runCommand('npx', ['postject', seaExe, 'NODE_SEA_BLOB', seaConfig.output,
      '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'])

    // Make executable
    await runCommand('chmod', ['+x', seaExe])

    // Sign the binary
    const signResult = await signBinary(seaExe, { force: true })
    if (!signResult.success && signResult.message) {
      if (platform === 'macos' && arch === 'arm64') {
        throw new Error(signResult.message)
      } else {
        console.warn(signResult.message)
      }
    }
  }

  console.log(`✅ Built: ${output}`)
}

/**
 * Build Windows binary using Docker (experimental)
 */
async function buildWindowsWithDocker(options) {
  console.log('⚠️  Windows cross-compilation via Docker is experimental')
  console.log('    For production builds, use GitHub Actions or a Windows VM')

  // This would use Wine or a Windows Docker container (requires Windows host)
  throw new Error('Windows cross-compilation from macOS/Linux not supported. Use GitHub Actions instead.')
}

/**
 * Helper to run commands
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options
    })

    child.on('exit', code => {
      if (code === 0) {
        resolve(code)
      } else {
        reject(new Error(`Command failed with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

/**
 * Main function
 */
async function main() {
  const { values } = parseArgs({
    options: {
      mode: {
        type: 'string',
        default: 'yao-pkg',
      },
      platform: {
        type: 'string',
        default: process.platform === 'darwin' ? 'macos' : process.platform,
      },
      arch: {
        type: 'string',
        default: process.arch,
      },
      'node-version': {
        type: 'string',
      },
      output: {
        type: 'string',
      },
      docker: {
        type: 'boolean',
        default: false,
      },
      'skip-version-check': {
        type: 'boolean',
        default: false,
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
Socket CLI Binary Builder
=========================

Usage: node scripts/build/build-binary.mjs [options]

Options:
  --mode=MODE           Build mode: yao-pkg (default) or node-sea
  --platform=PLATFORM   Target platform: linux, macos, win, alpine
  --arch=ARCH          Target architecture: x64, arm64
  --node-version=VER   Node version for yao-pkg (default: v24.9.0)
  --output=PATH        Output binary path
  --docker             Use Docker for cross-compilation (Linux ARM & Alpine)
  --skip-version-check Skip checking for newer yao-pkg Node versions
  --help               Show this help

Examples:
  # Build with yao-pkg (socket-node v24.9.0 → socket-stub)
  node scripts/build/build-binary.mjs

  # Build with Node.js SEA
  node scripts/build/build-binary.mjs --mode=node-sea

  # Cross-compile Linux ARM64 using Docker
  node scripts/build/build-binary.mjs --platform=linux --arch=arm64 --docker

  # Build for Alpine Linux (musl libc) with Docker
  node scripts/build/build-binary.mjs --platform=alpine --arch=x64 --docker

  # Build for Alpine ARM64 (Docker on ARM)
  node scripts/build/build-binary.mjs --platform=alpine --arch=arm64 --docker

  # Build for Windows from GitHub Actions
  node scripts/build/build-binary.mjs --platform=win --arch=x64

Docker Setup for Cross-Compilation:
====================================
To build Linux ARM binaries from x64:

  1. Install Docker Desktop
  2. Enable experimental features in Docker settings
  3. Run: docker buildx create --use
  4. Use --docker flag when building

Windows Binaries from macOS:
============================
Windows binaries CANNOT be built from macOS/Linux via Docker because:
- Windows requires MSVC and Windows SDK
- Docker on macOS only runs Linux containers
- Wine is unreliable for Node.js compilation

Recommended approaches:
1. Use GitHub Actions (free, supports all platforms)
2. Use a Windows VM (Parallels, VMware, VirtualBox)
3. Use cloud build services (Azure DevOps, AppVeyor)

For production, we recommend GitHub Actions workflow.
`)
    process.exitCode = 0
    return
  }

  // Check for yao-pkg Node version updates
  let nodeVersion = values['node-version']
  if (values.mode === 'yao-pkg') {
    if (!nodeVersion) {
      // Use socket-node version by default
      nodeVersion = SOCKET_NODE_VERSION
      console.log(`📦 Using socket-node version: v${nodeVersion}`)
    }

    // Check for available updates (unless --skip-version-check is passed)
    if (!values['skip-version-check']) {
      await checkYaoPkgNodeVersions()
    }
  }
  nodeVersion = nodeVersion || SOCKET_NODE_VERSION

  // Determine output path
  const ext = values.platform === 'win' ? '.exe' : ''
  const defaultOutput = join(BUILD_DIR, `socket-${values.platform}-${values.arch}${ext}`)
  const output = values.output || defaultOutput

  // Ensure build directory exists
  await mkdir(dirname(output), { recursive: true })

  // Handle Docker builds for Linux ARM and Alpine
  if (values.docker && (values.platform === 'alpine' || (values.platform === 'linux' && values.arch.startsWith('arm')))) {
    const configKey = values.platform === 'alpine' ? `alpine-${values.arch}` : `linux-${values.arch}`
    const dockerConfig = DOCKER_CONFIGS[configKey]
    if (!dockerConfig) {
      throw new Error(`No Docker configuration for ${configKey}`)
    }

    console.log('🐳 Building with Docker...')
    console.log(`   Creating Docker image for ${values.platform}-${values.arch}`)

    // Create Dockerfile
    const dockerfilePath = join(BUILD_DIR, 'Dockerfile')
    await writeFile(dockerfilePath, dockerConfig.dockerfile)

    // Build Docker image with platform flag if needed
    const buildArgs = ['build', '-t', `${values.platform}-${values.arch}-builder`, BUILD_DIR]
    if (dockerConfig.platform) {
      buildArgs.splice(1, 0, '--platform', dockerConfig.platform)
    }
    await runCommand('docker', buildArgs)

    // Run build in Docker
    console.log('   Running build in Docker container...')
    const runArgs = ['run', '--rm']
    if (dockerConfig.platform) {
      runArgs.push('--platform', dockerConfig.platform)
    }
    runArgs.push(
      '-v', `${ROOT_DIR}:/app`,
      `${values.platform}-${values.arch}-builder`,
      'npm', 'run', 'build:binary', '--',
      `--mode=${values.mode}`,
      `--output=/app/${output}`
    )
    await runCommand('docker', runArgs)

    console.log(`✅ Built with Docker: ${output}`)
    return
  }

  // Check for Windows cross-compilation attempt
  if (values.platform === 'win' && process.platform !== 'win32') {
    if (!process.env.GITHUB_ACTIONS) {
      console.error('❌ Cannot build Windows binaries from non-Windows host')
      console.error('   Please use GitHub Actions or a Windows machine')
      console.error('   See --help for more information')
      process.exitCode = 1
      return
    }
  }

  // Build based on mode
  try {
    if (values.mode === 'node-sea') {
      await buildWithNodeSea({
        platform: values.platform,
        arch: values.arch,
        output
      })
    } else {
      await buildWithYaoPkg({
        platform: values.platform,
        arch: values.arch,
        nodeVersion,
        output,
        isAlpine: values.platform === 'alpine'
      })
    }

    // Verify output
    if (existsSync(output)) {
      const { stat } = await import('node:fs/promises')
      const stats = await stat(output)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(1)

      console.log('\n📊 Build Summary')
      console.log('================')
      console.log(`Mode: ${values.mode}`)
      console.log(`Binary: ${output}`)
      console.log(`Size: ${sizeMB} MB`)
      console.log(`Platform: ${values.platform}`)
      console.log(`Architecture: ${values.arch}`)
      if (values.mode === 'yao-pkg') {
        console.log(`Node version: v${nodeVersion}`)
      }
    }
  } catch (error) {
    console.error('❌ Build failed:', error.message)
    process.exitCode = 1
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error)
}

export default main