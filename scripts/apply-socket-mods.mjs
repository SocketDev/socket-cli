/**
 * @fileoverview Apply Socket-specific modifications to Node.js source
 *
 * This script modifies Node.js source files with Socket-specific changes.
 * After running this, you can generate patches with `git diff`.
 *
 * Usage:
 *   node scripts/apply-socket-mods.mjs
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT_DIR = join(__dirname, '..')
const BUILD_DIR = join(ROOT_DIR, '.custom-node-build')
const NODE_DIR = join(BUILD_DIR, 'node-yao-pkg')

/**
 * Fix V8 include paths
 */
async function fixV8IncludePaths() {
  console.log('🔧 Fixing V8 include paths...')

  const fixes = [
    {
      file: 'deps/v8/src/ast/ast-value-factory.h',
      replacements: [
        {
          from: '#include "src/base/hashmap.h"',
          to: '#include "base/hashmap.h"',
        },
      ],
    },
    {
      file: 'deps/v8/src/heap/new-spaces-inl.h',
      replacements: [
        {
          from: '#include "src/heap/spaces-inl.h"',
          to: '#include "heap/spaces-inl.h"',
        },
      ],
    },
    {
      file: 'deps/v8/src/heap/factory-inl.h',
      replacements: [
        {
          from: '#include "src/heap/factory-base-inl.h"',
          to: '#include "heap/factory-base-inl.h"',
        },
      ],
    },
    {
      file: 'deps/v8/src/objects/js-objects-inl.h',
      replacements: [
        {
          from: '#include "src/objects/hash-table-inl.h"',
          to: '#include "objects/hash-table-inl.h"',
        },
      ],
    },
    {
      file: 'deps/v8/src/heap/cppgc/heap-page.h',
      replacements: [
        {
          from: '#include "src/base/iterator.h"',
          to: '#include "base/iterator.h"',
        },
      ],
    },
  ]

  for (const { file, replacements } of fixes) {
    const filePath = join(NODE_DIR, file)
    try {
      let content = await readFile(filePath, 'utf8')
      let modified = false

      for (const { from, to } of replacements) {
        if (content.includes(from)) {
          content = content.replace(from, to)
          modified = true
          console.log(`   ✓ Fixed: ${file}`)
        }
      }

      if (modified) {
        await writeFile(filePath, content, 'utf8')
      }
    } catch (e) {
      console.warn(`   ⚠️  Could not fix ${file}: ${e.message}`)
    }
  }

  console.log('✅ V8 include paths fixed')
  console.log()
}

/**
 * Enable SEA detection for pkg binaries
 */
async function enableSeaForPkg() {
  console.log('🔧 Enabling SEA detection for pkg binaries...')

  const filePath = join(NODE_DIR, 'lib', 'sea.js')

  try {
    let content = await readFile(filePath, 'utf8')

    // Replace the isSea import
    const oldImport =
      "const { isSea, getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');"
    const newImport = `const isSea = () => true;
const { getAsset: getAssetInternal, getAssetKeys: getAssetKeysInternal } = internalBinding('sea');`

    if (content.includes(oldImport)) {
      content = content.replace(oldImport, newImport)
      await writeFile(filePath, content, 'utf8')
      console.log('   ✓ Modified: lib/sea.js')
    } else {
      console.log('   ℹ️  lib/sea.js already modified or structure changed')
    }
  } catch (e) {
    console.warn(`   ⚠️  Could not modify lib/sea.js: ${e.message}`)
  }

  console.log('✅ SEA detection enabled')
  console.log()
}

/**
 * Main function
 */
async function main() {
  console.log('🔨 Applying Socket modifications to Node.js source')
  console.log()

  await fixV8IncludePaths()
  await enableSeaForPkg()

  console.log('🎉 All modifications applied!')
  console.log()
  console.log('📝 To generate patches:')
  console.log('   cd .custom-node-build/node-yao-pkg')
  console.log('   git diff > ../../build/patches/socket/my-changes.patch')
  console.log()
}

// Run main function
main().catch(error => {
  console.error('❌ Failed to apply modifications:', error.message)
  process.exitCode = 1
})
