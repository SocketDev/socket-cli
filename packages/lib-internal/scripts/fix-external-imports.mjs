/**
 * @fileoverview Fix external package imports to point to dist/external.
 * Rewrites require('package') to require('./external/package') for bundled externals.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

import { isQuiet } from '#socketsecurity/lib/argv/flags'
import { getDefaultLogger } from '#socketsecurity/lib/logger'

import { externalPackages, scopedPackages } from './build-externals/config.mjs'

const logger = getDefaultLogger()
const printCompletedHeader = title => console.log(colors.green(`✓ ${title}`))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist')
const distExternalDir = path.join(distDir, 'external')

// Build list of all external packages to rewrite
const allExternalPackages = [
  ...externalPackages.map(p => p.name),
  ...scopedPackages.flatMap(s => {
    if (s.name) {
      return [`${s.scope}/${s.name}`]
    }
    if (s.packages) {
      return s.packages.map(name => `${s.scope}/${name}`)
    }
    return []
  }),
]

/**
 * Calculate the relative path from a file to the external directory.
 *
 * @param {string} filePath - The path to the file being processed
 * @returns {string} The relative path prefix (e.g., './' or '../')
 */
function getExternalPathPrefix(filePath) {
  const dir = path.dirname(filePath)
  const relativePath = path.relative(dir, distExternalDir)
  // Normalize to forward slashes and ensure it starts with ./ or ../
  const normalized = relativePath.replace(/\\/g, '/')
  return normalized.startsWith('.') ? normalized : `./${normalized}`
}

/**
 * Rewrite external package imports in a file.
 *
 * @param {string} filePath - Path to the file to process
 * @param {boolean} verbose - Show individual file fixes
 * @returns {Promise<boolean>} True if file was modified
 */
async function fixFileImports(filePath, verbose = false) {
  let content = await fs.readFile(filePath, 'utf8')
  let modified = false

  const externalPrefix = getExternalPathPrefix(filePath)

  for (const pkg of allExternalPackages) {
    // Escape special regex characters in package name
    const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Match require('pkg') or require("pkg")
    // Don't match if it's already pointing to ./external/ or ../external/
    const requirePattern = new RegExp(
      `require\\((['"])(?!\\.\\.?\\/external\\/)${escapedPkg}\\1\\)`,
      'g',
    )

    if (requirePattern.test(content)) {
      // Replace with require('./external/pkg') or require('../external/pkg')
      const replacement = `require('${externalPrefix}/${pkg}')`
      content = content.replace(requirePattern, replacement)
      modified = true
    }
  }

  if (modified) {
    await fs.writeFile(filePath, content)
    if (verbose) {
      const relativePath = path.relative(distDir, filePath)
      console.log(`    Fixed ${relativePath}`)
    }
  }

  return modified
}

/**
 * Process files in a directory and fix external imports.
 *
 * @param {string} dir - Directory to process
 * @param {boolean} verbose - Show individual file fixes
 * @returns {Promise<number>} Number of files fixed
 */
async function processDirectory(dir, verbose = false) {
  let fixedCount = 0

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      // Skip the external directory itself
      if (entry.isDirectory() && fullPath === distExternalDir) {
        continue
      }

      if (entry.isDirectory()) {
        fixedCount += await processDirectory(fullPath, verbose)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const wasFixed = await fixFileImports(fullPath, verbose)
        if (wasFixed) {
          fixedCount += 1
        }
      }
    }
  } catch (error) {
    // Skip directories that don't exist
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  return fixedCount
}

async function fixExternalImports() {
  const verbose = process.argv.includes('--verbose')
  const quiet = isQuiet()

  try {
    const fixedCount = await processDirectory(distDir, verbose)

    if (!quiet) {
      const title =
        fixedCount > 0
          ? `External Imports (${fixedCount} file${fixedCount === 1 ? '' : 's'})`
          : 'External Imports (no changes)'
      printCompletedHeader(title)
    }
  } catch (error) {
    logger.error(`Failed to fix external imports: ${error.message}`)
    process.exitCode = 1
  }
}

fixExternalImports().catch(error => {
  logger.error(`Build failed: ${error.message || error}`)
  process.exitCode = 1
})
