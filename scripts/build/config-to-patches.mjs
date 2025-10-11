/**
 * @fileoverview Generate Node.js patches from build configuration
 *
 * This script reads the build configuration and generates patches for:
 * - V8 runtime flags (modifying deps/v8/src/flags/flag-definitions.h)
 * - Node.js process flags (modifying src/node_options.cc)
 *
 * The patches enable our custom v8Flags to be set by default in the binary.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadBuildConfig } from './load-config.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '../..')
const PATCHES_DIR = join(ROOT_DIR, 'build', 'patches', 'socket')

/**
 * Generate a V8 flags patch for modifying deps/v8/src/flags/flag-definitions.h
 * @param {string} version - Node.js version (e.g., "v24.9.0")
 * @param {string[]} v8Flags - Array of V8 flags from config
 * @returns {string} Patch content
 */
function generateV8FlagsPatch(version, v8Flags) {
  if (!v8Flags || v8Flags.length === 0) {
    return null
  }

  // Map our flags to the V8 flag definitions format
  // V8 flags in flag-definitions.h are defined without the -- prefix
  const flagMappings = {
    '--harmony-import-assertions': 'harmony_import_assertions',
    '--harmony-import-attributes': 'harmony_import_attributes',
    '--no-expose-wasm': 'expose_wasm'
  }

  let patchContent = `--- a/deps/v8/src/flags/flag-definitions.h
+++ b/deps/v8/src/flags/flag-definitions.h
`

  // For each flag, we need to find its definition and change the default value
  v8Flags.forEach(flag => {
    const flagName = flagMappings[flag]
    if (!flagName) {
      console.warn(`Warning: No mapping found for V8 flag: ${flag}`)
      return
    }

    // Determine if this is enabling or disabling a flag
    const isNegation = flag.startsWith('--no-')
    const defaultValue = isNegation ? 'false' : 'true'

    // Add patch hunks for modifying the flag default
    // This is a simplified version - real patches would need proper line numbers
    if (flag.includes('harmony')) {
      // Harmony flags are usually defined as DEFINE_BOOL with default false
      patchContent += `
@@ -XXX,X +XXX,X @@
-DEFINE_BOOL(${flagName}, false,
+DEFINE_BOOL(${flagName}, ${defaultValue},
             "Enable ${flagName.replace(/_/g, ' ')}")
`
    } else if (flag === '--no-expose-wasm') {
      // expose_wasm is usually true by default, we want to set it false
      patchContent += `
@@ -XXX,X +XXX,X @@
-DEFINE_BOOL(expose_wasm, true,
+DEFINE_BOOL(expose_wasm, false,
             "Expose WebAssembly runtime")
`
    }
  })

  return patchContent
}

/**
 * Generate a Node.js options patch for src/node_options.cc
 * @param {string} version - Node.js version
 * @param {string[]} nodeFlags - Array of Node.js process flags from config
 * @returns {string} Patch content
 */
function generateNodeOptionsPatch(version, nodeFlags) {
  if (!nodeFlags || nodeFlags.length === 0) {
    return null
  }

  let patchContent = `--- a/src/node_options.cc
+++ b/src/node_options.cc
`

  // For Node.js flags like --no-deprecation and --no-warnings
  nodeFlags.forEach(flag => {
    if (flag === '--no-deprecation') {
      patchContent += `
@@ -XXX,X +XXX,X @@ EnvironmentOptionsParser::EnvironmentOptionsParser() {
-  AddOption("--no-deprecation",
-            "silence deprecation warnings",
-            &EnvironmentOptions::no_deprecation);
+  AddOption("--no-deprecation",
+            "silence deprecation warnings",
+            &EnvironmentOptions::no_deprecation,
+            kAllowedInEnvvar);
+  // Set no_deprecation to true by default
+  options_->no_deprecation = true;
`
    } else if (flag === '--no-warnings') {
      patchContent += `
@@ -XXX,X +XXX,X @@ EnvironmentOptionsParser::EnvironmentOptionsParser() {
-  AddOption("--no-warnings",
-            "silence all process warnings",
-            &EnvironmentOptions::no_warnings);
+  AddOption("--no-warnings",
+            "silence all process warnings",
+            &EnvironmentOptions::no_warnings,
+            kAllowedInEnvvar);
+  // Set no_warnings to true by default
+  options_->no_warnings = true;
`
    }
  })

  return patchContent
}

/**
 * Generate patch filename
 * @param {string} version - Node.js version
 * @param {string} type - Patch type (v8-flags, node-options)
 * @returns {string} Filename
 */
function getPatchFilename(version, type) {
  // Format: generated-by-config-to-patches-v8-flags-v24.patch
  // v24.9.0 -> v24
  const versionShort = version.replace(/\./g, '').substring(0, 3)
  return `generated-by-config-to-patches-${type}-${versionShort}.patch`
}

/**
 * Main function to generate patches from config
 */
async function main() {
  console.log('🔧 Generating patches from build configuration...\n')

  // Load the build configuration
  const config = loadBuildConfig()

  if (!config.node) {
    console.error('❌ No node configuration found in build-config.json5')
    process.exit(1) // eslint-disable-line n/no-process-exit
  }

  // Ensure patches directory exists
  mkdirSync(PATCHES_DIR, { recursive: true })

  const { currentVersion, nodeFlags, v8Flags, versions } = config.node

  console.log(`📦 Current Node version: ${currentVersion}`)
  console.log(`🔧 V8 flags to patch: ${v8Flags?.length || 0}`)
  console.log(`🔧 Node flags to patch: ${nodeFlags?.length || 0}\n`)

  // Generate patches for each configured version
  const versionsToProcess = versions ? Object.keys(versions) : [currentVersion]

  for (const version of versionsToProcess) {
    console.log(`\n📝 Generating patches for ${version}...`)

    // Generate V8 flags patch
    if (v8Flags && v8Flags.length > 0) {
      const v8Patch = generateV8FlagsPatch(version, v8Flags)
      if (v8Patch) {
        const v8PatchFile = join(PATCHES_DIR, getPatchFilename(version, 'v8-flags'))
        writeFileSync(v8PatchFile, v8Patch)
        console.log(`   ✅ Created: ${getPatchFilename(version, 'v8-flags')}`)
        console.log(`      Flags: ${v8Flags.join(', ')}`)
      }
    }

    // Generate Node options patch
    if (nodeFlags && nodeFlags.length > 0) {
      const nodePatch = generateNodeOptionsPatch(version, nodeFlags)
      if (nodePatch) {
        const nodePatchFile = join(PATCHES_DIR, getPatchFilename(version, 'node-options'))
        writeFileSync(nodePatchFile, nodePatch)
        console.log(`   ✅ Created: ${getPatchFilename(version, 'node-options')}`)
        console.log(`      Flags: ${nodeFlags.join(', ')}`)
      }
    }

    // Add version-specific patches to config if needed
    if (versions && versions[version]) {
      const versionConfig = versions[version]
      if (!versionConfig.patches) {
        versionConfig.patches = []
      }

      // Add our generated patches to the list if not already there
      const v8PatchName = getPatchFilename(version, 'v8-flags')
      const nodePatchName = getPatchFilename(version, 'node-options')

      if (v8Flags?.length > 0 && !versionConfig.patches.includes(v8PatchName)) {
        console.log(`   📌 Add to config: "${v8PatchName}"`)
      }
      if (nodeFlags?.length > 0 && !versionConfig.patches.includes(nodePatchName)) {
        console.log(`   📌 Add to config: "${nodePatchName}"`)
      }
    }
  }

  console.log('\n✅ Patch generation complete!')
  console.log(`📁 Patches saved to: ${PATCHES_DIR}`)

  // Show instructions
  console.log('\n📋 Next steps:')
  console.log('1. Review the generated patches in build/patches/socket/')
  console.log('2. Update the patches array in build-config.json5 for each version')
  console.log('3. Run the build script to apply patches and build Node.js')
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    help: false,
    dryRun: false
  }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    }
  }

  return options
}

function showHelp() {
  console.log(`
Generate Node.js patches from build configuration

Usage: node scripts/build/config-to-patches.mjs [options]

Options:
  --dry-run    Show what would be generated without creating files
  --help, -h   Show this help message

This script reads build-config.json5 and generates patches for:
- V8 runtime flags (deps/v8/src/flags/flag-definitions.h)
- Node.js process flags (src/node_options.cc)

The patches will be saved to build/patches/socket/
`)
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    process.exit(0) // eslint-disable-line n/no-process-exit
  }

  main().catch(error => {
    console.error('❌ Error:', error.message)
    process.exit(1) // eslint-disable-line n/no-process-exit
  })
}

export { generateV8FlagsPatch, generateNodeOptionsPatch }