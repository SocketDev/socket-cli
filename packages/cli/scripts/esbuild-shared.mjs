/**
 * Shared esbuild utilities for Socket CLI builds.
 * Contains helpers for environment variable inlining and build metadata.
 */

import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

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
  // Read package.json for metadata.
  const packageJson = JSON.parse(
    readFileSync(path.join(rootPath, 'package.json'), 'utf-8'),
  )

  // Read version from socket package (the published package).
  const socketPackageJson = JSON.parse(
    readFileSync(path.join(rootPath, '../socket/package.json'), 'utf-8'),
  )

  // Get current git commit hash.
  let gitHash = ''
  try {
    gitHash = execSync('git rev-parse --short HEAD', {
      cwd: rootPath,
      encoding: 'utf-8',
    }).trim()
  } catch {}

  // Get dependency versions from package.json devDependencies.
  const synpVersion = packageJson.devDependencies?.['synp'] || ''

  // Get external tool versions from package.json externalTools.
  const cdxgenVersion =
    packageJson.externalTools?.['@cyclonedx/cdxgen']?.version || ''
  const coanaVersion =
    packageJson.externalTools?.['@coana-tech/cli']?.version || ''
  const pyCliVersion =
    packageJson.externalTools?.['socketsecurity']?.version || ''
  const pythonBuildTag = packageJson.externalTools?.['python']?.buildTag || ''
  const pythonVersion = packageJson.externalTools?.['python']?.version || ''
  const sfwVersion = packageJson.externalTools?.['sfw']?.version || ''

  // Build-time constants that can be overridden by environment variables.
  const publishedBuild =
    process.env['INLINED_SOCKET_CLI_PUBLISHED_BUILD'] === '1'
  const legacyBuild = process.env['INLINED_SOCKET_CLI_LEGACY_BUILD'] === '1'
  const sentryBuild = process.env['INLINED_SOCKET_CLI_SENTRY_BUILD'] === '1'

  // Compute version hash (matches Rollup implementation).
  const randUuidSegment = randomUUID().split('-')[0]
  const versionHash = `${packageJson.version}:${gitHash}:${randUuidSegment}${
    publishedBuild ? '' : ':dev'
  }`

  // Return all environment variables as JSON-stringified values.
  return {
    INLINED_SOCKET_CLI_VERSION: JSON.stringify(socketPackageJson.version),
    INLINED_SOCKET_CLI_VERSION_HASH: JSON.stringify(versionHash),
    INLINED_SOCKET_CLI_NAME: JSON.stringify(packageJson.name),
    INLINED_SOCKET_CLI_HOMEPAGE: JSON.stringify(packageJson.homepage),
    INLINED_SOCKET_CLI_CDXGEN_VERSION: JSON.stringify(cdxgenVersion),
    INLINED_SOCKET_CLI_COANA_VERSION: JSON.stringify(coanaVersion),
    INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION: JSON.stringify(cdxgenVersion),
    INLINED_SOCKET_CLI_PYCLI_VERSION: JSON.stringify(pyCliVersion),
    INLINED_SOCKET_CLI_SFW_VERSION: JSON.stringify(sfwVersion),
    INLINED_SOCKET_CLI_SYNP_VERSION: JSON.stringify(synpVersion),
    INLINED_SOCKET_CLI_PUBLISHED_BUILD: JSON.stringify(
      publishedBuild ? '1' : '',
    ),
    INLINED_SOCKET_CLI_LEGACY_BUILD: JSON.stringify(legacyBuild ? '1' : ''),
    INLINED_SOCKET_CLI_SENTRY_BUILD: JSON.stringify(sentryBuild ? '1' : ''),
    INLINED_SOCKET_CLI_PYTHON_VERSION: JSON.stringify(pythonVersion),
    INLINED_SOCKET_CLI_PYTHON_BUILD_TAG: JSON.stringify(pythonBuildTag),
  }
}
