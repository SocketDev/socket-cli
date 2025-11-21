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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const cliPath = path.join(__dirname, '..', '..', 'cli')

const config = {
  entryPoints: [path.join(cliPath, 'src/shadow/npm/inject.mts')],
  bundle: true,
  outfile: path.join(rootPath, 'dist/shadow-npm-inject.js'),
  // Target Node.js environment (not browser).
  platform: 'node',
  // Target Node.js 18+ features.
  target: 'node18',
  format: 'cjs',

  // With platform: 'node', esbuild automatically externalizes all Node.js built-ins.
  external: [
    'node-gyp', // Required for require.resolve('node-gyp/package.json')
  ],

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

  // Write directly to disk.
  write: true,

  // Define environment variables and import.meta.
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.url': '__importMetaUrl',
  },

  // Inject import.meta.url polyfill at top of bundle.
  banner: IMPORT_META_URL_BANNER,
}

// Run build if invoked directly.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  build(config)
    .then(() => {
      console.log('Built shadow-npm-inject.js')
    })
    .catch(error => {
      console.error('Build failed:', error)
      process.exitCode = 1
    })
}

export default config
