#!/usr/bin/env node
/**
 * Pre-build script to bundle meow into a single self-contained file.
 * This bundled meow can then be imported by the main unified build.
 */

import { rollup } from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

/**
 * Find meow package directory dynamically.
 * Prioritizes patched versions and 14.x over older versions.
 */
function findMeowDir() {
  const pnpmDir = join(rootDir, 'node_modules/.pnpm')
  const dirs = readdirSync(pnpmDir)

  // Look for patched 14.x first.
  const patched14 = dirs.find(
    d => d.startsWith('meow@14.') && d.includes('patch_hash'),
  )
  if (patched14) {
    return join(pnpmDir, patched14, 'node_modules/meow')
  }

  // Then look for unpatched 14.x.
  const meow14 = dirs.find(
    d => d.startsWith('meow@14.') && !d.includes('patch_hash'),
  )
  if (meow14) {
    return join(pnpmDir, meow14, 'node_modules/meow')
  }

  // Fallback to any meow version.
  const meowDir = dirs.find(d => d.startsWith('meow@'))
  if (!meowDir) {
    throw new Error('Could not find meow package in node_modules/.pnpm')
  }
  return join(pnpmDir, meowDir, 'node_modules/meow')
}

const meowDir = findMeowDir()
const meowEntry = join(meowDir, 'build/index.js')
const outputPath = join(rootDir, 'external/meow-bundled.cjs')

console.log('Bundling meow into standalone file...')
console.log('  Input:', meowEntry)
console.log('  Output:', outputPath)

try {
  // Build meow as a standalone CJS bundle.
  const bundle = await rollup({
    input: meowEntry,
    // Don't externalize anything except Node.js built-ins.
    external: id => {
      // Externalize Node.js built-ins.
      return (
        /^node:/.test(id) ||
        [
          'path',
          'fs',
          'url',
          'util',
          'os',
          'process',
          'events',
          'stream',
        ].includes(id)
      )
    },
    plugins: [
      // Resolve all dependencies.
      nodeResolve({
        preferBuiltins: true,
        extensions: ['.js', '.mjs', '.cjs', '.json'],
      }),
      // Convert CommonJS modules.
      commonjs({
        defaultIsModuleExports: true,
        requireReturnsDefault: 'auto',
        ignoreDynamicRequires: true,
        extensions: ['.js', '.cjs'],
      }),
    ],
  })

  // Write the bundle.
  await bundle.write({
    file: outputPath,
    format: 'cjs',
    exports: 'default',
    interop: 'auto',
  })

  await bundle.close()

  console.log('✓ Successfully bundled meow')
  console.log(
    '  Output size:',
    (readFileSync(outputPath).length / 1024).toFixed(1),
    'KB',
  )
} catch (error) {
  console.error('Failed to bundle meow:', error.message)
  console.error(error.stack)
  process.exit(1)
}
