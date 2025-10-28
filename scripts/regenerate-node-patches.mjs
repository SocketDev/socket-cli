/**
 * @fileoverview Regenerate Socket Node.js patches for new Node.js versions
 *
 * This script automates the process of regenerating patches when Node.js
 * version is bumped (e.g., from v24.9.0 to v24.10.0).
 *
 * Process:
 * 1. Clone fresh Node.js at specified version
 * 2. Apply Socket modifications
 * 3. Generate patches from diff
 *
 * Usage:
 *   node scripts/regenerate-node-patches.mjs --version v24.10.0
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
if (!versionArg) {
  logger.error(`${colors.red('✗')} Missing --version argument`)
  logger.error(
    'Usage: node scripts/regenerate-node-patches.mjs --version=v24.10.0',
  )
  process.exit(1)
}

const NODE_VERSION = versionArg.split('=')[1]
if (!NODE_VERSION.startsWith('v')) {
  logger.error(`${colors.red('✗')} Version must start with "v" (e.g., v24.10.0)`)
  process.exit(1)
}

const ROOT_DIR = join(__dirname, '..')
const WORK_DIR = join(ROOT_DIR, '.patch-gen')
const NODE_DIR = join(WORK_DIR, 'node')
const OUTPUT_DIR = join(ROOT_DIR, 'build', 'patches')

/**
 * Execute a command
 */
async function exec(command, args = [], options = {}) {
  const { cwd = process.cwd(), stdio = 'inherit' } = options

  logger.log(`$ ${command} ${args.join(' ')}`)

  const result = await spawn(command, args, {
    cwd,
    stdio,
    shell: false,
  })

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }

  return result
}

/**
 * Execute and capture output
 */
async function execCapture(command, args = [], options = {}) {
  const { cwd = process.cwd() } = options

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

  return result.stdout.trim()
}

/**
 * Apply Socket modifications
 */
async function applySocketModifications() {
  logger.log('🔧 Applying Socket modifications...')

  // Fix 1: V8 include paths
  const v8Fixes = [
    {
      file: 'deps/v8/src/ast/ast-value-factory.h',
      from: '#include "src/base/hashmap.h"',
      to: '#include "base/hashmap.h"',
    },
    {
      file: 'deps/v8/src/heap/new-spaces-inl.h',
      from: '#include "src/heap/spaces-inl.h"',
      to: '#include "heap/spaces-inl.h"',
    },
    {
      file: 'deps/v8/src/heap/factory-inl.h',
      from: '#include "src/heap/factory-base-inl.h"',
      to: '#include "heap/factory-base-inl.h"',
    },
    {
      file: 'deps/v8/src/objects/js-objects-inl.h',
      from: '#include "src/objects/hash-table-inl.h"',
      to: '#include "objects/hash-table-inl.h"',
    },
    {
      file: 'deps/v8/src/heap/cppgc/heap-page.h',
      from: '#include "src/base/iterator.h"',
      to: '#include "base/iterator.h"',
    },
  ]

  for (const { file, from, to } of v8Fixes) {
    const filePath = join(NODE_DIR, file)
    try {
      let content = await readFile(filePath, 'utf8')
      if (content.includes(from)) {
        content = content.replace(from, to)
        await writeFile(filePath, content, 'utf8')
        logger.log(`   ✓ Fixed: ${file}`)
      }
    } catch (e) {
      logger.warn(`   ${colors.yellow('⚠')}  Skipped ${file}: ${e.message}`)
    }
  }

  // Fix 2: Enable SEA for pkg binaries
  const seaFile = join(NODE_DIR, 'lib', 'sea.js')
  try {
    let content = await readFile(seaFile, 'utf8')
    const oldImport =
      "const { isSea, getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');"
    const newImport = `const isSea = () => true;
const { getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');`

    if (content.includes(oldImport)) {
      content = content.replace(oldImport, newImport)
      await writeFile(seaFile, content, 'utf8')
      logger.log('   ✓ Modified: lib/sea.js')
    }
  } catch (e) {
    logger.warn(`   ${colors.yellow('⚠')}  Skipped lib/sea.js: ${e.message}`)
  }

  logger.log(`${colors.green('✓')} Socket modifications applied`)
  logger.log('')
}

/**
 * Generate patch file
 */
async function generatePatch(name, description) {
  logger.log(`📝 Generating ${name} patch...`)

  const diff = await execCapture('git', ['diff', 'HEAD'], { cwd: NODE_DIR })

  if (!diff) {
    logger.log('   ℹ️  No changes to generate patch')
    return null
  }

  const header = `# ${description}
#
# Author: Socket CLI
# Date: ${new Date().toISOString().split('T')[0]}
# Node version: ${NODE_VERSION}

`

  const patchContent = header + diff
  const patchFile = join(
    OUTPUT_DIR,
    `${name}-${NODE_VERSION.replace(/\./g, '-')}.patch`,
  )

  await writeFile(patchFile, patchContent)
  logger.log(`${colors.green('✓')} Generated: ${patchFile}`)

  return patchFile
}

/**
 * Main function
 */
async function main() {
  logger.log(`🔨 Regenerating Socket patches for Node.js ${NODE_VERSION}`)
  logger.log('')

  // Clean up old work directory
  if (existsSync(WORK_DIR)) {
    logger.log('🧹 Cleaning up old work directory...')
    await rm(WORK_DIR, { recursive: true, force: true })
  }

  await mkdir(WORK_DIR, { recursive: true })
  await mkdir(OUTPUT_DIR, { recursive: true })

  // Step 1: Clone Node.js
  logger.log(`📥 Cloning Node.js ${NODE_VERSION}...`)
  await exec(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      NODE_VERSION,
      'https://github.com/nodejs/node.git',
      'node',
    ],
    { cwd: WORK_DIR },
  )
  logger.log('')

  // Step 2: Apply Socket modifications
  await applySocketModifications()

  // Step 5: Generate patches
  logger.log('📝 Generating patch files...')
  logger.log('')

  const patches = []

  // Generate combined patch
  const combinedPatch = await generatePatch(
    'socket-node-modifications',
    'Socket CLI modifications for Node.js\n' +
      '#\n' +
      '# Includes:\n' +
      '# - Fix V8 include paths\n' +
      '# - Enable SEA detection for pkg binaries',
  )

  if (combinedPatch) {
    patches.push(combinedPatch)
  }

  logger.log('')
  logger.log('🎉 Patch regeneration complete!')
  logger.log('')

  if (patches.length > 0) {
    logger.log('Generated patches:')
    for (const patch of patches) {
      logger.log(`   - ${patch}`)
    }
    logger.log('')
    logger.log('📝 Next steps:')
    logger.log('   1. Review the generated patches')
    logger.log(
      '   2. Update packages/node-smol-builder/scripts/build.mjs to use new patch files',
    )
    logger.log('   3. Update SOCKET_PATCHES array with new filenames')
    logger.log('   4. Test the build')
  } else {
    logger.log(`${colors.yellow('⚠')}  No patches were generated (no changes detected)`)
  }

  logger.log('')
  logger.log('🧹 Cleanup:')
  logger.log(`   rm -rf ${WORK_DIR}`)
}

// Run main function
main().catch(error => {
  logger.error(`${colors.red('✗')} Patch regeneration failed:`, error.message)
  process.exitCode = 1
})
