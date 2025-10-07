/**
 * @fileoverview Code mod to disable V8 JIT compilers at compile-time
 *
 * This script modifies Node's gyp build configuration to disable:
 * - Turbofan (optimizing compiler)
 * - Sparkplug (baseline compiler)
 *
 * Note: GN modifications are NOT needed as gyp overrides them.
 * This reduces Node.js binary size by ~15-20MB by removing JIT compiler
 * code entirely at compile-time.
 *
 * ⚠️ WARNING: Disabling Turbofan breaks the build due to:
 * 1. Missing dependencies in turbofan-disabled.cc stub
 * 2. WASM requires Turbofan
 * 3. yoga-layout (used by Ink) requires WASM
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT_DIR = join(__dirname, '..')
const NODE_BUILD_DIR = join(ROOT_DIR, '.custom-node-build', 'node-yao-pkg')
const V8_GYPI = join(NODE_BUILD_DIR, 'tools', 'v8_gypfiles', 'features.gypi')

/**
 * Modify features.gypi to disable JIT compilers at preprocessor level
 */
async function modifyGypi() {
  console.log('📝 Modifying tools/v8_gypfiles/features.gypi...')

  if (!existsSync(V8_GYPI)) {
    throw new Error(`V8 GYPI file not found: ${V8_GYPI}`)
  }

  let content = await readFile(V8_GYPI, 'utf-8')

  // Disable Sparkplug
  content = content.replace(
    /^(\s*)'v8_enable_sparkplug%':\s*1,$/m,
    "$1'v8_enable_sparkplug%': 0,  # Disabled by Socket CLI code mod"
  )

  // Disable Turbofan
  content = content.replace(
    /^(\s*)'v8_enable_turbofan%':\s*1,$/m,
    "$1'v8_enable_turbofan%': 0,  # Disabled by Socket CLI code mod"
  )

  await writeFile(V8_GYPI, content, 'utf-8')
  console.log('✅ Modified features.gypi')
}

/**
 * Main function
 */
async function main() {
  console.log('🔧 Disabling V8 JIT compilers...')
  console.log()

  if (!existsSync(NODE_BUILD_DIR)) {
    console.error('❌ Node.js source directory not found')
    console.error(`   Expected: ${NODE_BUILD_DIR}`)
    console.error('   Run: pnpm run build:yao-pkg:node first')
    process.exit(1)
  }

  await modifyGypi()

  console.log()
  console.log('⚠️  WARNING: This modification will break the build!')
  console.log()
  console.log('   Disabling Turbofan causes build errors:')
  console.log('   - turbofan-disabled.cc missing dependencies')
  console.log('   - WASM requires Turbofan')
  console.log('   - yoga-layout requires WASM')
  console.log()
  console.log('   This script is kept for reference only.')
  console.log('   Do not use unless the issues above are resolved.')
}

main().catch(error => {
  console.error('❌ Code mod failed:', error.message)
  process.exit(1)
})
