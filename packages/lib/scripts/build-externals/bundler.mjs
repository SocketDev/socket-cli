/**
 * @fileoverview Package bundling logic using esbuild.
 */

import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import esbuild from 'esbuild'
import {
  getEsbuildConfig,
  getPackageSpecificOptions,
} from './esbuild-config.mjs'
import {
  getLocalPackagePath,
  resolveLocalEntryPoint,
} from './local-packages.mjs'

const require = createRequire(import.meta.url)

/**
 * Bundle a single package with esbuild.
 *
 * @param {string} packageName - Name of the package to bundle
 * @param {string} outputPath - Output file path
 * @param {object} options - Bundling options
 * @param {boolean} options.quiet - Suppress output
 * @param {string} options.rootDir - Root directory
 * @returns {Promise<number|undefined>} Size in KB or undefined on error
 */
export async function bundlePackage(packageName, outputPath, options = {}) {
  const { quiet = false, rootDir } = options

  if (!quiet) {
    console.log(`  Bundling ${packageName}...`)
  }

  try {
    // Check if package is installed.
    let packagePath

    // First, check if src/external/{packageName}.js exists - use as entry point.
    // Preserve scope for scoped packages like @socketregistry/yocto-spinner
    const srcExternalPath = path.join(
      rootDir,
      'src',
      'external',
      `${packageName}.js`,
    )
    try {
      await fs.access(srcExternalPath)
      packagePath = srcExternalPath
      if (!quiet) {
        console.log(
          `  Using entry point ${path.relative(rootDir, srcExternalPath)}`,
        )
      }
    } catch {
      // No src/external file, check for local workspace/sibling versions (dev mode).
      const localPath = await getLocalPackagePath(packageName, rootDir)
      if (localPath) {
        if (!quiet) {
          console.log(
            `  Using local version from ${path.relative(rootDir, localPath)}`,
          )
        }
        packagePath = await resolveLocalEntryPoint(localPath)
      } else {
        // Fall back to installed version.
        try {
          packagePath = require.resolve(packageName)
        } catch {
          // Package must be installed for bundling - no fallbacks.
          throw new Error(
            `Package "${packageName}" is not installed. Please install it with: pnpm add -D ${packageName}`,
          )
        }
      }
    }

    // Get package-specific optimizations.
    const packageOpts = getPackageSpecificOptions(packageName)

    // Get esbuild configuration.
    const config = getEsbuildConfig(packagePath, outputPath, packageOpts)

    // Bundle the package with esbuild.
    await esbuild.build(config)

    // Add a header comment to the bundled file.
    const bundleContent = await fs.readFile(outputPath, 'utf8')
    // Strip 'use strict' from bundle content if present (will be re-added at top)
    const contentWithoutStrict = bundleContent.replace(/^"use strict";\n/, '')
    const finalContent = `"use strict";
/**
 * Bundled from ${packageName}
 * This is a zero-dependency bundle created by esbuild.
 */
${contentWithoutStrict}`
    await fs.writeFile(outputPath, finalContent)

    // Get file size for logging.
    const stats = await fs.stat(outputPath)
    const sizeKB = Math.round(stats.size / 1024)
    if (!quiet) {
      console.log(`    ✓ Bundled ${packageName} (${sizeKB}KB)`)
    }
    return sizeKB
  } catch (error) {
    if (!quiet) {
      console.error(`    ✗ Failed to bundle ${packageName}:`, error.message)
    }
    // Create error stub.
    const stubContent = `'use strict'

// Failed to bundle ${packageName}: ${error.message}
throw new Error('Failed to bundle ${packageName}')
`
    await fs.writeFile(outputPath, stubContent)
  }
}
