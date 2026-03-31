/**
 * Shared esbuild utilities for Socket CLI builds.
 * Contains helpers for environment variable inlining and build metadata.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { EnvironmentVariables } from './environment-variables.mjs'

const logger = getDefaultLogger()

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
    format: 'cjs',
    outfile,
    platform: 'node',
    // Source maps off for entry point production build.
    sourcemap: false,
    target: 'node18',
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
 * Run an esbuild config, writing output files if write: false.
 *
 * @param {Object} config - esbuild configuration object
 * @param {string} [description] - Description logged before/after build
 */
export async function runBuild(config, description = 'Build') {
  try {
    if (description) {
      logger.info(`Building: ${description}`)
    }

    const result = await build(config)

    // If write: false, manually write outputFiles.
    if (result.outputFiles && result.outputFiles.length > 0) {
      for (const output of result.outputFiles) {
        mkdirSync(path.dirname(output.path), { recursive: true })
        writeFileSync(output.path, output.contents)
      }

      if (description) {
        logger.success(`${description} complete`)
      }
    }
  } catch (e) {
    logger.error(`Build failed: ${description || 'Unknown'}`)
    logger.error(e)
    process.exitCode = 1
  }
}
