/**
 * Build script for Socket npm wrapper bootstrap.
 *
 * Builds two versions:
 * 1. bootstrap.js - Standard version for SEA builds (uses node:* requires)
 * 2. bootstrap-smol.js - Transformed version for smol builds (uses internal/* requires)
 */

import { existsSync } from 'node:fs'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { spawn } from '@socketsecurity/lib/spawn'

import seaConfig from './esbuild.bootstrap.config.mjs'
import smolConfig from './esbuild.bootstrap-smol.config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')
const monorepoRoot = path.resolve(packageRoot, '../..')

// Ensure bootstrap package is built before building socket wrapper.
async function ensureBootstrapPackageBuilt() {
  const bootstrapSource = path.join(
    monorepoRoot,
    'packages/bootstrap/src/bootstrap-npm.mts'
  )
  const bootstrapDist = path.join(
    monorepoRoot,
    'packages/bootstrap/dist/bootstrap-npm.js'
  )

  // Check if bootstrap source and dist exist.
  if (!existsSync(bootstrapSource)) {
    console.error('✗ Bootstrap source not found:', bootstrapSource)
    process.exit(1)
  }

  // If dist exists, assume it's up to date.
  if (existsSync(bootstrapDist)) {
    return
  }

  console.log('→ Building @socketsecurity/bootstrap package (dependency)...\n')

  const result = await spawn(
    'pnpm',
    ['--filter', '@socketsecurity/bootstrap', 'run', 'build'],
    {
      cwd: monorepoRoot,
      shell: WIN32,
      stdio: 'inherit',
    }
  )

  if (result.code !== 0) {
    console.error('\n✗ Failed to build @socketsecurity/bootstrap')
    process.exit(1)
  }

  console.log('')
}

await ensureBootstrapPackageBuilt()

console.log('Building Socket npm wrapper bootstrap with esbuild...\n')

try {
  // Create dist directory.
  mkdirSync(path.join(packageRoot, 'dist'), { recursive: true })

  // Build standard version for SEA.
  console.log('→ Building standard bootstrap (SEA)...')
  const seaResult = await build(seaConfig)

  console.log(`✓ ${seaConfig.outfile}`)

  if (seaResult.metafile) {
    const outputSize = Object.values(seaResult.metafile.outputs)[0]?.bytes
    if (outputSize) {
      console.log(`  Size: ${(outputSize / 1024).toFixed(2)} KB`)
    }
  }

  // Build transformed version for smol.
  console.log('\n→ Building transformed bootstrap (smol)...')
  const smolResult = await build(smolConfig)

  // Write the transformed output (build had write: false).
  if (smolResult.outputFiles && smolResult.outputFiles.length > 0) {
    for (const output of smolResult.outputFiles) {
      writeFileSync(output.path, output.contents)
    }
  }

  console.log(`✓ ${smolConfig.outfile}`)

  if (smolResult.metafile) {
    const outputSize = Object.values(smolResult.metafile.outputs)[0]?.bytes
    if (outputSize) {
      console.log(`  Size: ${(outputSize / 1024).toFixed(2)} KB`)
    }
  }

  console.log('\n✓ Build completed successfully')
} catch (error) {
  console.error('\n✗ Build failed:', error)
  process.exit(1)
}
