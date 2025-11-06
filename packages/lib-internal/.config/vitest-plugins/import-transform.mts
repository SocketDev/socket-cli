import { resolve } from 'node:path'

import type { Plugin } from 'vite'

/**
 * Vite plugin to transform ES6 import paths from dist/ to src/ during coverage.
 * This allows tests with ES6 imports to load TypeScript source files for instrumentation.
 */
export function createImportTransformPlugin(
  isCoverageEnabled: boolean,
  projectRoot: string,
): Plugin {
  if (!isCoverageEnabled) {
    return { name: 'socket:import-transform-noop' }
  }

  // projectRoot is the .config directory, so go up one level for the actual project root
  const actualProjectRoot = resolve(projectRoot, '..')

  return {
    name: 'socket:import-transform',
    enforce: 'pre',

    async resolveId(source: string, importer: string | undefined) {
      // Handle @socketsecurity/registry imports.
      if (source.startsWith('@socketsecurity/registry')) {
        const subpath = source.replace('@socketsecurity/registry', '')
        // Transform: @socketsecurity/registry → /abs/path/registry/src/index.ts
        // Transform: @socketsecurity/registry/lib/foo → /abs/path/registry/src/lib/foo.ts
        const targetPath = subpath
          ? resolve(actualProjectRoot, `registry/src${subpath}.ts`)
          : resolve(actualProjectRoot, 'registry/src/index.ts')
        return { id: targetPath }
      }

      // Only handle relative imports for dist/ transformation.
      if (
        !importer ||
        (!source.startsWith('./') && !source.startsWith('../'))
      ) {
        return null
      }

      // Check if this is a dist/ import that needs transformation.
      if (source.includes('registry/dist/')) {
        // Transform: ../../registry/dist/lib/foo.js → registry/src/lib/foo.ts
        const transformed = source
          .replace(/registry\/dist\//, 'registry/src/')
          .replace(/\.js$/, '.ts')
          .replace(/\.mjs$/, '.mts')
          .replace(/\.cjs$/, '.cts')

        // Resolve to absolute path.
        const absolutePath = resolve(
          importer.substring(0, importer.lastIndexOf('/')),
          transformed,
        )

        // Return the absolute path directly.
        return { id: absolutePath }
      }

      return null
    },
  }
}
