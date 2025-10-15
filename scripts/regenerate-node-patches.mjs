/**
 * @fileoverview Regenerate Socket Node.js patches for new Node.js versions
 *
 * This script automates the process of regenerating patches when Node.js
 * version is bumped (e.g., from v24.9.0 to v24.10.0).
 *
 * Process:
 * 1. Clone fresh Node.js at specified version
 * 2. Apply yao-pkg patches
 * 3. Commit (this becomes our baseline)
 * 4. Apply Socket modifications
 * 5. Generate patches from diff
 *
 * Usage:
 *   node scripts/regenerate-node-patches.mjs --version v24.10.0
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/registry/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Parse arguments
const args = process.argv.slice(2)
const versionArg = args.find(arg => arg.startsWith('--version='))
if (!versionArg) {
  console.error('❌ Missing --version argument')
  console.error(
    'Usage: node scripts/regenerate-node-patches.mjs --version=v24.10.0',
  )
  process.exit(1)
}

const NODE_VERSION = versionArg.split('=')[1]
if (!NODE_VERSION.startsWith('v')) {
  console.error('❌ Version must start with "v" (e.g., v24.10.0)')
  process.exit(1)
}

const ROOT_DIR = join(__dirname, '..')
const WORK_DIR = join(ROOT_DIR, '.patch-gen')
const NODE_DIR = join(WORK_DIR, 'node')
const YAO_PATCH_URL = `https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/node.${NODE_VERSION}.cpp.patch`
const OUTPUT_DIR = join(ROOT_DIR, 'build', 'patches', 'socket')

/**
 * Execute a command
 */
async function exec(command, args = [], options = {}) {
  const { cwd = process.cwd(), stdio = 'inherit' } = options

  console.log(`$ ${command} ${args.join(' ')}`)

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
  console.log('🔧 Applying Socket modifications...')

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
        console.log(`   ✓ Fixed: ${file}`)
      }
    } catch (e) {
      console.warn(`   ⚠️  Skipped ${file}: ${e.message}`)
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
      console.log('   ✓ Modified: lib/sea.js')
    }
  } catch (e) {
    console.warn(`   ⚠️  Skipped lib/sea.js: ${e.message}`)
  }

  console.log('✅ Socket modifications applied')
  console.log()
}

/**
 * Generate patch file
 */
async function generatePatch(name, description) {
  console.log(`📝 Generating ${name} patch...`)

  const diff = await execCapture('git', ['diff', 'HEAD'], { cwd: NODE_DIR })

  if (!diff) {
    console.log('   ℹ️  No changes to generate patch')
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
  console.log(`✅ Generated: ${patchFile}`)

  return patchFile
}

/**
 * Main function
 */
async function main() {
  console.log(`🔨 Regenerating Socket patches for Node.js ${NODE_VERSION}`)
  console.log()

  // Clean up old work directory
  if (existsSync(WORK_DIR)) {
    console.log('🧹 Cleaning up old work directory...')
    await rm(WORK_DIR, { recursive: true, force: true })
  }

  await mkdir(WORK_DIR, { recursive: true })
  await mkdir(OUTPUT_DIR, { recursive: true })

  // Step 1: Clone Node.js
  console.log(`📥 Cloning Node.js ${NODE_VERSION}...`)
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
  console.log()

  // Step 2: Download and apply yao-pkg patch
  console.log('📥 Downloading yao-pkg patch...')
  const yaoPatchFile = join(WORK_DIR, `node.${NODE_VERSION}.cpp.patch`)

  try {
    await exec('curl', ['-sL', YAO_PATCH_URL, '-o', yaoPatchFile])
    // eslint-disable-next-line no-unused-vars
  } catch (_e) {
    console.error(`❌ Failed to download yao-pkg patch from: ${YAO_PATCH_URL}`)
    console.error('   The patch may not exist yet for this Node.js version.')
    process.exit(1)
  }

  console.log('🩹 Applying yao-pkg patch...')
  await exec('sh', ['-c', `patch -p1 < "${yaoPatchFile}"`], { cwd: NODE_DIR })
  console.log()

  // Step 3: Commit baseline (yao-pkg patches applied)
  console.log('📌 Creating baseline commit...')
  await exec('git', ['add', '-A'], { cwd: NODE_DIR })
  await exec('git', ['commit', '-m', 'Apply yao-pkg patches'], {
    cwd: NODE_DIR,
  })
  console.log()

  // Step 4: Apply Socket modifications
  await applySocketModifications()

  // Step 5: Generate patches
  console.log('📝 Generating patch files...')
  console.log()

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

  console.log()
  console.log('🎉 Patch regeneration complete!')
  console.log()

  if (patches.length > 0) {
    console.log('Generated patches:')
    for (const patch of patches) {
      console.log(`   - ${patch}`)
    }
    console.log()
    console.log('📝 Next steps:')
    console.log('   1. Review the generated patches')
    console.log(
      '   2. Update scripts/build-yao-pkg-node.mjs to use new patch files',
    )
    console.log('   3. Update SOCKET_PATCHES array with new filenames')
    console.log('   4. Test the build')
  } else {
    console.log('⚠️  No patches were generated (no changes detected)')
  }

  console.log()
  console.log('🧹 Cleanup:')
  console.log(`   rm -rf ${WORK_DIR}`)
}

// Run main function
main().catch(error => {
  console.error('❌ Patch regeneration failed:', error.message)
  process.exitCode = 1
})
