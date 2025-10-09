
/**
 * @fileoverview Create placeholder packages for @socketbin Alpine platforms
 *
 * This script creates initial 0.0.0 placeholder packages for Alpine Linux platforms
 * to reserve the npm package names for future binary distributions.
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, '..')
const PLACEHOLDER_DIR = path.join(ROOT_DIR, 'build', 'placeholders')

/**
 * Alpine platform configurations for Docker containers
 */
const ALPINE_PLATFORMS = {
  'alpine-x64': {
    name: 'Alpine Linux x64 (musl libc)',
    package: '@socketbin/cli-alpine-x64',
    description: 'Placeholder for Socket CLI binary (alpine-x64). Real package coming soon.',
    os: 'linux',
    cpu: 'x64',
    libc: 'musl',
    dockerNotes: 'Optimized for Alpine Linux Docker containers',
  },
  'alpine-arm64': {
    name: 'Alpine Linux ARM64 (musl libc)',
    package: '@socketbin/cli-alpine-arm64',
    description: 'Placeholder for Socket CLI binary (alpine-arm64). Real package coming soon.',
    os: 'linux',
    cpu: 'arm64',
    libc: 'musl',
    dockerNotes: 'Optimized for Alpine Linux ARM64 Docker containers',
  },
}

/**
 * Create a placeholder package
 */
async function createPlaceholderPackage(platformKey, config) {
  const packageDir = path.join(PLACEHOLDER_DIR, config.package)

  console.log(`\n📦 Creating placeholder for ${config.name}...`)

  // Create directory
  await fs.mkdir(packageDir, { recursive: true })

  // Create package.json
  const packageJson = {
    name: config.package,
    version: '0.0.0',
    description: config.description,
    keywords: [
      'socket',
      'cli',
      'security',
      'binary',
      'placeholder',
      'alpine',
      'docker',
      'musl',
      config.cpu,
    ],
    author: 'Socket Inc.',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/SocketDev/socket-cli.git',
      directory: 'packages/binaries',
    },
    homepage: 'https://github.com/SocketDev/socket-cli',
    bugs: {
      url: 'https://github.com/SocketDev/socket-cli/issues',
    },
    files: ['README.md', 'index.js'],
    main: 'index.js',
    os: [config.os],
    cpu: [config.cpu],
    libc: config.libc ? [config.libc] : undefined,
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
      placeholder: true,
      dockerSupport: true,
      notes: config.dockerNotes,
    },
  }

  await fs.writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n'
  )

  // Create README.md
  const readme = `# ${config.package}

${config.description}

## ⚠️ Placeholder Package

This is a placeholder package to reserve the npm package name for the Socket CLI binary distribution for ${config.name}.

The real binary package will be published soon and will include:
- Standalone executable for ${config.name}
- No Node.js runtime required
- Optimized for Alpine Linux Docker containers
- Built with musl libc for maximum compatibility

## Docker Support

This package is specifically designed for Alpine Linux Docker containers, which use musl libc instead of glibc. This makes the binaries smaller and more suitable for containerized environments.

### Example Dockerfile

\`\`\`dockerfile
FROM alpine:latest

# Install the Socket CLI (when available)
RUN npm install -g ${config.package}

# Use Socket CLI
RUN socket --version
\`\`\`

## Platform Details

- **Operating System:** Alpine Linux
- **Architecture:** ${config.cpu}
- **C Library:** musl libc
- **Docker:** Optimized for containerized environments
- **Use Cases:** Docker containers, Kubernetes pods, lightweight distributions

## Coming Soon

The actual binary package will be published when ready. Follow the repository for updates:
https://github.com/SocketDev/socket-cli

## Why Alpine/musl Support?

Alpine Linux is the most popular base image for Docker containers due to:
- Small size (5MB base image)
- Security-focused design
- musl libc instead of glibc
- Minimal attack surface

Socket CLI Alpine binaries will be specifically built for this environment.

## License

MIT © Socket Inc.
`

  await fs.writeFile(path.join(packageDir, 'README.md'), readme)

  // Create placeholder index.js
  const indexJs = `/**
 * ${config.package} - Placeholder
 *
 * This is a placeholder package for the Socket CLI binary for ${config.name}.
 * The actual binary package will be published soon.
 */

console.error('');
console.error('========================================');
console.error('  ${config.package}');
console.error('  PLACEHOLDER PACKAGE');
console.error('========================================');
console.error('');
console.error('This is a placeholder package.');
console.error('The actual Socket CLI binary for ${config.name}');
console.error('will be published soon.');
console.error('');
console.error('For updates, visit:');
console.error('https://github.com/SocketDev/socket-cli');
console.error('');

process.exit(1);
`

  await fs.writeFile(path.join(packageDir, 'index.js'), indexJs)

  console.log(`   ✅ Created placeholder package: ${config.package}`)

  return packageDir
}

/**
 * Publish placeholder package
 */
async function publishPackage(packageDir, options = {}) {
  const { dryRun = false, otp } = options
  const packageJson = JSON.parse(
    await fs.readFile(path.join(packageDir, 'package.json'), 'utf8')
  )

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
    const { cwd = ROOT_DIR } = options

    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
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
 * Main function
 */
async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': {
        type: 'boolean',
        default: false,
      },
      'skip-publish': {
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
Socket CLI Alpine Placeholder Creator
======================================

Creates and publishes placeholder packages for Alpine Linux platforms.

Usage: node scripts/create-placeholder-packages.mjs [options]

Options:
  --dry-run        Perform dry-run without publishing
  --skip-publish   Create packages but don't publish
  --otp=CODE       npm OTP for publishing
  --help           Show this help

Platforms:
  @socketbin/cli-alpine-x64    Alpine Linux x64 (musl libc)
  @socketbin/cli-alpine-arm64  Alpine Linux ARM64 (musl libc)

Purpose:
  These placeholder packages reserve the npm package names for future
  Socket CLI binary distributions optimized for Alpine Linux and Docker
  containers using musl libc instead of glibc.

Example:
  # Create and publish placeholders
  node scripts/create-placeholder-packages.mjs

  # Dry run
  node scripts/create-placeholder-packages.mjs --dry-run

  # Create without publishing
  node scripts/create-placeholder-packages.mjs --skip-publish

  # With OTP
  node scripts/create-placeholder-packages.mjs --otp=123456

Note:
  These are 0.0.0 placeholder packages. The actual binary packages
  will be published when Alpine/musl support is implemented.
`)
    process.exit(0)
  }

  console.log('🚀 Socket CLI Alpine Placeholder Creator')
  console.log('=========================================\n')

  console.log('Creating placeholder packages for Alpine Linux platforms.')
  console.log('These reserve the npm package names for future binary distributions.\n')

  try {
    const packages = []

    // Create placeholder packages
    console.log('📦 Creating placeholder packages...')

    for (const [platformKey, config] of Object.entries(ALPINE_PLATFORMS)) {
      const packageDir = await createPlaceholderPackage(platformKey, config)
      packages.push(packageDir)
    }

    // Publish if requested
    if (!values['skip-publish']) {
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

      if (failCount > 0) {
        process.exit(1)
      }
    } else {
      console.log('\n⏭️  Skipping publish (--skip-publish flag set)')
      console.log(`\nPackages created in: ${PLACEHOLDER_DIR}`)
    }

    console.log('\n✅ Done!')
    console.log('\nNext steps:')
    console.log('1. These placeholders are now published (or ready to publish)')
    console.log('2. When Alpine/musl binary support is ready, use publish-yao.mjs or publish-sea.mjs')
    console.log('3. The real binaries will replace these placeholders with actual functionality')

  } catch (error) {
    console.error('\n❌ Failed:', error.message)
    process.exit(1)
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error)
}

export default main