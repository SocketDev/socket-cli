#!/usr/bin/env node
/**
 * @fileoverview Validates that esbuild configuration has minify: false.
 * Minification breaks ESM/CJS interop and makes debugging harder.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

/**
 * Validate esbuild configuration has minify: false.
 */
async function validateEsbuildMinify() {
  const configPath = path.join(rootPath, '.config/esbuild.config.mjs')

  try {
    // Dynamic import of the esbuild config
    const config = await import(configPath)

    const violations = []

    // Check buildConfig
    if (config.buildConfig) {
      if (config.buildConfig.minify !== false) {
        violations.push({
          config: 'buildConfig',
          value: config.buildConfig.minify,
          message: 'buildConfig.minify must be false',
          location: `${configPath}:212`,
        })
      }
    }

    // Check watchConfig
    if (config.watchConfig) {
      if (config.watchConfig.minify !== false) {
        violations.push({
          config: 'watchConfig',
          value: config.watchConfig.minify,
          message: 'watchConfig.minify must be false',
          location: `${configPath}:248`,
        })
      }
    }

    return violations
  } catch (error) {
    console.error(`Failed to load esbuild config: ${error.message}`)
    process.exitCode = 1
    return []
  }
}

async function main() {
  const violations = await validateEsbuildMinify()

  if (violations.length === 0) {
    console.log('✓ esbuild minify validation passed')
    process.exitCode = 0
    return
  }

  console.error('❌ esbuild minify validation failed\n')

  for (const violation of violations) {
    console.error(`  ${violation.message}`)
    console.error(`  Found: minify: ${violation.value}`)
    console.error('  Expected: minify: false')
    console.error(`  Location: ${violation.location}`)
    console.error('')
  }

  console.error(
    'Minification breaks ESM/CJS interop and makes debugging harder.',
  )
  console.error('')

  process.exitCode = 1
}

main().catch(error => {
  console.error('Validation failed:', error)
  process.exitCode = 1
})
