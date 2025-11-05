/**
 * @fileoverview esbuild configuration for fast builds with smaller bundles
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from '@babel/parser'
import MagicString from 'magic-string'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const srcPath = path.join(rootPath, 'src')
const distPath = path.join(rootPath, 'dist')

/**
 * Plugin to shorten module paths in bundled output with conflict detection.
 * Uses @babel/parser and magic-string for precise AST-based modifications.
 */
function createPathShorteningPlugin() {
  return {
    name: 'shorten-module-paths',
    setup(build) {
      build.onEnd(async result => {
        if (!result.outputFiles && result.metafile) {
          const outputs = Object.keys(result.metafile.outputs).filter(
            f => f.endsWith('.js') || f.endsWith('.mjs'),
          )

          for (const outputPath of outputs) {
            const content = await fs.readFile(outputPath, 'utf8')
            const magicString = new MagicString(content)

            // Track module paths and their shortened versions
            const pathMap = new Map()
            const conflictDetector = new Map()

            function shortenPath(longPath) {
              if (pathMap.has(longPath)) {
                return pathMap.get(longPath)
              }

              let shortPath = longPath

              // Handle pnpm scoped packages
              const scopedPnpmMatch = longPath.match(
                /node_modules\/\.pnpm\/@([^+/]+)\+([^@/]+)@[^/]+\/node_modules\/(@[^/]+\/[^/]+)\/(.+)/,
              )
              if (scopedPnpmMatch) {
                const [, _scope, _pkg, packageName, subpath] = scopedPnpmMatch
                shortPath = `${packageName}/${subpath}`
              } else {
                // Handle pnpm non-scoped packages
                const pnpmMatch = longPath.match(
                  /node_modules\/\.pnpm\/([^@/]+)@[^/]+\/node_modules\/([^/]+)\/(.+)/,
                )
                if (pnpmMatch) {
                  const [, _pkgName, packageName, subpath] = pnpmMatch
                  shortPath = `${packageName}/${subpath}`
                }
              }

              // Detect conflicts
              if (conflictDetector.has(shortPath)) {
                const existingPath = conflictDetector.get(shortPath)
                if (existingPath !== longPath) {
                  console.warn(
                    `⚠ Path conflict detected:\n  "${shortPath}"\n  Maps to: "${existingPath}"\n  Also from: "${longPath}"\n  Keeping original paths to avoid conflict.`,
                  )
                  shortPath = longPath
                }
              } else {
                conflictDetector.set(shortPath, longPath)
              }

              pathMap.set(longPath, shortPath)
              return shortPath
            }

            // Parse AST to find all string literals containing module paths
            try {
              const ast = parse(content, {
                sourceType: 'module',
                plugins: [],
              })

              // Walk through all comments
              for (const comment of ast.comments || []) {
                if (
                  comment.type === 'CommentLine' &&
                  comment.value.includes('node_modules')
                ) {
                  const originalPath = comment.value.trim()
                  const shortPath = shortenPath(originalPath)

                  if (shortPath !== originalPath) {
                    magicString.overwrite(
                      comment.start,
                      comment.end,
                      `// ${shortPath}`,
                    )
                  }
                }
              }

              // Walk through all string literals
              function walk(node) {
                if (!node || typeof node !== 'object') {
                  return
                }

                if (
                  node.type === 'StringLiteral' &&
                  node.value &&
                  node.value.includes('node_modules')
                ) {
                  const originalPath = node.value
                  const shortPath = shortenPath(originalPath)

                  if (shortPath !== originalPath) {
                    magicString.overwrite(
                      node.start + 1,
                      node.end - 1,
                      shortPath,
                    )
                  }
                }

                for (const key of Object.keys(node)) {
                  if (key === 'start' || key === 'end' || key === 'loc') {
                    continue
                  }
                  const value = node[key]
                  if (Array.isArray(value)) {
                    for (const item of value) {
                      walk(item)
                    }
                  } else {
                    walk(value)
                  }
                }
              }

              walk(ast.program)
              await fs.writeFile(outputPath, magicString.toString(), 'utf8')
            } catch (error) {
              console.error(
                `Failed to shorten paths in ${outputPath}:`,
                error.message,
              )
            }
          }
        }
      })
    },
  }
}

/**
 * Plugin to handle local package aliases.
 * Provides consistent alias resolution across all Socket repos.
 */
function createAliasPlugin() {
  const aliases = getLocalPackageAliases(rootPath)

  // Only create plugin if we have local aliases
  if (Object.keys(aliases).length === 0) {
    return null
  }

  // Packages that should always be bundled (even when using local aliases)
  const ALWAYS_BUNDLED = new Set(['@socketsecurity/lib'])

  return {
    name: 'local-package-aliases',
    setup(build) {
      // Intercept imports for aliased packages and mark as external.
      for (const [packageName, _aliasPath] of Object.entries(aliases)) {
        // Skip packages that should always be bundled - let esbuild bundle them naturally
        if (ALWAYS_BUNDLED.has(packageName)) {
          continue
        }

        // Match both exact package name and subpath imports.
        build.onResolve(
          { filter: new RegExp(`^${packageName}(/|$)`) },
          args => {
            // Mark as external using the original package name to avoid absolute paths in output.
            // This ensures require('@socketsecurity/lib') instead of require('/absolute/path/to/socket-lib/dist').
            return { path: args.path, external: true }
          },
        )
      }
    },
  }
}

// Get local package aliases for bundled packages
function getBundledPackageAliases() {
  const aliases = getLocalPackageAliases(rootPath)
  const bundledAliases = {}

  // @socketsecurity/lib should always be bundled (not external)
  if (aliases['@socketsecurity/lib']) {
    bundledAliases['@socketsecurity/lib'] = aliases['@socketsecurity/lib']
  }

  return bundledAliases
}

// Build configuration for ESM output
export const buildConfig = {
  entryPoints: [`${srcPath}/index.ts`, `${srcPath}/testing.ts`],
  outdir: distPath,
  outbase: srcPath,
  bundle: true,
  format: 'cjs',
  // Target Node.js environment (not browser).
  platform: 'node',
  // Target Node.js 18+ features.
  target: 'node18',
  sourcemap: false,
  minify: false,
  treeShaking: true,
  // For bundle analysis
  metafile: true,
  logLevel: 'info',

  // Alias local packages that should be bundled (not external)
  alias: getBundledPackageAliases(),

  // Use plugin for local package aliases (consistent across all Socket repos).
  plugins: [createPathShorteningPlugin(), createAliasPlugin()].filter(Boolean),

  // External dependencies.
  // Note: @socketsecurity/lib is bundled (not external) to reduce consumer dependencies.
  // With format: 'cjs', bundling CJS code works fine (no __require wrapper issues).
  external: [],

  // Banner for generated code
  banner: {
    js: '/* Socket SDK CJS - Built with esbuild */',
  },

  // TypeScript configuration
  tsconfig: path.join(rootPath, 'tsconfig.json'),

  // Define constants for optimization
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'production',
    ),
  },
}

// Watch configuration for development
export const watchConfig = {
  ...buildConfig,
  minify: false,
  sourcemap: 'inline',
  logLevel: 'debug',
  watch: {
    onRebuild(error, result) {
      if (error) {
        console.error('Watch build failed:', error)
      } else {
        console.log('Watch build succeeded')
        if (result.metafile) {
          const analysis = analyzeMetafile(result.metafile)
          console.log(analysis)
        }
      }
    },
  },
}

/**
 * Analyze build output for size information
 */
function analyzeMetafile(metafile) {
  const outputs = Object.keys(metafile.outputs)
  let totalSize = 0

  const files = outputs.map(file => {
    const output = metafile.outputs[file]
    totalSize += output.bytes
    return {
      name: path.relative(rootPath, file),
      size: `${(output.bytes / 1024).toFixed(2)} KB`,
    }
  })

  return {
    files,
    totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
  }
}

export { analyzeMetafile }
