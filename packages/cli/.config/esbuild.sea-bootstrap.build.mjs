/**
 * esbuild configuration for building SEA bootstrap thin wrapper.
 * Compiles TypeScript bootstrap to CommonJS for Node.js SEA compatibility.
 */

import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const inputFile =
  process.env['SEA_BOOTSTRAP'] || path.join(rootDir, 'src/stub/bootstrap.mts')
const outputFile =
  process.env['SEA_OUTPUT'] || path.join(rootDir, 'dist/sea/bootstrap.cjs')

const isWatch = process.argv.includes('--watch')

// Get local package aliases for development.
const aliases = getLocalPackageAliases(rootDir)

// Create alias mapping for esbuild.
const aliasEntries = {}
for (const [pkg, distPath] of Object.entries(aliases)) {
  // For each package, create an alias that points to the dist folder.
  aliasEntries[pkg] = distPath
}

const config = {
  entryPoints: [inputFile],
  outfile: outputFile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  minify: false,
  // Only externalize Node.js built-ins for the thin wrapper.
  external: ['node:*'],
  alias: aliasEntries,
  logLevel: 'info',
  banner: {
    js: '// SEA Bootstrap - esbuild generated\n',
  },
}

try {
  if (isWatch) {
    const context = await build({
      ...config,
      logLevel: 'info',
    })
    await context.watch()
    console.log('Watching for changes...')
  } else {
    await build(config)
    console.log(`✓ SEA bootstrap built: ${outputFile}`)
  }
} catch (error) {
  console.error('Build failed:', error)
  process.exit(1)
}
