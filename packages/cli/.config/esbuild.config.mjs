/**
 * Unified esbuild configuration orchestrator for Socket CLI.
 * Supports building all variants by delegating to individual config files.
 *
 * Usage:
 *   node .config/esbuild.config.mjs [variant]
 *   node .config/esbuild.config.mjs cli      # Build CLI bundle
 *   node .config/esbuild.config.mjs index    # Build index loader
 *   node .config/esbuild.config.mjs inject   # Build shadow npm inject
 *   node .config/esbuild.config.mjs all      # Build all variants
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import cliConfig from './esbuild.cli.build.mjs'
import indexConfig from './esbuild.index.config.mjs'
import injectConfig from './esbuild.inject.config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Config mapping for each build variant (exports for programmatic use).
 */
export const CONFIGS = {
  __proto__: null,
  cli: cliConfig,
  index: indexConfig,
  inject: injectConfig,
}

/**
 * Config file paths for each build variant.
 */
const VARIANT_FILES = {
  __proto__: null,
  all: null, // Special variant to build all.
  cli: path.join(__dirname, 'esbuild.cli.build.mjs'),
  index: path.join(__dirname, 'esbuild.index.config.mjs'),
  inject: path.join(__dirname, 'esbuild.inject.config.mjs'),
}

/**
 * Build a single variant by executing its config file.
 */
async function buildVariant(name, configPath) {
  return new Promise(resolve => {
    const child = spawn('node', [configPath], { stdio: 'inherit' })

    child.on('close', code => {
      if (code === 0) {
        resolve({ name, ok: true })
      } else {
        resolve({ name, ok: false })
      }
    })
  })
}

/**
 * Build all variants in parallel.
 */
async function buildAll() {
  const variants = ['cli', 'index', 'inject']
  const results = await Promise.all(
    variants.map(name => buildVariant(name, VARIANT_FILES[name])),
  )

  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) {
    console.error(`\n${failed.length} build(s) failed:`)
    for (const { name } of failed) {
      console.error(`  - ${name}`)
    }
    process.exitCode = 1
  } else {
    console.log(`\n✔ All ${results.length} builds succeeded`)
  }
}

/**
 * Main entry point.
 */
async function main() {
  const variant = process.argv[2] || 'all'

  if (!(variant in VARIANT_FILES)) {
    console.error(`Unknown variant: ${variant}`)
    console.error(
      `Available variants: ${Object.keys(VARIANT_FILES).join(', ')}`,
    )
    process.exitCode = 1
    return
  }

  if (variant === 'all') {
    await buildAll()
  } else {
    const result = await buildVariant(variant, VARIANT_FILES[variant])
    if (!result.ok) {
      process.exitCode = 1
    }
  }
}

// Run if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error('Build failed:', error)
    process.exitCode = 1
  })
}

export default CONFIGS
