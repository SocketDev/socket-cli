/**
 * @fileoverview Utilities for creating pnpm patches using Babel AST + MagicString.
 * Provides helpers for transforming node_modules files and generating patch files.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { parse } from '@babel/core'
import MagicString from 'magic-string'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

/**
 * Parse JavaScript/TypeScript code into a Babel AST.
 *
 * @param {string} code - Source code to parse.
 * @param {object} [options] - Babel parser options.
 * @returns {object} Babel AST.
 */
export function parseCode(code, options = {}) {
  return parse(code, {
    sourceType: 'module',
    plugins: [],
    ...options,
  })
}

/**
 * Read file from package directory within node_modules.
 *
 * @param {string} packagePath - Path to package directory.
 * @param {string} filePath - Relative file path within package.
 * @returns {string} File contents.
 */
export function readPatchFile(packagePath, filePath) {
  const fullPath = path.join(packagePath, filePath)
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`)
  }
  return readFileSync(fullPath, 'utf-8')
}

/**
 * Write file to package directory within node_modules.
 *
 * @param {string} packagePath - Path to package directory.
 * @param {string} filePath - Relative file path within package.
 * @param {string} content - File contents to write.
 */
export function writePatchFile(packagePath, filePath, content) {
  const fullPath = path.join(packagePath, filePath)
  writeFileSync(fullPath, content, 'utf-8')
}

/**
 * Prompt user for yes/no confirmation.
 *
 * @param {string} question - Question to ask the user.
 * @param {boolean} [defaultAnswer=false] - Default answer if user just presses enter.
 * @returns {Promise<boolean>} True if user answered yes, false otherwise.
 */
async function promptYesNo(question, defaultAnswer = false) {
  const readline = await import('node:readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    const defaultHint = defaultAnswer ? 'Y/n' : 'y/N'
    rl.question(`${question} (${defaultHint}): `, answer => {
      rl.close()
      const normalized = answer.trim().toLowerCase()
      if (normalized === '') {
        resolve(defaultAnswer)
      } else {
        resolve(normalized === 'y' || normalized === 'yes')
      }
    })
  })
}

/**
 * Run pnpm patch command to prepare package for editing.
 *
 * @param {string} packageSpec - Package name and version (e.g., 'debug@4.4.3').
 * @returns {Promise<string>} Path to temporary patch directory.
 */
export async function startPatch(packageSpec) {
  const logger = getDefaultLogger()
  logger.log(`Starting patch for ${packageSpec}...`)

  // First, try to run pnpm patch to see if directory already exists.
  let result = await spawn('pnpm', ['patch', packageSpec], {
    shell: WIN32,
    stdio: ['inherit', 'pipe', 'pipe'], // Capture stdout and stderr.
    stdioString: true,
  })

  // Check if the error is about existing patch directory.
  // pnpm outputs errors to stdout, not stderr.
  if (result.code !== 0 && result.stdout.includes('is not empty')) {
    const match = result.stdout.match(/directory (.+?) is not empty/)
    const existingPatchDir = match ? match[1] : null

    if (existingPatchDir) {
      logger.log(
        `\nExisting patch directory found: ${existingPatchDir}`,
      )
      const shouldOverwrite = await promptYesNo(
        'Overwrite existing patch directory?',
        false,
      )

      if (!shouldOverwrite) {
        throw new Error('Patch creation cancelled by user')
      }

      // Remove existing patch directory.
      logger.log('Removing existing patch directory...')
      rmSync(existingPatchDir, { force: true, recursive: true })

      // Try pnpm patch again.
      result = await spawn('pnpm', ['patch', packageSpec], {
        shell: WIN32,
        stdio: ['inherit', 'pipe', 'inherit'],
        stdioString: true,
      })
    }
  }

  if (result.code !== 0) {
    throw new Error(`Failed to start patch for ${packageSpec}`)
  }

  // Extract path from output.
  // pnpm patch outputs: "Patch: You can now edit the package at:\n\n  /path/to/package\n\n..."
  // We need to find the line with the path (starts with whitespace and contains the package name).
  const lines = result.stdout.split('\n')
  const packageNamePart = packageSpec.split('@')[0]
  const pathLine = lines.find(
    line => line.trim().startsWith('/') && line.includes(packageNamePart),
  )

  if (!pathLine) {
    throw new Error(
      `Could not find patch directory path in output:\n${result.stdout}`,
    )
  }

  return pathLine.trim()
}

/**
 * Run pnpm patch-commit command to finalize patch.
 *
 * @param {string} patchPath - Path to temporary patch directory.
 * @param {string} packageName - Package name for logging.
 */
export async function commitPatch(patchPath, packageName) {
  logger.log(`Committing patch for ${packageName}...`)
  const result = await spawn('pnpm', ['patch-commit', patchPath], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    throw new Error(`Failed to commit patch for ${packageName}`)
  }

  logger.log(`✓ Patch created for ${packageName}`)
}

/**
 * Create a patch from a patch definition.
 *
 * @param {object} patchDef - Patch definition object.
 * @param {string} patchDef.packageName - Package name (e.g., 'debug').
 * @param {string} patchDef.version - Package version (e.g., '4.4.3').
 * @param {string} patchDef.description - Description of what the patch does.
 * @param {string[]} patchDef.files - Array of file paths to transform.
 * @param {Function} patchDef.transform - Transform function.
 * @returns {Promise<void>}
 */
export async function createPatch(patchDef) {
  const { description, files, packageName, transform, version } = patchDef
  const packageSpec = `${packageName}@${version}`

  logger.log(`\n=== Creating patch: ${packageName} ===`)
  logger.log(`Description: ${description}`)

  let patchPath
  try {
    // Start pnpm patch.
    patchPath = await startPatch(packageSpec)

    // Transform each file.
    const utils = {
      MagicString,
      parseCode,
      readFile: filePath => readPatchFile(patchPath, filePath),
      writeFile: (filePath, content) =>
        writePatchFile(patchPath, filePath, content),
    }

    let hasChanges = false
    for (const file of files) {
      logger.log(`Transforming ${file}...`)
      const changed = await transform(file, utils)
      if (changed) {
        hasChanges = true
        logger.log(`✓ Transformed ${file}`)
      } else {
        logger.log(`- No changes needed for ${file}`)
      }
    }

    if (!hasChanges) {
      logger.log('No changes made, skipping patch commit')
      // Cleanup temp directory.
      if (existsSync(patchPath)) {
        rmSync(patchPath, { force: true, recursive: true })
      }
      return
    }

    // Commit the patch.
    await commitPatch(patchPath, packageName)
  } catch (error) {
    logger.error(
      `Error creating patch for ${packageName}:`,
      error.message,
    )
    // Cleanup temp directory on error.
    if (patchPath && existsSync(patchPath)) {
      rmSync(patchPath, { force: true, recursive: true })
    }
    throw error
  }
}
