#!/usr/bin/env node

/**
 * Platform binary build orchestration script.
 * Builds all or specific platform binaries in parallel or sequence.
 */

import { spawn } from 'node:child_process'
import process from 'node:process'

const PLATFORMS = [
  'alpine-arm64',
  'alpine-x64',
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64'
]

const args = process.argv.slice(2)
let parallel = false
let platforms = []
const buildFlags = []

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--parallel') {
    parallel = true
  } else if (arg === '--platforms') {
    const platformsArg = args[++i]
    platforms = platformsArg.split(',').map(p => p.trim())
  } else {
    buildFlags.push(arg)
  }
}

if (!platforms.length) {
  platforms = PLATFORMS
}

// Validate platforms.
for (const platform of platforms) {
  if (!PLATFORMS.includes(platform)) {
    console.error(`Unknown platform: ${platform}`)
    console.error(`Available platforms: ${PLATFORMS.join(', ')}`)
    process.exit(1)
  }
}

console.log(`Building ${platforms.length} platform(s): ${platforms.join(', ')}`)
console.log(`Mode: ${parallel ? 'parallel' : 'sequential'}`)
if (buildFlags.length) {
  console.log(`Build flags: ${buildFlags.join(' ')}`)
}
console.log('')

/**
 * Build a single platform.
 */
function buildPlatform(platform) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    console.log(`[${platform}] Starting build...`)

    const pnpmArgs = ['run', 'build', '--', '--target', platform, ...buildFlags]
    const child = spawn('pnpm', pnpmArgs, {
      encoding: 'utf8',
      shell: false,
      stdio: 'pipe'
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', data => {
      stdout += data
    })

    child.stderr?.on('data', data => {
      stderr += data
    })

    child.on('close', code => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)

      if (code === 0) {
        console.log(`[${platform}] ✓ Build succeeded (${duration}s)`)
        resolve({ platform, code, duration, stdout, stderr })
      } else {
        console.error(`[${platform}] ✗ Build failed (${duration}s)`)
        if (stderr) {
          console.error(`[${platform}] Error output:`)
          console.error(stderr)
        }
        reject(new Error(`Platform ${platform} build failed with code ${code}`))
      }
    })

    child.on('error', error => {
      console.error(`[${platform}] ✗ Build error:`, error)
      reject(error)
    })
  })
}

/**
 * Build platforms sequentially.
 */
async function buildSequential() {
  const results = []
  for (const platform of platforms) {
    try {
      const result = await buildPlatform(platform)
      results.push(result)
    } catch (error) {
      console.error(`\nBuild failed at platform: ${platform}`)
      process.exit(1)
    }
  }
  return results
}

/**
 * Build platforms in parallel.
 */
async function buildParallel() {
  const promises = platforms.map(platform => buildPlatform(platform))
  try {
    return await Promise.all(promises)
  } catch (error) {
    console.error('\nOne or more platform builds failed')
    process.exit(1)
  }
}

// Execute builds.
const buildFn = parallel ? buildParallel : buildSequential
const startTime = Date.now()

buildFn()
  .then(results => {
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`\n✓ All ${results.length} platform(s) built successfully in ${totalDuration}s`)
    process.exit(0)
  })
  .catch(error => {
    console.error('\nBuild orchestration failed:', error.message)
    process.exit(1)
  })
