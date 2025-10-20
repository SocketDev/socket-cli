/**
 * @fileoverview Generates package.json for @socketbin/* binary packages.
 * Used in CI to create the package structure for each platform binary.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib/argv/parse'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    arch: { type: 'string' },
    version: { type: 'string' },
    tool: { type: 'string', default: 'cli' },
    outdir: { type: 'string' },
  },
})

const { arch, outdir, platform, tool = 'cli', version } = values

if (!platform || !arch || !version) {
  console.error(
    'Usage: generate-binary-package.mjs --platform=darwin --arch=arm64 --version=1.1.24',
  )
  process.exit(1)
}

// Clean version (remove 'v' prefix if present)
const cleanVersion = version.replace(/^v/, '')

// Determine output directory
const packageDir =
  outdir ||
  path.join(rootDir, 'packages', 'binaries', `${tool}-${platform}-${arch}`)

// Platform display names
const platformNames = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
}

const archNames = {
  x64: 'x64',
  arm64: 'ARM64',
}

// Binary name (with .exe for Windows)
const binaryName = platform === 'win32' ? `${tool}.exe` : tool

// Package.json content
const packageJson = {
  name: `@socketbin/${tool}-${platform}-${arch}`,
  version: cleanVersion,
  description: `Socket ${tool.toUpperCase()} binary for ${platformNames[platform]} ${archNames[arch]}`,
  keywords: [
    'socket',
    tool,
    'binary',
    platform,
    arch,
    platformNames[platform].toLowerCase(),
  ],
  homepage: 'https://github.com/SocketDev/socket-cli',
  repository: {
    type: 'git',
    url: 'git+https://github.com/SocketDev/socket-cli.git',
    directory: `packages/binaries/${tool}-${platform}-${arch}`,
  },
  license: 'MIT',
  author: {
    name: 'Socket Inc',
    email: 'eng@socket.dev',
    url: 'https://socket.dev',
  },
  // Restrict installation to correct platform
  os: [platform === 'darwin' ? 'darwin' : platform],
  cpu: [arch],
  // Binary field for npm to handle
  bin: {
    [`socket-${tool}-binary`]: `bin/${binaryName}`,
  },
  // Files to include in package
  files: ['bin', 'README.md'],
  // Publish configuration
  publishConfig: {
    access: 'public',
    provenance: true,
  },
}

// README content
const readme = `# @socketbin/${tool}-${platform}-${arch}

Platform-specific binary for Socket ${tool.toUpperCase()}.

## Platform
- **OS**: ${platformNames[platform]}
- **Architecture**: ${archNames[arch]}

## Installation

This package is automatically installed as an optional dependency of the main \`socket\` package:

\`\`\`bash
npm install -g socket
\`\`\`

You shouldn't install this package directly unless you're debugging platform-specific issues.

## Binary Location

The binary is located at:
\`\`\`
node_modules/@socketbin/${tool}-${platform}-${arch}/bin/${binaryName}
\`\`\`

## Issues

Report issues at: https://github.com/SocketDev/socket-cli/issues

## License

MIT - See [LICENSE](https://github.com/SocketDev/socket-cli/blob/main/LICENSE)
`

// Create package directory structure
async function generatePackage() {
  try {
    // Ensure directories exist
    await fs.mkdir(path.join(packageDir, 'bin'), { recursive: true })

    // Write package.json
    await fs.writeFile(
      path.join(packageDir, 'package.json'),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    )
    console.log(`Created: ${packageDir}/package.json`)

    // Write README
    await fs.writeFile(path.join(packageDir, 'README.md'), readme)
    console.log(`Created: ${packageDir}/README.md`)

    // Check if binary exists and copy it
    const sourceBinary = path.join(
      rootDir,
      'dist',
      'sea',
      `socket-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`,
    )
    const targetBinary = path.join(packageDir, 'bin', binaryName)

    try {
      await fs.copyFile(sourceBinary, targetBinary)
      // Make executable on Unix
      if (platform !== 'win32') {
        await fs.chmod(targetBinary, 0o755)
      }
      console.log(`Copied binary: ${sourceBinary} -> ${targetBinary}`)
    } catch {
      console.warn(`Warning: Binary not found at ${sourceBinary}`)
      console.warn('Binary should be copied manually or in CI')
    }

    console.log(`\nPackage generated successfully at: ${packageDir}`)
    console.log(
      `\nTo publish:\n  cd ${packageDir}\n  npm publish --provenance --access public`,
    )
  } catch (error) {
    console.error('Error generating package:', error)
    process.exit(1)
  }
}

generatePackage()
