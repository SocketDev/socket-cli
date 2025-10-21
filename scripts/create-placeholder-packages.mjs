/**
 * @fileoverview Creates minimal placeholder packages for @socketbin/* to enable trusted publisher.
 * These are version 0.0.0 packages that will be replaced with real binaries later.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const platforms = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'win32', arch: 'arm64' },
  { platform: 'win32', arch: 'x64' },
]

async function createPlaceholderPackage(platform, arch) {
  const packageName = `@socketbin/cli-${platform}-${arch}`
  const packageDir = path.join(
    rootDir,
    'packages',
    'placeholders',
    `cli-${platform}-${arch}`,
  )

  // Create directory structure
  await fs.mkdir(path.join(packageDir, 'bin'), { recursive: true })

  // Create minimal package.json
  const packageJson = {
    name: packageName,
    version: '0.0.0',
    description: `Placeholder for Socket CLI binary (${platform}-${arch}). Real package coming soon.`,
    keywords: ['socket', 'cli', 'binary', 'placeholder', platform, arch],
    homepage: 'https://github.com/SocketDev/socket-cli',
    repository: {
      type: 'git',
      url: 'git+https://github.com/SocketDev/socket-cli.git',
    },
    license: 'MIT',
    author: {
      name: 'Socket Inc',
      email: 'eng@socket.dev',
      url: 'https://socket.dev',
    },
    // Restrict to correct platform
    os: [platform === 'darwin' ? 'darwin' : platform],
    cpu: [arch],
    files: ['README.md', 'bin'],
    publishConfig: {
      access: 'public',
    },
  }

  // Create placeholder binary script
  const binaryExt = platform === 'win32' ? '.cmd' : ''
  const binaryName = `cli${binaryExt}`
  const binaryContent =
    platform === 'win32'
      ? `@echo off
echo Socket CLI placeholder for ${platform}-${arch}
echo Please wait for the real package to be published.
echo Visit https://github.com/SocketDev/socket-cli for more info.
exit /b 1
`
      : `#!/usr/bin/env node
console.error('Socket CLI placeholder for ${platform}-${arch}');
console.error('Please wait for the real package to be published.');
console.error('Visit https://github.com/SocketDev/socket-cli for more info.');
process.exit(1);
`

  // Create README
  const readme = `# ${packageName}

⚠️ **PLACEHOLDER PACKAGE**

This is a placeholder package to reserve the namespace for Socket CLI binaries.

The real package with the actual binary will be published soon.

## What is this?

This package will contain the Socket CLI binary for ${platform} ${arch}.

## Installation

Once the real package is available, it will be installed automatically as part of:

\`\`\`bash
npm install -g socket
\`\`\`

## More Information

- Repository: https://github.com/SocketDev/socket-cli
- Issues: https://github.com/SocketDev/socket-cli/issues
- Socket: https://socket.dev

---

*Placeholder package v0.0.0 - Real binary coming soon*
`

  // Write files
  await fs.writeFile(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  )

  await fs.writeFile(path.join(packageDir, 'README.md'), readme)

  await fs.writeFile(path.join(packageDir, 'bin', binaryName), binaryContent)

  // Make script executable on Unix
  if (platform !== 'win32') {
    await fs.chmod(path.join(packageDir, 'bin', binaryName), 0o755)
  }

  console.log(`✓ Created placeholder: ${packageName}`)
  return packageDir
}

async function main() {
  console.log('Creating @socketbin placeholder packages...\n')

  const packageDirs = []
  for (const { arch, platform } of platforms) {
    const dir = await createPlaceholderPackage(platform, arch)
    packageDirs.push(dir)
  }

  console.log('\n📦 Placeholder packages created!\n')
  console.log('To publish them:')
  console.log('1. Sign in as socket-bot: npm login')
  console.log(
    '2. Run the publish script: node scripts/publish-placeholders.mjs',
  )
  console.log('\nOr publish individually:')

  for (const dir of packageDirs) {
    const relativePath = path.relative(rootDir, dir)
    console.log(`  cd ${relativePath} && npm publish --access public`)
  }

  // Create convenience publish script
  const publishScript = `#!/usr/bin/env node

/**
 * Publishes all placeholder packages to npm.
 * Run after signing in with: npm login
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const packages = [
  'cli-darwin-arm64',
  'cli-darwin-x64',
  'cli-linux-arm64',
  'cli-linux-x64',
  'cli-win32-arm64',
  'cli-win32-x64'
]

async function publishPackage(name) {
  const packageDir = path.join(rootDir, 'packages', 'placeholders', name)

  console.log(\`Publishing @socketbin/\${name}...\`)

  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['publish', '--access', 'public'], {
      cwd: packageDir,
      stdio: 'inherit'
    })

    child.on('exit', code => {
      if (code === 0) {
        console.log(\`✓ Published @socketbin/\${name}\\n\`)
        resolve()
      } else {
        reject(new Error(\`Failed to publish \${name}\`))
      }
    })
  })
}

async function main() {
  console.log('🚀 Publishing @socketbin placeholder packages...\\n')
  console.log('Make sure you are logged in as socket-bot!\\n')

  try {
    for (const pkg of packages) {
      await publishPackage(pkg)
    }

    console.log('\\n✅ All placeholder packages published!')
    console.log('\\nNext steps:')
    console.log('1. Go to https://www.npmjs.com/settings/socketbin/integrations')
    console.log('2. Add trusted publisher for SocketDev/socket-cli')
    console.log('3. Reference workflow: .github/workflows/publish-socketbin.yml')
  } catch (error) {
    console.error('\\n❌ Error:', error.message)
    process.exit(1)
  }
}

main()
`

  await fs.writeFile(
    path.join(rootDir, 'scripts', 'publish-placeholders.mjs'),
    publishScript,
  )

  await fs.chmod(
    path.join(rootDir, 'scripts', 'publish-placeholders.mjs'),
    0o755,
  )

  console.log('\n✅ Created publish script: scripts/publish-placeholders.mjs')
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
