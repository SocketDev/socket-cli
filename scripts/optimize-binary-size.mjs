#!/usr/bin/env node
/**
 * Binary Size Optimization Script
 *
 * Applies platform-specific optimizations to reduce Socket CLI binary sizes:
 * - macOS (darwin): strip, llvm-strip, code signing
 * - Linux: strip --strip-all, objcopy section removal
 * - Windows: strip --strip-all
 *
 * Target: Reduce from ~49MB to ~18-28MB per binary
 *
 * Usage:
 *   node scripts/optimize-binary-size.mjs <binary-path> [--platform=<platform>]
 *   node scripts/optimize-binary-size.mjs --all
 */

import { execSync, spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { platform as osPlatform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'


const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

// Parse command line arguments.
const args = process.argv.slice(2)
let binaryPath = null
let targetPlatform = null
let optimizeAll = false

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--all') {
    optimizeAll = true
  } else if (arg.startsWith('--platform=')) {
    targetPlatform = arg.slice(11)
  } else if (!arg.startsWith('--')) {
    binaryPath = arg
  }
}

/**
 * Get file size in MB.
 */
async function getFileSizeMB(filePath) {
  const stats = await fs.stat(filePath)
  return (stats.size / (1024 * 1024)).toFixed(2)
}

/**
 * Check if a command exists.
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Execute a command with error handling.
 */
function exec(command, args, options = {}) {
  logger.log(`  $ ${command} ${args.join(' ')}`)
  try {
    execSync(`${command} ${args.join(' ')}`, {
      stdio: 'inherit',
      ...options,
    })
    return true
  } catch (e) {
    logger.error(`  ✗ Command failed: ${e.message}`)
    return false
  }
}

/**
 * Optimize binary for macOS (darwin).
 */
async function optimizeDarwin(binaryPath) {
  logger.log('\n🍎 Optimizing macOS binary...')

  const beforeSize = await getFileSizeMB(binaryPath)
  logger.log(`  Before: ${beforeSize} MB`)

  // Phase 1: Basic stripping.
  if (commandExists('strip')) {
    logger.log('\n  Phase 1: Basic stripping')
    exec('strip', [binaryPath])
  }

  // Phase 2: Aggressive stripping with llvm-strip (often better than strip on macOS).
  if (commandExists('llvm-strip')) {
    logger.log('\n  Phase 2: LLVM aggressive stripping')
    exec('llvm-strip', [binaryPath])
  } else {
    logger.log('\n  Phase 2: Aggressive stripping (strip --strip-all)')
    exec('strip', ['--strip-all', binaryPath])
  }

  // Phase 3: Remove unnecessary Mach-O sections.
  logger.log('\n  Phase 3: Remove unnecessary sections')
  // Note: Most Mach-O section removal requires specialized tools.
  // strip and llvm-strip already handle this well.

  const afterSize = await getFileSizeMB(binaryPath)
  const savings = ((beforeSize - afterSize) / beforeSize * 100).toFixed(1)
  logger.log(`\n  After: ${afterSize} MB (${savings}% reduction)`)

  // Re-sign binary if on macOS ARM64 (required).
  if (osPlatform() === 'darwin' && process.arch === 'arm64') {
    logger.log('\n  Phase 4: Code signing')
    exec('codesign', ['--force', '--sign', '-', binaryPath])
  }

  return { before: parseFloat(beforeSize), after: parseFloat(afterSize), savings: parseFloat(savings) }
}

/**
 * Optimize binary for Linux.
 */
async function optimizeLinux(binaryPath) {
  logger.log('\n🐧 Optimizing Linux binary...')

  const beforeSize = await getFileSizeMB(binaryPath)
  logger.log(`  Before: ${beforeSize} MB`)

  // Phase 1: Aggressive stripping.
  logger.log('\n  Phase 1: Aggressive stripping')
  exec('strip', ['--strip-all', binaryPath])

  // Phase 2: Remove unnecessary ELF sections.
  if (commandExists('objcopy')) {
    logger.log('\n  Phase 2: Remove unnecessary ELF sections')
    const sections = [
      '.note.ABI-tag',
      '.note.gnu.build-id',
      '.comment',
      '.gnu.version',
    ]

    for (const section of sections) {
      exec('objcopy', [`--remove-section=${section}`, binaryPath])
    }
  }

  // Phase 3: Super strip (sstrip) if available.
  if (commandExists('sstrip')) {
    logger.log('\n  Phase 3: Super strip (removes section headers)')
    exec('sstrip', [binaryPath])
  }

  const afterSize = await getFileSizeMB(binaryPath)
  const savings = ((beforeSize - afterSize) / beforeSize * 100).toFixed(1)
  logger.log(`\n  After: ${afterSize} MB (${savings}% reduction)`)

  return { before: parseFloat(beforeSize), after: parseFloat(afterSize), savings: parseFloat(savings) }
}

/**
 * Optimize binary for Windows.
 */
async function optimizeWindows(binaryPath) {
  logger.log('\n🪟 Optimizing Windows binary...')

  const beforeSize = await getFileSizeMB(binaryPath)
  logger.log(`  Before: ${beforeSize} MB`)

  // Phase 1: Aggressive stripping.
  // Note: Windows binaries are typically cross-compiled on Linux/macOS with mingw.
  logger.log('\n  Phase 1: Aggressive stripping')

  // Try mingw-strip for Windows binaries.
  if (commandExists('x86_64-w64-mingw32-strip')) {
    exec('x86_64-w64-mingw32-strip', ['--strip-all', binaryPath])
  } else if (commandExists('strip')) {
    exec('strip', ['--strip-all', binaryPath])
  }

  const afterSize = await getFileSizeMB(binaryPath)
  const savings = ((beforeSize - afterSize) / beforeSize * 100).toFixed(1)
  logger.log(`\n  After: ${afterSize} MB (${savings}% reduction)`)

  return { before: parseFloat(beforeSize), after: parseFloat(afterSize), savings: parseFloat(savings) }
}

/**
 * Optimize a single binary.
 */
async function optimizeBinary(binaryPath, platform) {
  // Detect platform from binary path if not specified.
  if (!platform) {
    if (binaryPath.includes('darwin')) {
      platform = 'darwin'
    } else if (binaryPath.includes('linux') || binaryPath.includes('alpine')) {
      platform = 'linux'
    } else if (binaryPath.includes('win32') || binaryPath.endsWith('.exe')) {
      platform = 'win32'
    } else {
      platform = osPlatform()
    }
  }

  logger.log(`\n📦 Optimizing: ${path.basename(binaryPath)}`)
  logger.log(`   Platform: ${platform}`)

  // Check binary exists.
  if (!existsSync(binaryPath)) {
    logger.error(`\n${colors.red('✗')} Binary not found: ${binaryPath}`)
    return null
  }

  // Apply platform-specific optimizations.
  let result
  switch (platform) {
    case 'darwin':
      result = await optimizeDarwin(binaryPath)
      break
    case 'linux':
    case 'alpine':
      result = await optimizeLinux(binaryPath)
      break
    case 'win32':
      result = await optimizeWindows(binaryPath)
      break
    default:
      logger.error(`\n${colors.red('✗')} Unsupported platform: ${platform}`)
      return null
  }

  logger.log(`\n${colors.green('✓')} Optimization complete!`)
  return result
}

/**
 * Find and optimize all platform binaries.
 */
async function optimizeAllBinaries() {
  logger.log('🔍 Finding all platform binaries...\n')

  const packagesDir = path.join(rootDir, 'packages')
  const binaryPatterns = [
    'socketbin-cli-*/bin/socket',
    'socketbin-cli-*/bin/socket.exe',
  ]

  const binaries = []
  for (const pattern of binaryPatterns) {
    const [dir, file] = pattern.split('/')
    const packages = await fs.readdir(packagesDir)

    for (const pkg of packages) {
      if (pkg.startsWith('socketbin-cli-')) {
        const binPath = path.join(packagesDir, pkg, 'bin', file.replace('*', ''))
        if (existsSync(binPath)) {
          const stats = await fs.stat(binPath)
          // Only process actual binaries (>1MB), not placeholders.
          if (stats.size > 1024 * 1024) {
            binaries.push(binPath)
          }
        }
      }
    }
  }

  if (binaries.length === 0) {
    logger.log(`${colors.yellow('⚠')}  No binaries found to optimize`)
    logger.log('   Run build first: pnpm run build:platforms')
    return []
  }

  logger.log(`Found ${binaries.length} binaries to optimize:\n`)
  binaries.forEach(b => logger.log(`  - ${path.relative(rootDir, b)}`))

  const results = []
  for (const binaryPath of binaries) {
    const result = await optimizeBinary(binaryPath, null)
    if (result) {
      results.push({ path: binaryPath, ...result })
    }
  }

  return results
}

/**
 * Main entry point.
 */
async function main() {
  logger.log('⚡ Socket CLI Binary Size Optimizer')
  logger.log('=' .repeat(50))

  let results = []

  if (optimizeAll) {
    results = await optimizeAllBinaries()
  } else if (binaryPath) {
    const result = await optimizeBinary(binaryPath, targetPlatform)
    if (result) {
      results.push({ path: binaryPath, ...result })
    }
  } else {
    logger.error(`\n${colors.red('✗')} Error: No binary specified`)
    logger.log('\nUsage:')
    logger.log('  node scripts/optimize-binary-size.mjs <binary-path> [--platform=<platform>]')
    logger.log('  node scripts/optimize-binary-size.mjs --all')
    logger.log('\nExamples:')
    logger.log('  node scripts/optimize-binary-size.mjs packages/socketbin-cli-darwin-arm64/bin/socket')
    logger.log('  node scripts/optimize-binary-size.mjs build/out/Release/node --platform=linux')
    logger.log('  node scripts/optimize-binary-size.mjs --all')
    process.exit(1)
  }

  // Summary.
  if (results.length > 0) {
    logger.log('\n' + '='.repeat(50))
    logger.log('📊 Optimization Summary')
    logger.log('='.repeat(50))
    logger.log('')

    let totalBefore = 0
    let totalAfter = 0

    for (const { path: binPath, before, after, savings } of results) {
      totalBefore += before
      totalAfter += after
      logger.log(`  ${path.basename(binPath)}:`)
      logger.log(`    Before: ${before.toFixed(2)} MB`)
      logger.log(`    After:  ${after.toFixed(2)} MB`)
      logger.log(`    Saved:  ${(before - after).toFixed(2)} MB (${savings.toFixed(1)}%)`)
      logger.log('')
    }

    if (results.length > 1) {
      const totalSavings = ((totalBefore - totalAfter) / totalBefore * 100).toFixed(1)
      logger.log('  Total:')
      logger.log(`    Before: ${totalBefore.toFixed(2)} MB`)
      logger.log(`    After:  ${totalAfter.toFixed(2)} MB`)
      logger.log(`    Saved:  ${(totalBefore - totalAfter).toFixed(2)} MB (${totalSavings}%)`)
    }

    logger.log(`\n${colors.green('✓')} All optimizations complete!`)
  }
}

main().catch(error => {
  logger.error(`\n${colors.red('✗')} Optimization failed:`, error.message)
  process.exit(1)
})
