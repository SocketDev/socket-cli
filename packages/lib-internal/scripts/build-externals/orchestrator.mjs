/**
 * @fileoverview Main entry point for bundling external dependencies.
 * Orchestrates bundling and reporting.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { bundlePackage } from './bundler.mjs'
import { externalPackages, scopedPackages } from './config.mjs'
import { ensureDir } from './copy-files.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..', '..')
const distExternalDir = path.join(rootDir, 'dist', 'external')

/**
 * Bundle all external packages.
 *
 * @param {object} options - Options
 * @param {boolean} options.quiet - Suppress individual package output
 * @returns {Promise<{bundledCount: number, totalSize: number}>}
 */
async function bundleAllPackages(options = {}) {
  const { quiet = false } = options
  let bundledCount = 0
  let totalSize = 0

  // Bundle each external package.
  for (const { bundle, name } of externalPackages) {
    if (bundle) {
      const outputPath = path.join(distExternalDir, `${name}.js`)
      const size = await bundlePackage(name, outputPath, {
        quiet,
        rootDir,
      })
      if (size) {
        bundledCount++
        totalSize += size
      }
    }
  }

  // Bundle scoped packages.
  for (const { name, optional, packages, scope, subpaths } of scopedPackages) {
    const scopeDir = path.join(distExternalDir, scope)
    await ensureDir(scopeDir)

    if (name) {
      // Single package in scope.
      const outputPath = path.join(scopeDir, `${name}.js`)
      if (optional) {
        try {
          const size = await bundlePackage(`${scope}/${name}`, outputPath, {
            quiet,
            rootDir,
          })
          if (size) {
            bundledCount++
            totalSize += size
          }
        } catch {
          if (!quiet) {
            console.log(`  Skipping optional package ${scope}/${name}`)
          }
        }
      } else {
        const size = await bundlePackage(`${scope}/${name}`, outputPath, {
          quiet,
          rootDir,
        })
        if (size) {
          bundledCount++
          totalSize += size
        }
      }
    } else if (packages) {
      // Multiple packages in scope.
      for (const pkg of packages) {
        const outputPath = path.join(scopeDir, `${pkg}.js`)
        if (optional) {
          try {
            const size = await bundlePackage(`${scope}/${pkg}`, outputPath, {
              quiet,
              rootDir,
            })
            if (size) {
              bundledCount++
              totalSize += size
            }
          } catch {
            if (!quiet) {
              console.log(`  Skipping optional package ${scope}/${pkg}`)
            }
          }
        } else {
          const size = await bundlePackage(`${scope}/${pkg}`, outputPath, {
            quiet,
            rootDir,
          })
          if (size) {
            bundledCount++
            totalSize += size
          }
        }
      }
    }

    // Bundle subpath exports (e.g., @npmcli/package-json/lib/read-package)
    if (subpaths) {
      for (const subpath of subpaths) {
        const outputPath = path.join(distExternalDir, scope, subpath)
        const packageName = `${scope}/${subpath}`
        // Ensure parent directory exists
        await ensureDir(path.dirname(outputPath))
        const size = await bundlePackage(packageName, outputPath, {
          quiet,
          rootDir,
        })
        if (size) {
          bundledCount++
          totalSize += size
        }
      }
    }
  }

  return { bundledCount, totalSize }
}

/**
 * Main build function.
 *
 * @param {object} options - Build options
 * @param {boolean} options.verbose - Show detailed output
 * @param {boolean} options.quiet - Suppress all output
 * @returns {Promise<void>}
 */
export async function buildExternals(options = {}) {
  const { quiet = false, verbose = false } = options

  // Default behavior: show header but not individual packages (concise)
  // --verbose: show all package details
  // --quiet: show nothing
  const showDetails = verbose && !quiet

  // Ensure dist/external directory exists.
  await ensureDir(distExternalDir)

  // Bundle all packages
  const { bundledCount, totalSize } = await bundleAllPackages({
    quiet: quiet || !showDetails,
  })

  return { bundledCount, totalSize }
}
