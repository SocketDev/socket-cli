/**
 * @fileoverview Generate Socket-specific patches for Node.js
 *
 * This script generates patches for Socket CLI's custom Node.js modifications.
 * Run this after applying yao-pkg patches but before building to capture
 * Socket-specific changes.
 *
 * Usage:
 *   node scripts/generate-node-patches.mjs [--version v24.10.0]
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse arguments
const args = process.argv.slice(2)
const versionArg = args.find(arg => arg.startsWith('--version='))
const NODE_VERSION = versionArg ? versionArg.split('=')[1] : 'v24.10.0'

const ROOT_DIR = join(__dirname, '..')
const BUILD_DIR = join(ROOT_DIR, '.custom-node-build')
const NODE_DIR = join(BUILD_DIR, 'node-yao-pkg')
const PATCHES_OUTPUT_DIR = join(ROOT_DIR, 'build', 'patches', 'socket')

/**
 * Execute a command and capture output
 */
async function exec(command, args = [], options = {}) {
  const { cwd = process.cwd() } = options

  logger.log(`$ ${command} ${args.join(' ')}`)

  const result = await spawn(command, args, {
    cwd,
    stdio: 'pipe',
    shell: false,
  })

  if (result.code !== 0) {
    throw new Error(
      `Command failed with exit code ${result.code}: ${result.stderr}`,
    )
  }

  return result.stdout
}

/**
 * Generate fix-v8-include-paths patch
 */
async function generateV8IncludePathsPatch() {
  logger.log('📝 Generating fix-v8-include-paths patch...')

  const files = [
    'deps/v8/src/ast/ast-value-factory.h',
    'deps/v8/src/heap/new-spaces-inl.h',
    'deps/v8/src/heap/factory-inl.h',
    'deps/v8/src/objects/js-objects-inl.h',
    'deps/v8/src/heap/cppgc/heap-page.h',
  ]

  let patchContent = `# Fix V8 include paths for Node.js ${NODE_VERSION}
#
# Node.js ${NODE_VERSION} source has incorrect include paths in V8 code
# Files are looking for 'src/base/hashmap.h' when it should be 'base/hashmap.h'
# This patch removes the incorrect 'src/' prefix from V8 internal includes
#
# This issue causes build failures with errors like:
#   fatal error: 'src/base/hashmap.h' file not found
#
# Author: Socket CLI
# Date: ${new Date().toISOString().split('T')[0]}
# Node versions affected: ${NODE_VERSION}
`

  for (const file of files) {
    const filePath = join(NODE_DIR, file)
    if (!existsSync(filePath)) {
      logger.warn(`${colors.yellow('⚠')}  File not found: ${file}`)
      continue
    }

    // Create a git diff for this file
    try {
      const diff = await exec(
        'git',
        ['diff', '--no-index', '/dev/null', file],
        {
          cwd: NODE_DIR,
        },
      )
      patchContent += `\n${diff}`
    } catch (_e) {
      // git diff returns non-zero for differences, which is expected.
      logger.warn(`   Skipping ${file} (no changes or error)`)
    }
  }

  const patchFile = join(
    PATCHES_OUTPUT_DIR,
    `fix-v8-include-paths-${NODE_VERSION.replace('v', 'v')}.patch`,
  )
  await writeFile(patchFile, patchContent)
  logger.log(`${colors.green('✓')} Generated: ${patchFile}`)

  return patchFile
}

/**
 * Generate enable-sea-for-pkg-binaries patch
 */
async function generateSeaPatch() {
  logger.log('📝 Generating enable-sea-for-pkg-binaries patch...')

  const patchContent = `# Patch: Make isSea() return true for pkg binaries
#
# Overrides the isSea binding to always return true, making pkg binaries
# report as Single Executable Applications for consistency.
#
# Author: Socket CLI
# Date: ${new Date().toISOString().split('T')[0]}
# Node version: ${NODE_VERSION}

--- a/lib/sea.js
+++ b/lib/sea.js
@@ -16,7 +16,8 @@ const {
   ERR_UNKNOWN_BUILTIN_MODULE,
 } = require('internal/errors').codes;

-const { isSea, getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');
+const isSea = () => true;
+const { getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');

 const {
   setOwnProperty,
`

  const patchFile = join(
    PATCHES_OUTPUT_DIR,
    `enable-sea-for-pkg-binaries-${NODE_VERSION.replace('v', 'v')}.patch`,
  )
  await writeFile(patchFile, patchContent)
  logger.log(`${colors.green('✓')} Generated: ${patchFile}`)

  return patchFile
}

/**
 * Main function
 */
async function main() {
  logger.log(`🔨 Generating Socket patches for Node.js ${NODE_VERSION}`)
  logger.log()

  // Check if Node.js directory exists
  if (!existsSync(NODE_DIR)) {
    throw new Error(
      `Node.js source directory not found: ${NODE_DIR}\n` +
        'Run build-yao-pkg-node.mjs first to download and patch Node.js source.',
    )
  }

  // Ensure output directory exists
  await mkdir(PATCHES_OUTPUT_DIR, { recursive: true })

  // Generate patches
  const patches = []

  try {
    patches.push(await generateV8IncludePathsPatch())
  } catch (e) {
    logger.error(`${colors.red('✗')} Failed to generate V8 include paths patch:`, e.message)
  }

  try {
    patches.push(await generateSeaPatch())
  } catch (e) {
    logger.error(`${colors.red('✗')} Failed to generate SEA patch:`, e.message)
  }

  logger.log()
  logger.log('🎉 Patch generation complete!')
  logger.log()
  logger.log('Generated patches:')
  for (const patch of patches) {
    logger.log(`   - ${patch}`)
  }
  logger.log()
  logger.log('📝 Next steps:')
  logger.log('   1. Review the generated patches')
  logger.log(
    '   2. Update build-yao-pkg-node.mjs to reference new patch files',
  )
  logger.log('   3. Test the build with new patches')
  logger.log()
}

// Run main function
main().catch(error => {
  logger.error(`${colors.red('✗')} Patch generation failed:`, error.message)
  process.exitCode = 1
})
