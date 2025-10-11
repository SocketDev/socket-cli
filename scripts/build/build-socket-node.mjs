/**
 * @fileoverview Build custom Node.js with yao-pkg and custom patches
 *
 * This script downloads Node.js source, applies patches, and builds a custom
 * binary for use with @yao-pkg/pkg. It supports configurable Node versions
 * and custom patches.
 *
 * Usage:
 *   node scripts/build-socket-node.mjs [options]
 *
 * Options:
 *   --version=v24.9.0  Node.js version to build (default: v24.9.0)
 *   --skip-download    Skip downloading if source already exists
 *   --skip-yao-patch   Skip applying yao-pkg patches
 *   --custom-patches   Apply custom patches from .custom-node-patches/
 *   --help             Show help
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import colors from 'yoctocolors-cjs'

import { buildNode, configureNode, ensurePython, ensureVSBuildTools } from './configure.mjs'
import { exec, execCapture, logger } from './core.mjs'
import { downloadNodeSource } from './download.mjs'
import { loadBuildConfig } from './load-config.mjs'
import {
  applyCodeModifications,
  applyCustomPatches,
  applyPatch,
  applyVersionSpecificFixes,
  findYaoPkgPatch,
} from './patches.mjs'
import { copyToPkgCache, postProcessBinary } from './post-process.mjs'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configuration
const ROOT_DIR = path.join(__dirname, '../..')
const BUILD_LOCK_PATH = path.join(__dirname, 'build-lock.json')
const BUILD_DIR = path.join(ROOT_DIR, 'build', 'socket-node')
const CUSTOM_PATCHES_DIR = path.join(ROOT_DIR, 'build', 'patches', 'socket')

// Load and update build lock file
function loadBuildLock() {
  try {
    if (existsSync(BUILD_LOCK_PATH)) {
      return JSON.parse(readFileSync(BUILD_LOCK_PATH, 'utf8'))
    }
  } catch {
    // Lock file may not exist yet, that's OK
  }
  return {
    version: '1.0.0',
    node_versions: {},
    builds: { history: [] },
    patches: {},
    cache: { binaries: {} }
  }
}

async function _saveBuildLock(lockData) {
  lockData.generated = new Date().toISOString()
  await fs.writeFile(BUILD_LOCK_PATH, JSON.stringify(lockData, null, 2))
}

const BUILD_CONFIG = loadBuildConfig()
const _BUILD_LOCK = loadBuildLock()

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const defaultVersion = BUILD_CONFIG?.node?.currentVersion || 'v24.9.0'
  const options = {
    nodeVersion: defaultVersion,
    skipDownload: false,
    skipYaoPatch: false,
    customPatches: false,
    skipCodeMods: false,
    help: false
  }

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg.startsWith('--version=')) {
      options.nodeVersion = arg.split('=')[1]
    } else if (arg === '--skip-download') {
      options.skipDownload = true
    } else if (arg === '--skip-yao-patch') {
      options.skipYaoPatch = true
    } else if (arg === '--custom-patches') {
      options.customPatches = true
    } else if (arg === '--skip-code-mods') {
      options.skipCodeMods = true
    }
  }

  return options
}

// Show help
function showHelp() {
  logger.log(`Socket CLI Custom Node Builder
==============================

Usage: node scripts/build-socket-node.mjs [options]

Options:
  --version=VERSION   Node.js version to build (default: v24.9.0)
                      Examples: --version=v24.9.0, --version=v22.19.0
  --skip-download     Skip downloading if source already exists
  --skip-yao-patch    Skip applying yao-pkg patches
  --custom-patches    Apply custom patches from build/socket-node/patches/
  --skip-code-mods    Skip V8 flags and node-gyp modifications
  --help, -h          Show this help

Examples:
  # Build default version (v24.9.0)
  node scripts/build-socket-node.mjs

  # Build specific version
  node scripts/build-socket-node.mjs --version=v22.19.0

  # Rebuild existing source with custom patches
  node scripts/build-socket-node.mjs --skip-download --custom-patches

Custom Patches:
  Place .patch files in build/patches/socket/ directory.
  They will be applied after yao-pkg patches.
`)
}

/**
 * Main build function
 */
async function main() {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    process.exit(0) // eslint-disable-line n/no-process-exit
  }

  const { customPatches, nodeVersion, skipCodeMods, skipDownload, skipYaoPatch } = options

  logger.log(`🔨 Building Custom Node.js ${nodeVersion}`)
  logger.log('='.repeat(50))
  logger.log('')

  // Setup directories
  const nodeDir = path.join(BUILD_DIR, `node-${nodeVersion}-custom`)
  await fs.mkdir(BUILD_DIR, { recursive: true })

  // Create custom patches directory if using custom patches
  if (customPatches && !existsSync(CUSTOM_PATCHES_DIR)) {
    await fs.mkdir(CUSTOM_PATCHES_DIR, { recursive: true })
    logger.log(`📁 Created custom patches directory: ${CUSTOM_PATCHES_DIR}`)
    logger.log('   Place your .patch files here')
    logger.log('')
  }

  // Download or reset Node.js source
  if (!skipDownload || !existsSync(nodeDir)) {
    await downloadNodeSource(nodeVersion, nodeDir, BUILD_DIR)
    logger.log('')
  } else {
    logger.log('📂 Using existing Node.js source...')
    logger.log('   Resetting to clean state...')
    await exec('git', ['init'], { cwd: nodeDir })
    await exec('git', ['add', '.'], { cwd: nodeDir })
    await exec('git', ['commit', '-m', 'Initial'], { cwd: nodeDir })
    await exec('git', ['reset', '--hard'], { cwd: nodeDir })
    await exec('git', ['clean', '-fdx'], { cwd: nodeDir })
    logger.log('')
  }

  // Apply yao-pkg patch
  if (!skipYaoPatch) {
    const yaoPatch = await findYaoPkgPatch(nodeVersion)

    if (yaoPatch) {
      const success = await applyPatch(yaoPatch, nodeDir, 'yao-pkg patch')
      if (!success && !customPatches) {
        throw new Error('Failed to apply yao-pkg patch')
      }
      logger.log("")
    } else {
      logger.warn(`No yao-pkg patch found for ${nodeVersion}`)
      logger.log('   The build may not work correctly with pkg')
      logger.log("")
    }
  }

  // Apply version-specific fixes (like V8 include path issues)
  await applyVersionSpecificFixes(nodeDir, nodeVersion, BUILD_CONFIG, CUSTOM_PATCHES_DIR)

  // Apply custom patches
  if (customPatches) {
    await applyCustomPatches(nodeDir, CUSTOM_PATCHES_DIR)
  }

  // Apply code modifications (V8 flags, node-gyp, etc.)
  if (!skipCodeMods) {
    await applyCodeModifications(nodeDir, nodeVersion, CUSTOM_PATCHES_DIR)
  }

  // Ensure prerequisites on Windows
  if (os.platform() === 'win32') {
    await ensureVSBuildTools(BUILD_DIR)
    await ensurePython(BUILD_DIR)
  }

  // Configure
  await configureNode(nodeDir, BUILD_CONFIG)
  logger.log("")

  // Build
  await buildNode(nodeDir)
  logger.log("")

  // Test the binary
  const binaryName = os.platform() === 'win32' ? 'node.exe' : 'node'
  const binaryPath = path.join(nodeDir, 'out', 'Release', binaryName)
  logger.success(' Testing binary...')

  const version = await execCapture(binaryPath, ['--version'], {
    env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' }
  })
  logger.log(`   Version: ${version}`)

  await exec(
    binaryPath,
    ['-e', 'console.log("Hello from custom Node.js!")'],
    { env: { ...process.env, PKG_EXECPATH: 'PKG_INVOKE_NODEJS' } }
  )

  // Post-process
  await postProcessBinary(binaryPath, BUILD_CONFIG)

  // Copy to pkg cache
  const cachePath = await copyToPkgCache(binaryPath, nodeVersion)

  // Copy to centralized binaries directory
  const centralBinaryDir = path.join(ROOT_DIR, 'binaries', 'socket-node')
  await fs.mkdir(centralBinaryDir, { recursive: true })
  const centralBinaryName = `node-${nodeVersion}-${os.platform() === 'darwin' ? 'macos' : os.platform()}-${process.arch}${os.platform() === 'win32' ? '.exe' : ''}`
  const centralBinaryPath = path.join(centralBinaryDir, centralBinaryName)
  await fs.copyFile(binaryPath, centralBinaryPath)
  logger.success(` Binary copied to: ${centralBinaryPath}`)

  // Summary
  logger.log("")
  logger.log('='.repeat(50))
  logger.log('🎉 Build Complete!')
  logger.log('='.repeat(50))
  logger.log("")
  logger.log(`📍 Binary location: ${binaryPath}`)
  logger.log(`📦 Pkg cache copy: ${cachePath}`)
  logger.log("")
  logger.log('📝 To use with pkg:')
  logger.log('   1. Update .config/pkg.json:')
  logger.log(`      "node": "${binaryPath}"`)
  logger.log("")
  logger.log('   2. Or use the cached version automatically')
  logger.log(`      The binary is available as: built-${nodeVersion}-${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`)
  logger.log("")
  logger.log('🚀 Next steps:')
  logger.log('   node scripts/build.mjs --sea')
  logger.log("")
}

// Run
main().catch(error => {
  logger.error('')
  logger.error(`${colors.red('✗')} Build failed:`, error.message)
  if (error.stack && process.env.DEBUG) {
    logger.error(error.stack)
  }
  process.exit(1) // eslint-disable-line n/no-process-exit
})
