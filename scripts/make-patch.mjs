/**
 * @fileoverview Orchestrator script for creating pnpm patches.
 * Runs all patch definitions to transform node_modules files and generate patch files.
 *
 * Usage: node scripts/make-patch.mjs [patch-name]
 *
 * Examples:
 *   node scripts/make-patch.mjs           # Create all patches
 *   node scripts/make-patch.mjs debug     # Create only debug patch
 */

import debugPatch from './make-patch/debug.mjs'
import inkPatch from './make-patch/ink.mjs'
import yogaPatch from './make-patch/yoga-layout.mjs'
import { createPatch } from './utils/patches.mjs'

const patches = [debugPatch, inkPatch, yogaPatch]

const patchName = process.argv[2]

async function main() {
  const selectedPatches = patchName
    ? patches.filter(p => p.packageName === patchName)
    : patches

  if (selectedPatches.length === 0) {
    console.error(`Error: Unknown patch "${patchName}"`)
    console.error(
      `Available patches: ${patches.map(p => p.packageName).join(', ')}`,
    )
    process.exit(1)
  }

  console.log(`Creating ${selectedPatches.length} patch(es)...\n`)

  for (const patch of selectedPatches) {
    try {
      await createPatch(patch)
    } catch (error) {
      console.error(`\n❌ Failed to create patch for ${patch.packageName}`)
      console.error(error.message)
      process.exit(1)
    }
  }

  console.log('\n✅ All patches created successfully!')
}

main()
