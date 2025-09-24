#!/usr/bin/env node
/**
 * Script to publish Socket CLI SEA binaries.
 *
 * This script:
 * 1. Builds SEA binaries for all platforms
 * 2. Creates the npm package for binary distribution
 * 3. Uploads binaries to GitHub releases
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { normalizePath } from '@socketsecurity/registry/lib/path'
import { spawn } from '@socketsecurity/registry/lib/spawn'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

interface PublishOptions {
  version?: string
  platforms?: string[]
  skipBuild?: boolean
  skipGithub?: boolean
  skipNpm?: boolean
}

/**
 * Build SEA binaries for all platforms.
 */
async function buildBinaries(platforms?: string[]): Promise<void> {
  console.log('Building SEA binaries...')

  const args = ['run', 'build:sea']

  if (platforms && platforms.length > 0) {
    for (const platform of platforms) {
      // eslint-disable-next-line no-await-in-loop
      await spawn('pnpm', [...args, '--', `--platform=${platform}`], {
        stdio: 'inherit',
      })
    }
  } else {
    // Build all platforms.
    await spawn('pnpm', args, {
      stdio: 'inherit',
    })
  }
}

/**
 * Upload binaries to GitHub release.
 */
async function uploadToGitHub(version: string): Promise<void> {
  const seaDir = normalizePath(path.join(__dirname, '../../dist/sea'))

  if (!existsSync(seaDir)) {
    throw new Error('SEA binaries not found. Run build:sea first.')
  }

  // Check if GitHub CLI is available.
  try {
    await spawn('which', ['gh'], { stdio: 'ignore' })
  } catch {
    throw new Error(
      'GitHub CLI (gh) is required to upload binaries to GitHub releases.\n' +
        'Please install it: https://cli.github.com/',
    )
  }

  console.log(`Uploading binaries to GitHub release v${version}...`)

  // List binaries.
  const files = await fs.readdir(seaDir)
  const binaries = files.filter(f => f.startsWith('socket-'))

  if (binaries.length === 0) {
    throw new Error('No binaries found to upload.')
  }

  // Check if release exists.
  const releaseCheckResult = await spawn(
    'gh',
    ['release', 'view', `v${version}`, '--json', 'tagName'],
    { stdio: 'pipe' },
  )

  const releaseExists = releaseCheckResult['exitCode'] === 0

  if (!releaseExists) {
    // Create the release if it doesn't exist.
    console.log(`Creating release v${version}...`)
    await spawn(
      'gh',
      [
        'release',
        'create',
        `v${version}`,
        '--title',
        `v${version}`,
        '--notes',
        `Socket CLI v${version}\n\nSee [CHANGELOG.md](https://github.com/SocketDev/socket-cli/blob/main/CHANGELOG.md) for details.`,
        '--draft',
      ],
      { stdio: 'inherit' },
    )
  }

  // Upload each binary.
  for (const binary of binaries) {
    const binaryPath = normalizePath(path.join(seaDir, binary))
    console.log(`Uploading ${binary}...`)
    // eslint-disable-next-line no-await-in-loop
    await spawn(
      'gh',
      ['release', 'upload', `v${version}`, binaryPath, '--clobber'],
      { stdio: 'inherit' },
    )
  }

  console.log('Binaries uploaded to GitHub release.')
}

/**
 * Publish the npm package.
 */
async function publishNpmPackage(version: string): Promise<void> {
  const npmPackageDir = normalizePath(path.join(__dirname, 'npm-package'))
  const packageJsonPath = normalizePath(
    path.join(npmPackageDir, 'package.json'),
  )

  // Check if npm is available.
  try {
    await spawn('which', ['npm'], { stdio: 'ignore' })
  } catch {
    throw new Error(
      'npm is required to publish the package to the npm registry.\n' +
        'Please install Node.js and npm: https://nodejs.org/',
    )
  }

  // Update version in package.json.
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
  packageJson.version = version
  await fs.writeFile(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + '\n',
  )

  console.log(`Publishing socket@${version} to npm...`)

  // Publish to npm.
  await spawn('npm', ['publish', '--access=public'], {
    cwd: npmPackageDir,
    stdio: 'inherit',
  })

  console.log('Published to npm.')
}

/**
 * Parse command-line arguments.
 */
function parseArgs(): PublishOptions {
  const args = process.argv.slice(2)
  const options: PublishOptions = {}

  for (const arg of args) {
    if (arg.startsWith('--version=')) {
      options.version = arg.split('=')[1]!
    } else if (arg.startsWith('--platform=')) {
      const platform = arg.split('=')[1]
      if (platform) {
        options.platforms = options.platforms || []
        options.platforms.push(platform!)
      }
    } else if (arg === '--skip-build') {
      options.skipBuild = true
    } else if (arg === '--skip-github') {
      options.skipGithub = true
    } else if (arg === '--skip-npm') {
      options.skipNpm = true
    }
  }

  return options
}

/**
 * Main function.
 */
async function main(): Promise<void> {
  const options = parseArgs()

  // Get version from npm-package/package.json if not specified.
  const packageJsonPath = normalizePath(
    path.join(__dirname, 'npm-package/package.json'),
  )
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
  const version = options.version || packageJson.version

  console.log('Socket CLI SEA Publisher')
  console.log('========================')
  console.log(`Version: ${version}`)
  console.log()

  // Build binaries.
  if (!options.skipBuild) {
    await buildBinaries(options.platforms)
  }

  // The npm package downloads binaries from GitHub releases.

  // Upload to GitHub.
  if (!options.skipGithub) {
    await uploadToGitHub(version)
  }

  // Publish npm package.
  if (!options.skipNpm) {
    await publishNpmPackage(version)
  }

  console.log('\n✅ Publishing complete!')
}

// Run if executed directly.
if (import.meta.url === url.pathToFileURL(process.argv[1]!).href) {
  main().catch(error => {
    console.error('Publishing failed:', error)
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}

export { main }
