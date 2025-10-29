#!/usr/bin/env node
/**
 * Build script for Socket bootstrap package.
 *
 * Builds two versions:
 * 1. bootstrap-npm.js - Standard version for npm wrapper
 * 2. bootstrap-smol.js - Transformed version for smol binary
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import npmConfig from '../.config/esbuild.npm.config.mjs'
import smolConfig from '../.config/esbuild.smol.config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

console.log('Building Socket bootstrap with esbuild...\\n')

try {
  // Create dist directory.
  mkdirSync(path.join(packageRoot, 'dist'), { recursive: true })

  // Build npm version.
  console.log('→ Building npm bootstrap...')
  const npmResult = await build(npmConfig)

  // Write the transformed output (build had write: false).
  if (npmResult.outputFiles && npmResult.outputFiles.length > 0) {
    for (const output of npmResult.outputFiles) {
      writeFileSync(output.path, output.contents)
    }
  }

  console.log(`✓ ${npmConfig.outfile}`)

  if (npmResult.metafile) {
    const outputSize = Object.values(npmResult.metafile.outputs)[0]?.bytes
    if (outputSize) {
      console.log(`  Size: ${(outputSize / 1024).toFixed(2)} KB`)
    }
  }

  // Build smol version.
  console.log('\\n→ Building smol bootstrap...')
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

  console.log('\\n✓ Build completed successfully')
} catch (error) {
  console.error('\\n✗ Build failed:', error)
  process.exit(1)
}
