/**
 * @fileoverview Cleanup build artifacts and temporary files
 *
 * This script provides different cleanup modes:
 * - dist: Clean rollup output
 * - pkg: Clean pkg binaries
 * - node: Clean old Node.js builds (keeps current)
 * - all: Clean everything except current Node build
 * - full: Clean absolutely everything (requires rebuild)
 */

import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT_DIR = join(__dirname, '..')
const DIST_DIR = join(ROOT_DIR, 'dist')
const BUILD_DIR = join(ROOT_DIR, 'build')
const PKG_BINARIES_DIR = join(ROOT_DIR, 'pkg-binaries')
const CUSTOM_NODE_BUILD_DIR = join(ROOT_DIR, '.custom-node-build')
const NODE_MODULES_DIR = join(ROOT_DIR, 'node_modules')
const ROLLUP_CACHE_DIR = join(ROOT_DIR, '.rollup.cache')
const CACHE_DIR = join(ROOT_DIR, '.cache')

const mode = process.argv[2] || 'help'

/**
 * Get directory size in GB
 */
async function getDirSize(dirPath) {
  if (!existsSync(dirPath)) {
    return 0
  }

  let totalSize = 0

  async function walk(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          // eslint-disable-next-line no-await-in-loop
          await walk(entryPath)
        } else {
          // eslint-disable-next-line no-await-in-loop
          const stats = await stat(entryPath)
          totalSize += stats.size
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  await walk(dirPath)
  // Convert to GB
  return totalSize / (1024 * 1024 * 1024)
}

/**
 * Remove directory if it exists
 */
async function removeDir(dirPath, name) {
  if (existsSync(dirPath)) {
    const sizeGB = await getDirSize(dirPath)
    console.log(`🗑️  Removing ${name}...`)
    await rm(dirPath, { recursive: true, force: true })
    console.log(`   ✅ Removed ${name} (~${sizeGB.toFixed(1)} GB)`)
    return sizeGB
  }
  return 0
}

/**
 * Clean dist/ directory
 */
async function cleanDist() {
  console.log('🧹 Cleaning rollup output...')
  const removed = await removeDir(DIST_DIR, 'dist/')
  if (removed === 0) {
    console.log('   ℹ️  dist/ not found (already clean)')
  }
  console.log()
}

/**
 * Clean pkg binaries
 */
async function cleanPkg() {
  console.log('🧹 Cleaning pkg binaries...')
  let totalRemoved = 0

  // Clean pkg-binaries directory
  totalRemoved += await removeDir(PKG_BINARIES_DIR, 'pkg-binaries/')

  // Clean build directory
  totalRemoved += await removeDir(BUILD_DIR, 'build/')

  // Also remove any binaries in root (legacy cleanup)
  const rootBinaries = [
    'socket',
    'socket-macos-arm64',
    'socket-macos-x64',
    'socket-linux-x64',
    'socket-linux-arm64',
    'socket-win-x64',
    'socket-win-arm64',
  ]

  for (const binary of rootBinaries) {
    const binaryPath = join(ROOT_DIR, binary)
    if (existsSync(binaryPath)) {
      // eslint-disable-next-line no-await-in-loop
      await rm(binaryPath, { force: true })
      console.log(`   ✅ Removed ${binary} from root (legacy)`)
    }
  }

  if (totalRemoved === 0) {
    console.log('   ℹ️  No pkg binaries found (already clean)')
  }
  console.log()
}

/**
 * Clean old Node.js builds (keep current)
 */
async function cleanOldNode() {
  console.log('🧹 Cleaning old Node.js builds...')

  if (!existsSync(CUSTOM_NODE_BUILD_DIR)) {
    console.log('   ℹ️  .custom-node-build/ not found')
    console.log()
    return
  }

  const entries = await readdir(CUSTOM_NODE_BUILD_DIR, { withFileTypes: true })
  let totalRemoved = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    // Keep node-yao-pkg (current) and patches directory
    if (entry.name === 'node-yao-pkg' || entry.name === 'patches') {
      console.log(`   ⏭️  Keeping ${entry.name}/ (current build)`)
      continue
    }

    // Remove old builds
    const dirPath = join(CUSTOM_NODE_BUILD_DIR, entry.name)
    // eslint-disable-next-line no-await-in-loop
    totalRemoved += await removeDir(dirPath, entry.name + '/')
  }

  if (totalRemoved === 0) {
    console.log('   ℹ️  No old Node.js builds found')
  } else {
    console.log(`   🎉 Freed ~${totalRemoved.toFixed(1)} GB`)
  }
  console.log()
}

/**
 * Clean caches
 */
async function cleanCaches() {
  console.log('🧹 Cleaning caches...')
  await removeDir(ROLLUP_CACHE_DIR, '.rollup.cache/')
  await removeDir(CACHE_DIR, '.cache/')
  console.log()
}

/**
 * Clean current Node.js build
 */
async function cleanCurrentNode() {
  console.log('🧹 Cleaning current Node.js build...')
  console.log('   ⚠️  This will require rebuilding (30-60 minutes)')

  const removed = await removeDir(CUSTOM_NODE_BUILD_DIR, '.custom-node-build/')
  if (removed > 0) {
    console.log(`   🎉 Freed ~${removed.toFixed(1)} GB`)
    console.log('   📝 Rebuild with: pnpm run build:yao-pkg:node')
  }
  console.log()
}

/**
 * Clean node_modules
 */
async function cleanNodeModules() {
  console.log('🧹 Cleaning dependencies...')
  console.log('   ⚠️  This will require reinstalling (2-3 minutes)')

  const removed = await removeDir(NODE_MODULES_DIR, 'node_modules/')
  if (removed > 0) {
    console.log(`   🎉 Freed ~${removed.toFixed(1)} GB`)
    console.log('   📝 Reinstall with: pnpm install')
  }
  console.log()
}

/**
 * Show help
 */
function showHelp() {
  console.log('Socket CLI Cleanup Script')
  console.log()
  console.log('Usage: pnpm run cleanup [mode]')
  console.log()
  console.log('Modes:')
  console.log('  dist         Clean rollup output (dist/)')
  console.log('  pkg          Clean pkg binaries (pkg-binaries/, build/)')
  console.log('  node         Clean old Node.js builds (keep current)')
  console.log('  caches       Clean build caches')
  console.log('  all          Clean dist, pkg, old node, caches')
  console.log('  full         Clean everything including current Node build')
  console.log('  nuclear      Clean absolutely everything (node_modules too)')
  console.log('  help         Show this help')
  console.log()
  console.log('Examples:')
  console.log('  pnpm run cleanup dist         # Clean rollup output')
  console.log(
    '  pnpm run cleanup node         # Remove old Node builds (~40 GB)',
  )
  console.log('  pnpm run cleanup all          # Clean most build artifacts')
  console.log()
}

/**
 * Main cleanup function
 */
async function main() {
  switch (mode) {
    case 'dist':
      await cleanDist()
      break

    case 'pkg':
      await cleanPkg()
      break

    case 'node':
      await cleanOldNode()
      break

    case 'caches':
      await cleanCaches()
      break

    case 'all':
      console.log('🧹 Cleaning all build artifacts...')
      console.log()
      await cleanDist()
      await cleanPkg()
      await cleanOldNode()
      await cleanCaches()
      console.log('✅ Cleanup complete!')
      console.log(
        '   📝 Rebuild with: pnpm run build:dist:src && pnpm run build:yao-pkg',
      )
      console.log()
      break

    case 'full':
      console.log('🧹 Cleaning everything including current Node build...')
      console.log('   ⚠️  This will require full rebuild (30-60 minutes)')
      console.log()
      await cleanDist()
      await cleanPkg()
      await cleanCurrentNode()
      await cleanCaches()
      console.log('✅ Full cleanup complete!')
      console.log('   📝 Rebuild with:')
      console.log('      pnpm run build:yao-pkg:node  # 30-60 min')
      console.log('      pnpm run build:dist:src')
      console.log('      pnpm run build:yao-pkg')
      console.log()
      break

    case 'nuclear':
      console.log('💥 Nuclear cleanup - removing EVERYTHING...')
      console.log('   ⚠️  This will require full rebuild AND reinstall')
      console.log()
      await cleanDist()
      await cleanPkg()
      await cleanCurrentNode()
      await cleanCaches()
      await cleanNodeModules()
      console.log('✅ Nuclear cleanup complete!')
      console.log('   📝 Rebuild with:')
      console.log('      pnpm install                 # 2-3 min')
      console.log('      pnpm run build:yao-pkg:node  # 30-60 min')
      console.log('      pnpm run build:dist:src')
      console.log('      pnpm run build:yao-pkg')
      console.log()
      break

    case 'help':
    default:
      showHelp()
      break
  }
}

main().catch(error => {
  console.error('❌ Cleanup failed:', error.message)
  throw error
})
