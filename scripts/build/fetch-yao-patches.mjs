
/**
 * @fileoverview Download patches from yao-pkg/pkg-fetch repository
 *
 * This script fetches the latest patches from the yao-pkg project
 * for building custom Node.js binaries compatible with pkg.
 */

import { existsSync as _existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '..', '..')
const PATCHES_DIR = join(ROOT_DIR, 'build', 'patches')
const YAO_PATCHES_DIR = join(PATCHES_DIR, 'yao')
const _SOCKET_PATCHES_DIR = join(PATCHES_DIR, 'socket')
const PATCHES_JSON_URL = 'https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/patches.json'
const PATCHES_BASE_URL = 'https://raw.githubusercontent.com/yao-pkg/pkg-fetch/main/patches/'

// Patches are organized as:
// - patches/yao/    - Downloaded from yao-pkg
// - patches/socket/ - Our custom Socket patches

/**
 * Fetch a file from URL
 */
async function fetchFile(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
  }
  return response.text()
}

/**
 * Download patches from yao-pkg (overrides existing patches)
 */
async function fetchYaoPatches(options = {}) {
  const { versions = [] } = options
  // Always override existing patches (no force flag needed)

  console.log('📥 Fetching patches from yao-pkg/pkg-fetch')
  console.log(`   Destination: ${YAO_PATCHES_DIR}`)
  console.log('==========================================\n')

  // Create yao-patches directory
  await mkdir(YAO_PATCHES_DIR, { recursive: true })

  try {
    // Fetch patches.json to get list of available patches
    console.log('📋 Fetching patch list...')
    const patchesJson = await fetchFile(PATCHES_JSON_URL)
    const patchList = JSON.parse(patchesJson)

    // Save patches.json locally
    await writeFile(
      join(YAO_PATCHES_DIR, 'patches.json'),
      JSON.stringify(patchList, null, 2)
    )
    console.log('✅ Saved patches.json\n')

    // Determine which versions to download
    let targetVersions = versions
    if (targetVersions.length === 0) {
      // Default to common versions
      targetVersions = ['v24.9.0', 'v22.19.0', 'v20.19.5']
      console.log(`📦 No versions specified, fetching defaults: ${targetVersions.join(', ')}\n`)
    }

    // Download patches for each version
    let downloadCount = 0
    for (const version of targetVersions) {
      if (patchList[version]) {
        for (const patchFile of patchList[version]) {
          const localPath = join(YAO_PATCHES_DIR, patchFile)

          // Always download and override
          console.log(`📥 Downloading ${patchFile}...`)
          const patchUrl = PATCHES_BASE_URL + patchFile
          const patchContent = await fetchFile(patchUrl) // eslint-disable-line no-await-in-loop

          await writeFile(localPath, patchContent) // eslint-disable-line no-await-in-loop
          console.log(`✅ Saved ${patchFile}`)
          downloadCount++
        }
      } else {
        console.log(`⚠️  No patches found for ${version}`)
      }
    }

    console.log(`\n✅ Downloaded ${downloadCount} patch files`)

    // List all patches
    const allPatches = await readdir(PATCHES_DIR)
    const patchFiles = allPatches.filter(f => f.endsWith('.patch'))
    console.log(`\n📁 Total patches available: ${patchFiles.length}`)

    // Group by version
    const versionMap = {}
    for (const file of patchFiles) {
      const match = file.match(/node\.v(\d+\.\d+\.\d+)/)
      if (match) {
        const version = `v${match[1]}`
        if (!versionMap[version]) {
          versionMap[version] = []
        }
        versionMap[version].push(file)
      }
    }

    console.log('\nPatches by version:')
    for (const [version, files] of Object.entries(versionMap)) {
      console.log(`   ${version}: ${files.length} patch(es)`)
    }

  } catch (error) {
    console.error(`\n❌ Failed to fetch patches: ${error.message}`)

    // Fallback: Try to copy from node_modules if available
    console.log('\n🔍 Checking for patches in node_modules...')

    const nodeModulesPatches = join(
      __dirname, '../../../',
      'node_modules/.pnpm/@yao-pkg+pkg-fetch@*/node_modules/@yao-pkg/pkg-fetch/patches'
    )

    // Use glob pattern to find the directory
    const { globSync } = await import('fast-glob')
    const dirs = globSync(nodeModulesPatches)

    if (dirs.length > 0) {
      const sourceDir = dirs[0]
      console.log(`✅ Found patches in: ${sourceDir}`)

      const { default: { spawn } } = await import('@socketsecurity/registry/lib/spawn')
      await spawn('cp', ['-r', `${sourceDir}/.`, PATCHES_DIR], {
        stdio: 'inherit',
        shell: false
      })

      console.log('✅ Copied patches from node_modules')
    } else {
      console.log('❌ No patches found in node_modules')
      console.log('\nTo manually download patches:')
      console.log('1. Visit: https://github.com/yao-pkg/pkg-fetch/tree/main/patches')
      console.log('2. Download the patch files for your Node.js version')
      console.log(`3. Place them in: ${PATCHES_DIR}`)
    }
  }
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    versions: [],
    help: false
  }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg.startsWith('--version=')) {
      options.versions.push(arg.split('=')[1])
    } else if (arg.match(/^v\d+\.\d+\.\d+$/)) {
      options.versions.push(arg)
    }
  }

  return options
}

/**
 * Show help
 */
function showHelp() {
  console.log(`Yao-pkg Patch Fetcher
=====================

Usage: node scripts/build/stub/fetch-patches.mjs [options] [versions...]

Options:
  --version=VERSION  Node.js version to fetch patches for
  --help, -h        Show this help

Examples:
  # Fetch default versions (v24.9.0, v22.19.0, v20.19.5)
  node scripts/build/stub/fetch-patches.mjs

  # Fetch specific versions
  node scripts/build/stub/fetch-patches.mjs v24.9.0 v22.19.0

Note: Fetched patches will override any existing patches in the patches/ directory

Patches are downloaded from:
  https://github.com/yao-pkg/pkg-fetch/tree/main/patches
`)
}

// Main
async function main() {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    process.exit(0) // eslint-disable-line n/no-process-exit
  }

  try {
    await fetchYaoPatches(options)
    console.log('\n✅ Patch fetch complete!')
  } catch (error) {
    console.error('❌ Failed:', error.message)
    process.exit(1) // eslint-disable-line n/no-process-exit
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error)
}

export { fetchYaoPatches }