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
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT_DIR = join(__dirname, '..')
const BUILD_DIR = join(ROOT_DIR, 'build')
const NODE_DIR = join(BUILD_DIR, 'node-smol')

/**
 * Fix V8 include paths
 */
async function fixV8IncludePaths() {
  getDefaultLogger().log('🔧 Fixing V8 include paths...')

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
          getDefaultLogger().log(`   ✓ Fixed: ${file}`)
        }
      }

      if (modified) {
        await writeFile(filePath, content, 'utf8')
      }
    } catch (e) {
      getDefaultLogger().warn(`   ${colors.yellow('⚠')}  Could not fix ${file}: ${e.message}`)
    }
  }

  getDefaultLogger().log(`${colors.green('✓')} V8 include paths fixed`)
  getDefaultLogger().log('')
}

/**
 * Enable SEA detection for pkg binaries
 */
async function enableSeaForPkg() {
  getDefaultLogger().log('🔧 Enabling SEA detection for pkg binaries...')

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
      getDefaultLogger().log('   ✓ Modified: lib/sea.js')
    } else {
      getDefaultLogger().log('   ℹ️  lib/sea.js already modified or structure changed')
    }
  } catch (e) {
    getDefaultLogger().warn(`   ${colors.yellow('⚠')}  Could not modify lib/sea.js: ${e.message}`)
  }

  getDefaultLogger().log(`${colors.green('✓')} SEA detection enabled`)
  getDefaultLogger().log('')
}

/**
 * Main function
 */
async function main() {
  getDefaultLogger().log('🔨 Applying Socket modifications to Node.js source')
  getDefaultLogger().log('')

  await fixV8IncludePaths()
  await enableSeaForPkg()

  getDefaultLogger().log('🎉 All modifications applied!')
  getDefaultLogger().log('')
  getDefaultLogger().log('📝 To generate patches:')
  getDefaultLogger().log('   cd build/node-smol')
  getDefaultLogger().log('   git diff > ../../build/patches/socket/my-changes.patch')
  getDefaultLogger().log('')
}

// Run main function
main().catch(error => {
  getDefaultLogger().error(`${colors.red('✗')} Failed to apply modifications:`, error.message)
  process.exitCode = 1
})
