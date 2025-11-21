/**
 * esbuild configuration for building shadow npm inject script.
 *
 * This builds the inject script that is loaded via --require flag
 * when spawning npm with shadow arborist.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { IMPORT_META_URL_BANNER } from 'build-infra/lib/esbuild-helpers'
import { build } from 'esbuild'

import {
  createDefineEntries,
  envVarReplacementPlugin,
  getInlinedEnvVars,
} from '../scripts/esbuild-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// Get all inlined environment variables from shared utility.
const inlinedEnvVars = getInlinedEnvVars()

const config = {
  entryPoints: [path.join(rootPath, 'src/shadow/npm/inject.mts')],
  bundle: true,
  outfile: path.join(rootPath, 'dist/shadow-npm-inject.js'),
  // Target Node.js environment (not browser).
  platform: 'node',
  // Target Node.js 18+ features.
  target: 'node18',
  format: 'cjs',

  // With platform: 'node', esbuild automatically externalizes all Node.js built-ins.
  // node-gyp is not external because:
  // 1. It's optionally resolved (returns undefined if not found).
  // 2. Users who need it will have it in their project dependencies.
  // 3. The published package should have zero runtime dependencies.
  external: [],

  // Suppress warnings for intentional CommonJS compatibility code.
  logOverride: {
    'commonjs-variable-in-esm': 'silent',
    'empty-import-meta': 'silent',
    'require-resolve-not-external': 'silent',
  },

  // Source maps off for production.
  sourcemap: false,

  // Don't minify (keep readable for debugging).
  minify: false,

  // Keep names for better stack traces.
  keepNames: true,

  // Plugin needs to transform output.
  write: false,

  // Define environment variables and import.meta.
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.url': '__importMetaUrl',
    // Inject build metadata using shared utility.
    ...createDefineEntries(inlinedEnvVars),
  },

  // Inject import.meta.url polyfill at top of bundle.
  banner: IMPORT_META_URL_BANNER,

  // Handle special cases with plugins.
  plugins: [envVarReplacementPlugin(inlinedEnvVars)],
}

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config)
    .then(result => {
      // Write the transformed output (build had write: false).
      if (result.outputFiles && result.outputFiles.length > 0) {
        for (const output of result.outputFiles) {
          writeFileSync(output.path, output.contents)
        }
      }
      console.log('Built shadow-npm-inject.js')
    })
    .catch(error => {
      console.error('Build failed:', error)
      process.exitCode = 1
    })
}

export default config
