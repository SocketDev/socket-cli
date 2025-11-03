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


const logger = getDefaultLogger()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT_DIR = join(__dirname, '..')
const BUILD_DIR = join(ROOT_DIR, 'build')
const NODE_DIR = join(BUILD_DIR, 'node-smol')

/**
 * Fix V8 include paths
 */
async function fixV8IncludePaths() {
  logger.log('🔧 Fixing V8 include paths...')

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
          logger.log(`   ✓ Fixed: ${file}`)
        }
      }

      if (modified) {
        await writeFile(filePath, content, 'utf8')
      }
    } catch (e) {
      logger.warn(`   ${colors.yellow('⚠')}  Could not fix ${file}: ${e.message}`)
    }
  }

  logger.log(`${colors.green('✓')} V8 include paths fixed`)
  logger.log('')
}

/**
 * Enable SEA detection for pkg binaries
 */
async function enableSeaForPkg() {
  logger.log('🔧 Enabling SEA detection for pkg binaries...')

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
      logger.log('   ✓ Modified: lib/sea.js')
    } else {
      logger.log('   ℹ️  lib/sea.js already modified or structure changed')
    }
  } catch (e) {
    logger.warn(`   ${colors.yellow('⚠')}  Could not modify lib/sea.js: ${e.message}`)
  }

  logger.log(`${colors.green('✓')} SEA detection enabled`)
  logger.log('')
}

/**
 * Main function
 */
async function main() {
  logger.log('🔨 Applying Socket modifications to Node.js source')
  logger.log('')

  await fixV8IncludePaths()
  await enableSeaForPkg()

  logger.log('🎉 All modifications applied!')
  logger.log('')
  logger.log('📝 To generate patches:')
  logger.log('   cd build/node-smol')
  logger.log('   git diff > ../../build/patches/socket/my-changes.patch')
  logger.log('')
}

// Run main function
main().catch(error => {
  logger.error(`${colors.red('✗')} Failed to apply modifications:`, error.message)
  process.exitCode = 1
})
