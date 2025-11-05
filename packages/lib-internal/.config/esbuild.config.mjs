/**
 * @fileoverview esbuild configuration for socket-lib
 * Fast JS compilation with esbuild, declarations with tsgo
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fg from 'fast-glob'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const srcPath = path.join(rootPath, 'src')
const distPath = path.join(rootPath, 'dist')

// Find all TypeScript source files
const entryPoints = fg.sync('**/*.{ts,mts,cts}', {
  cwd: srcPath,
  absolute: true,
  // Skip declaration files.
  ignore: ['**/*.d.ts', '**/types/**', '**/external/**'],
})

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
          // Dynamic imports to avoid adding to production dependencies
          const fs = await import('node:fs/promises')
          const { parse } = await import('@babel/parser')
          const MagicString = (await import('magic-string')).default

          const outputs = Object.keys(result.metafile.outputs).filter(f =>
            f.endsWith('.js'),
          )

          for (const outputPath of outputs) {
            // eslint-disable-next-line no-await-in-loop
            const content = await fs.readFile(outputPath, 'utf8')
            const magicString = new MagicString(content)

            // Track module paths and their shortened versions
            // Map<originalPath, shortenedPath>
            const pathMap = new Map()
            // Track shortened paths to detect conflicts
            // Map<shortenedPath, originalPath>
            const conflictDetector = new Map()

            /**
             * Shorten a module path and detect conflicts.
             */
            // eslint-disable-next-line unicorn/consistent-function-scoping
            const shortenPath = longPath => {
              if (pathMap.has(longPath)) {
                return pathMap.get(longPath)
              }

              let shortPath = longPath

              // Handle pnpm scoped packages
              // node_modules/.pnpm/@scope+pkg@version/node_modules/@scope/pkg/dist/file.js
              // -> @scope/pkg/dist/file.js
              const scopedPnpmMatch = longPath.match(
                /node_modules\/\.pnpm\/@([^+/]+)\+([^@/]+)@[^/]+\/node_modules\/(@[^/]+\/[^/]+)\/(.+)/,
              )
              if (scopedPnpmMatch) {
                const [, _scope, _pkg, packageName, subpath] = scopedPnpmMatch
                shortPath = `${packageName}/${subpath}`
              } else {
                // Handle pnpm non-scoped packages
                // node_modules/.pnpm/pkg@version/node_modules/pkg/dist/file.js
                // -> pkg/dist/file.js
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
                  // Conflict detected - keep original path
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

              // Walk through all comments (esbuild puts module paths in comments)
              for (const comment of ast.comments || []) {
                if (
                  comment.type === 'CommentLine' &&
                  comment.value.includes('node_modules')
                ) {
                  const originalPath = comment.value.trim()
                  const shortPath = shortenPath(originalPath)

                  if (shortPath !== originalPath) {
                    // Replace in comment
                    const commentStart = comment.start
                    const commentEnd = comment.end
                    magicString.overwrite(
                      commentStart,
                      commentEnd,
                      `// ${shortPath}`,
                    )
                  }
                }
              }

              // Walk through all string literals in __commonJS calls
              const walk = node => {
                if (!node || typeof node !== 'object') {
                  return
                }

                // Check for string literals containing node_modules paths
                if (
                  node.type === 'StringLiteral' &&
                  node.value &&
                  node.value.includes('node_modules')
                ) {
                  const originalPath = node.value
                  const shortPath = shortenPath(originalPath)

                  if (shortPath !== originalPath) {
                    // Replace the string content (keep quotes)
                    magicString.overwrite(
                      node.start + 1,
                      node.end - 1,
                      shortPath,
                    )
                  }
                }

                // Recursively walk all properties
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

              // Write the modified content
              // eslint-disable-next-line no-await-in-loop
              await fs.writeFile(outputPath, magicString.toString(), 'utf8')
            } catch (error) {
              console.error(
                `Failed to shorten paths in ${outputPath}:`,
                error.message,
              )
              // Continue without failing the build
            }
          }
        }
      })
    },
  }
}

/**
 * Plugin to resolve internal path aliases (#lib/*, #constants/*, etc.) to relative paths
 */
function createPathAliasPlugin() {
  return {
    name: 'internal-path-aliases',
    setup(build) {
      // Map of path aliases to their actual directories
      const pathAliases = {
        '#lib/': srcPath,
        '#constants/': path.join(srcPath, 'constants'),
        '#env/': path.join(srcPath, 'env'),
        '#packages/': path.join(srcPath, 'packages'),
        '#utils/': path.join(srcPath, 'utils'),
        '#types': path.join(srcPath, 'types'),
      }

      // Intercept imports for path aliases
      for (const [alias, basePath] of Object.entries(pathAliases)) {
        const isExact = !alias.endsWith('/')
        const filter = isExact
          ? new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
          : new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

        build.onResolve({ filter }, args => {
          // Calculate the subpath after the alias
          const subpath = isExact ? '' : args.path.slice(alias.length)
          const targetPath = subpath ? path.join(basePath, subpath) : basePath

          // Calculate relative path from the importing file to the target
          const importer = args.importer || srcPath
          const importerDir = path.dirname(importer)
          let relativePath = path.relative(importerDir, targetPath)

          // Ensure relative paths start with ./ or ../
          if (!relativePath.startsWith('.')) {
            relativePath = `./${relativePath}`
          }

          // Normalize to forward slashes for consistency
          relativePath = relativePath.replace(/\\/g, '/')

          return { path: relativePath, external: true }
        })
      }
    },
  }
}

/**
 * Plugin to handle local package aliases when bundle: false
 * esbuild's built-in alias only works with bundle: true, so we need a custom plugin
 */
function createAliasPlugin() {
  const aliases = getLocalPackageAliases(rootPath)

  // Only create plugin if we have local aliases
  if (Object.keys(aliases).length === 0) {
    return null
  }

  return {
    name: 'local-package-aliases',
    setup(build) {
      // Intercept imports for aliased packages
      for (const [packageName, aliasPath] of Object.entries(aliases)) {
        // Match both exact package name and subpath imports
        build.onResolve(
          { filter: new RegExp(`^${packageName}(/|$)`) },
          args => {
            // Handle subpath imports like '@socketsecurity/lib/spinner'
            const subpath = args.path.slice(packageName.length + 1)
            const resolvedPath = subpath
              ? path.join(aliasPath, subpath)
              : aliasPath
            return { path: resolvedPath, external: true }
          },
        )
      }
    },
  }
}

// Build configuration for CommonJS output
export const buildConfig = {
  entryPoints,
  outdir: distPath,
  outbase: srcPath,
  // Don't bundle - library pattern (each file separate).
  bundle: false,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  // Don't minify - this is a library and minification breaks ESM/CJS interop.
  minify: false,
  // Tree-shaking optimization.
  treeShaking: true,
  metafile: true,
  logLevel: 'info',

  // Use plugin for local package aliases (built-in alias requires bundle: true).
  plugins: [
    createPathShorteningPlugin(),
    createPathAliasPlugin(),
    createAliasPlugin(),
  ].filter(Boolean),

  // Note: Cannot use "external" with bundle: false.
  // esbuild automatically treats all imports as external when not bundling.

  // Define constants for optimization
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'production',
    ),
  },

  // Banner for generated code
  banner: {
    js: '"use strict";\n/* Socket Lib - Built with esbuild */',
  },
}

// Watch configuration for development with incremental builds
export const watchConfig = {
  ...buildConfig,
  minify: false,
  sourcemap: 'inline',
  logLevel: 'debug',
}

/**
 * Analyze build output for size information
 */
export function analyzeMetafile(metafile) {
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
