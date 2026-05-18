/**
 * Shared esbuild utilities for Socket CLI builds. Contains helpers for
 * environment variable inlining and build metadata.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BuildOptions, BuildResult, PluginBuild } from 'esbuild'

import { build } from 'esbuild'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { EnvironmentVariables } from './environment-variables.mts'

const logger = getDefaultLogger()

/**
 * Settings every Socket CLI esbuild config shares.
 *
 * Kept in one place so the target Node version, module format, minify default,
 * etc. can't drift between the index loader and the main CLI bundle. Callers
 * spread this and add variant-specific fields (entry points, output, banner,
 * plugins, extra defines).
 */
export function createBaseConfig(
  inlinedEnvVars: Record<string, string>,
): BuildOptions {
  return {
    bundle: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      ...createDefineEntries(inlinedEnvVars),
    },
    format: 'cjs',
    minify: false,
    platform: 'node',
    // We don't ship minified bundles and we don't ship sourcemaps for prod.
    sourcemap: false,
    target: 'node25',
    // Plugin writes are handled by `runBuild` so every caller's env-var
    // replacement can mutate output buffers before they hit disk.
    write: false,
  }
}

/**
 * Helper to create both dot and bracket notation define keys. This ensures
 * esbuild can replace both forms of process.env access.
 */
export function createDefineEntries(envVars: Record<string, string>) {
  const entries: Record<string, string> = {}
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [key, value] of Object.entries(envVars)) {
    // Dot notation: process.env.KEY
    entries[`process.env.${key}`] = value
    // Bracket notation: process.env["KEY"]
    entries[`process.env["${key}"]`] = value
  }
  return entries
}

/**
 * Create a standard index loader config.
 */
export function createIndexConfig({
  entryPoint,
  outfile,
}: {
  entryPoint: string
  outfile: string
}): BuildOptions {
  const inlinedEnvVars = getInlinedEnvVars()

  return {
    ...createBaseConfig(inlinedEnvVars),
    banner: {
      js: '#!/usr/bin/env node',
    },
    entryPoints: [entryPoint],
    outfile,
    plugins: [envVarReplacementPlugin(inlinedEnvVars)],
  }
}

/**
 * Esbuild plugin to replace env vars after bundling (handles mangled
 * identifiers). This is necessary because esbuild's define doesn't catch all
 * forms after minification.
 */
export function envVarReplacementPlugin(envVars: Record<string, string>) {
  return {
    name: 'env-var-replacement',
    setup(build: PluginBuild) {
      build.onEnd((result: BuildResult) => {
        const outputs = result.outputFiles
        if (!outputs || outputs.length === 0) {
          return
        }

        for (let i = 0, { length } = outputs; i < length; i += 1) {
          const output = outputs[i]
          let content = output.text

          // Replace all forms of process.env["KEY"] access, even with mangled identifiers.
          // Pattern: <anything>.env["KEY"] where <anything> could be "import_node_process21.default" etc.
          // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
 * Get all inlined environment variables with their values. This reads
 * package.json metadata and computes derived values.
 *
 * @returns {Record<string, string>} Object with env var names as keys and
 *   JSON-stringified values.
 */
export function getInlinedEnvVars() {
  // Delegate to unified EnvironmentVariables module.
  return EnvironmentVariables.getDefineEntries()
}

/**
 * Run an esbuild config, writing output files if write: false.
 *
 * @param {Object} config - Esbuild configuration object.
 * @param {string} [description] - Description logged before/after build.
 */
export async function runBuild(config: BuildOptions, description = 'Build') {
  try {
    if (description) {
      logger.info(`Building: ${description}`)
    }

    const result = await build(config)

    // If write: false, manually write outputFiles.
    if (result.outputFiles && result.outputFiles.length > 0) {
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
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
    throw e
  }
}
