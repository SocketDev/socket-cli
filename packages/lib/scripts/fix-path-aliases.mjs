/**
 * @fileoverview Fix internal path aliases (#lib/*, #constants/*, etc.) to relative paths.
 * Rewrites require('#lib/foo') to require('../foo') based on file location.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

import { isQuiet } from '#socketsecurity/lib/argv/flags'
import { getDefaultLogger } from '#socketsecurity/lib/logger'

const logger = getDefaultLogger()
const printCompletedHeader = title => console.log(colors.green(`✓ ${title}`))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', 'dist')
const _srcDir = path.resolve(__dirname, '..', 'src')

// Map of path aliases to their actual directories
const pathAliases = {
  '#lib/': distDir,
  '#constants/': path.join(distDir, 'constants'),
  '#env/': path.join(distDir, 'env'),
  '#packages/': path.join(distDir, 'packages'),
  '#utils/': path.join(distDir, 'utils'),
  '#types': path.join(distDir, 'types'),
}

/**
 * Calculate the relative path from a file to the target.
 *
 * @param {string} filePath - The path to the file being processed
 * @param {string} targetPath - The path to the target file/directory
 * @returns {string} The relative path (e.g., './foo' or '../bar')
 */
function getRelativePath(filePath, targetPath) {
  const dir = path.dirname(filePath)
  let relativePath = path.relative(dir, targetPath)

  // Normalize to forward slashes
  relativePath = relativePath.replace(/\\/g, '/')

  // Ensure it starts with ./ or ../
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`
  }

  return relativePath
}

/**
 * Rewrite path alias imports in a file.
 *
 * @param {string} filePath - Path to the file to process
 * @param {boolean} verbose - Show individual file fixes
 * @returns {Promise<boolean>} True if file was modified
 */
async function fixFileAliases(filePath, verbose = false) {
  let content = await fs.readFile(filePath, 'utf8')
  let modified = false

  for (const [alias, basePath] of Object.entries(pathAliases)) {
    const isExact = !alias.endsWith('/')

    // Escape special regex characters
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Match require('#lib/foo') or require("#lib/foo") or require('#types')
    // Capture the quote style and the subpath
    const requirePattern = new RegExp(
      `require\\((['"])${escapedAlias}([^'"]*?)\\1\\)`,
      'g',
    )

    const matches = [...content.matchAll(requirePattern)]

    for (const match of matches) {
      const [fullMatch, quote, subpath] = match

      // Calculate target path
      const targetPath = isExact ? basePath : path.join(basePath, subpath || '')

      // Calculate relative path from this file
      const relativePath = getRelativePath(filePath, targetPath)

      // Replace with require('./relative/path')
      const replacement = `require(${quote}${relativePath}${quote})`
      content = content.replace(fullMatch, replacement)
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
 * Process files in a directory and fix path aliases.
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

      // Skip the external directory
      if (entry.isDirectory() && entry.name === 'external') {
        continue
      }

      if (entry.isDirectory()) {
        fixedCount += await processDirectory(fullPath, verbose)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const wasFixed = await fixFileAliases(fullPath, verbose)
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

async function fixPathAliases() {
  const verbose = process.argv.includes('--verbose')
  const quiet = isQuiet()

  try {
    const fixedCount = await processDirectory(distDir, verbose)

    if (!quiet) {
      const title =
        fixedCount > 0
          ? `Path Aliases (${fixedCount} file${fixedCount === 1 ? '' : 's'})`
          : 'Path Aliases (no changes)'
      printCompletedHeader(title)
    }
  } catch (error) {
    logger.error(`Failed to fix path aliases: ${error.message}`)
    process.exitCode = 1
  }
}

fixPathAliases().catch(error => {
  logger.error(`Build failed: ${error.message || error}`)
  process.exitCode = 1
})
