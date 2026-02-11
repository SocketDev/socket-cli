/**
 * Shared esbuild utilities for Socket CLI builds.
 * Contains helpers for environment variable inlining and build metadata.
 */

import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { EnvironmentVariables } from './environment-variables.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

/**
 * Create a standard index loader config.
 * @param {Object} options - Configuration options
 * @param {string} options.entryPoint - Path to entry point file
 * @param {string} options.outfile - Path to output file
 * @param {boolean} [options.minify=false] - Whether to minify output
 * @returns {Object} esbuild configuration object
 */
export function createIndexConfig({ entryPoint, minify = false, outfile }) {
  // Get inlined environment variables for build-time constant replacement.
  const inlinedEnvVars = getInlinedEnvVars()

  const config = {
    banner: {
      js: '#!/usr/bin/env node',
    },
    bundle: true,
    entryPoints: [entryPoint],
    external: [],
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18',
    treeShaking: true,
    // Define environment variables for inlining.
    define: {
      'process.env.NODE_ENV': '"production"',
      ...createDefineEntries(inlinedEnvVars),
    },
    // Add plugin for post-bundle env var replacement.
    plugins: [envVarReplacementPlugin(inlinedEnvVars)],
    // Plugin needs to transform output.
    write: false,
  }

  if (minify) {
    config.minify = true
  } else {
    config.minifyWhitespace = true
    config.minifyIdentifiers = true
    config.minifySyntax = false
  }

  return config
}

/**
 * Helper to create both dot and bracket notation define keys.
 * This ensures esbuild can replace both forms of process.env access.
 */
export function createDefineEntries(envVars) {
  const entries = {}
  for (const [key, value] of Object.entries(envVars)) {
    // Dot notation: process.env.KEY
    entries[`process.env.${key}`] = value
    // Bracket notation: process.env["KEY"]
    entries[`process.env["${key}"]`] = value
  }
  return entries
}

/**
 * esbuild plugin to replace env vars after bundling (handles mangled identifiers).
 * This is necessary because esbuild's define doesn't catch all forms after minification.
 */
export function envVarReplacementPlugin(envVars) {
  return {
    name: 'env-var-replacement',
    setup(build) {
      build.onEnd(result => {
        const outputs = result.outputFiles
        if (!outputs || outputs.length === 0) {
          return
        }

        for (const output of outputs) {
          let content = output.text

          // Replace all forms of process.env["KEY"] access, even with mangled identifiers.
          // Pattern: <anything>.env["KEY"] where <anything> could be "import_node_process21.default" etc.
          for (const [key, value] of Object.entries(envVars)) {
            // Match: <identifier>.env["KEY"] or <identifier>.env['KEY']
            const pattern = new RegExp(`(\\w+\\.)+env\\["${key}"\\]`, 'g')
            const singleQuotePattern = new RegExp(
              `(\\w+\\.)+env\\['${key}'\\]`,
              'g',
            )

            // Replace with the actual value (already JSON.stringified).
            content = content.replace(pattern, value)
            content = content.replace(singleQuotePattern, value)
          }

          // Update the output content.
          output.contents = Buffer.from(content, 'utf8')
        }
      })
    },
  }
}

/**
 * Get all inlined environment variables with their values.
 * This reads package.json metadata and computes derived values.
 *
 * @returns {Record<string, string>} Object with env var names as keys and JSON-stringified values
 */
export function getInlinedEnvVars() {
  // Delegate to unified EnvironmentVariables module.
  return EnvironmentVariables.getDefineEntries()
}

/**
 * Create a build runner function that executes esbuild config when run as main module.
 * This eliminates boilerplate code repeated across all esbuild config files.
 *
 * @param {Object} config - esbuild configuration object
 * @param {string} [description] - Optional description of what this build does
 * @returns {Object} The same config object (for chaining)
 *
 * @example
 * ```javascript
 * import { build } from 'esbuild'
 * import { createBuildRunner } from './esbuild-shared.mjs'
 *
 * const config = { ... }
 * export default createBuildRunner(config, 'CLI bundle')
 * ```
 */
export function createBuildRunner(config, description = 'Build') {
  // Only run if this file is the main module (executed directly).
  // This allows configs to be imported without side effects.
  if (
    fileURLToPath(import.meta.url) ===
    process.argv[1]?.replace(/\\/g, '/')
  ) {
    ;(async () => {
      try {
        // Import esbuild dynamically to avoid loading it during imports.
        const { build } = await import('esbuild')

        if (description) {
          console.log(`Building: ${description}`)
        }

        const result = await build(config)

        // If write: false, manually write outputFiles.
        if (result.outputFiles && result.outputFiles.length > 0) {
          const { writeFileSync } = await import('node:fs')
          const { dirname } = await import('node:path')
          const { mkdirSync } = await import('node:fs')

          for (const output of result.outputFiles) {
            // Ensure directory exists.
            mkdirSync(dirname(output.path), { recursive: true })
            // Write output file.
            writeFileSync(output.path, output.contents)
          }

          if (description) {
            console.log(`✓ ${description} complete`)
          }
        }
      } catch (error) {
        console.error(`Build failed: ${description || 'Unknown'}`)
        console.error(error)
        process.exitCode = 1
      }
    })()
  }

  return config
}
