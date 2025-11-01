#!/usr/bin/env node
/**
 * Node.js Binary Optimization Script
 *
 * Applies platform-specific optimizations to reduce custom Node.js binary sizes:
 * - macOS (darwin): strip, llvm-strip, code signing
 * - Linux: strip --strip-all, objcopy section removal
 * - Windows: strip --strip-all
 *
 * Target: Reduce from ~44MB to ~28-33MB per binary
 *
 * Usage:
 *   node packages/node-smol-builder/scripts/optimize.mjs <binary-path> [--platform=<platform>]
 *   node packages/node-smol-builder/scripts/optimize.mjs --all
 *   node packages/node-smol-builder/scripts/optimize.mjs              # Optimize build/out/Release/node
 */

import { execSync, spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { platform as osPlatform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const rootDir = path.join(packageDir, '../..')

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
  getDefaultLogger().log(`  $ ${command} ${args.join(' ')}`)
  try {
    execSync(`${command} ${args.join(' ')}`, {
      stdio: 'inherit',
      ...options,
    })
    return true
  } catch (e) {
    getDefaultLogger().error(`  ✗ Command failed: ${e.message}`)
    return false
  }
}

/**
 * Optimize binary for macOS (darwin).
 */
async function optimizeDarwin(binaryPath) {
  getDefaultLogger().log('\n🍎 Optimizing macOS binary...')

  const beforeSize = await getFileSizeMB(binaryPath)
  getDefaultLogger().log(`  Before: ${beforeSize} MB`)

  // Phase 1: Basic stripping.
  if (commandExists('strip')) {
    getDefaultLogger().log('\n  Phase 1: Basic stripping')
    exec('strip', [binaryPath])
  }

  // Phase 2: Aggressive stripping with llvm-strip (often better than strip on macOS).
  if (commandExists('llvm-strip')) {
    getDefaultLogger().log('\n  Phase 2: LLVM aggressive stripping')
    exec('llvm-strip', [binaryPath])
  } else {
    getDefaultLogger().log('\n  Phase 2: Aggressive stripping (strip --strip-all)')
    exec('strip', ['--strip-all', binaryPath])
  }

  // Phase 3: Remove unnecessary Mach-O sections.
  getDefaultLogger().log('\n  Phase 3: Remove unnecessary sections')
  // Note: Most Mach-O section removal requires specialized tools.
  // strip and llvm-strip already handle this well.

  const afterSize = await getFileSizeMB(binaryPath)
  const savings = ((beforeSize - afterSize) / beforeSize * 100).toFixed(1)
  getDefaultLogger().log(`\n  After: ${afterSize} MB (${savings}% reduction)`)

  // Re-sign binary if on macOS ARM64 (required).
  if (osPlatform() === 'darwin' && process.arch === 'arm64') {
    getDefaultLogger().log('\n  Phase 4: Code signing')
    exec('codesign', ['--force', '--sign', '-', binaryPath])
  }

  return { before: parseFloat(beforeSize), after: parseFloat(afterSize), savings: parseFloat(savings) }
}

/**
 * Optimize binary for Linux.
 */
async function optimizeLinux(binaryPath) {
  getDefaultLogger().log('\n🐧 Optimizing Linux binary...')

  const beforeSize = await getFileSizeMB(binaryPath)
  getDefaultLogger().log(`  Before: ${beforeSize} MB`)

  // Phase 1: Aggressive stripping.
  getDefaultLogger().log('\n  Phase 1: Aggressive stripping')
  exec('strip', ['--strip-all', binaryPath])

  // Phase 2: Remove unnecessary ELF sections.
  if (commandExists('objcopy')) {
    getDefaultLogger().log('\n  Phase 2: Remove unnecessary ELF sections')
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
    getDefaultLogger().log('\n  Phase 3: Super strip (removes section headers)')
    exec('sstrip', [binaryPath])
  }

  const afterSize = await getFileSizeMB(binaryPath)
  const savings = ((beforeSize - afterSize) / beforeSize * 100).toFixed(1)
  getDefaultLogger().log(`\n  After: ${afterSize} MB (${savings}% reduction)`)

  return { before: parseFloat(beforeSize), after: parseFloat(afterSize), savings: parseFloat(savings) }
}

/**
 * Optimize binary for Windows.
 */
async function optimizeWindows(binaryPath) {
  getDefaultLogger().log('\n🪟 Optimizing Windows binary...')

  const beforeSize = await getFileSizeMB(binaryPath)
  getDefaultLogger().log(`  Before: ${beforeSize} MB`)

  // Phase 1: Aggressive stripping.
  // Note: Windows binaries are typically cross-compiled on Linux/macOS with mingw.
  getDefaultLogger().log('\n  Phase 1: Aggressive stripping')

  // Try mingw-strip for Windows binaries.
  if (commandExists('x86_64-w64-mingw32-strip')) {
    exec('x86_64-w64-mingw32-strip', ['--strip-all', binaryPath])
  } else if (commandExists('strip')) {
    exec('strip', ['--strip-all', binaryPath])
  }

  const afterSize = await getFileSizeMB(binaryPath)
  const savings = ((beforeSize - afterSize) / beforeSize * 100).toFixed(1)
  getDefaultLogger().log(`\n  After: ${afterSize} MB (${savings}% reduction)`)

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
      platform = 'win32`
    } else {
      platform = osPlatform()
    }
  }

  getDefaultLogger().log(`\n📦 Optimizing: ${path.basename(binaryPath)}`)
  getDefaultLogger().log(`   Platform: ${platform}`)

  // Check binary exists.
  if (!existsSync(binaryPath)) {
    getDefaultLogger().error(`\n${colors.red('✗')} Binary not found: ${binaryPath}`)
    return null
  }

  // Apply platform-specific optimizations.
  let result
  switch (platform) {
    case `darwin':
      result = await optimizeDarwin(binaryPath)
      break
    case 'linux':
    case 'alpine':
      result = await optimizeLinux(binaryPath)
      break
    case 'win32`:
      result = await optimizeWindows(binaryPath)
      break
    default:
      getDefaultLogger().error(`\n${colors.red('✗')} Unsupported platform: ${platform}`)
      return null
  }

  getDefaultLogger().log(`\n${colors.green('✓')} Optimization complete!`)
  return result
}

/**
 * Find and optimize all platform binaries.
 */
async function optimizeAllBinaries() {
  getDefaultLogger().log(`🔍 Finding all platform binaries...\n')

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
    getDefaultLogger().log(`${colors.yellow('⚠')}  No binaries found to optimize`)
    getDefaultLogger().log('   Run build first: pnpm run build:platforms')
    return []
  }

  getDefaultLogger().log(`Found ${binaries.length} binaries to optimize:\n`)
  binaries.forEach(b => getDefaultLogger().log(`  - ${path.relative(rootDir, b)}`))

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
  getDefaultLogger().log('⚡ Node.js Binary Size Optimizer')
  getDefaultLogger().log('=' .repeat(50))

  let results = []

  if (optimizeAll) {
    results = await optimizeAllBinaries()
  } else {
    // Default to build/out/Release/node if no binary specified.
    if (!binaryPath) {
      binaryPath = path.join(packageDir, 'build/out/Release/node')
      if (!existsSync(binaryPath)) {
        getDefaultLogger().error(`\n${colors.red('✗')} Error: No binary found at default path`)
        getDefaultLogger().log('\nUsage:')
        getDefaultLogger().log('  node packages/node-smol-builder/scripts/optimize.mjs [binary-path] [--platform=<platform>]')
        getDefaultLogger().log('  node packages/node-smol-builder/scripts/optimize.mjs --all')
        getDefaultLogger().log('\nExamples:')
        getDefaultLogger().log('  node packages/node-smol-builder/scripts/optimize.mjs')
        getDefaultLogger().log('  node packages/node-smol-builder/scripts/optimize.mjs build/out/Release/node')
        getDefaultLogger().log('  node packages/node-smol-builder/scripts/optimize.mjs --all')
        getDefaultLogger().log(`\nDefault path: ${binaryPath}`)
        process.exit(1)
      }
    }

    const result = await optimizeBinary(binaryPath, targetPlatform)
    if (result) {
      results.push({ path: binaryPath, ...result })
    }
  }

  // Summary.
  if (results.length > 0) {
    getDefaultLogger().log('\n' + '='.repeat(50))
    getDefaultLogger().log('📊 Optimization Summary')
    getDefaultLogger().log('='.repeat(50))
    getDefaultLogger().log('')

    let totalBefore = 0
    let totalAfter = 0

    for (const { path: binPath, before, after, savings } of results) {
      totalBefore += before
      totalAfter += after
      getDefaultLogger().log(`  ${path.basename(binPath)}:`)
      getDefaultLogger().log(`    Before: ${before.toFixed(2)} MB`)
      getDefaultLogger().log(`    After:  ${after.toFixed(2)} MB`)
      getDefaultLogger().log(`    Saved:  ${(before - after).toFixed(2)} MB (${savings.toFixed(1)}%)`)
      getDefaultLogger().log('')
    }

    if (results.length > 1) {
      const totalSavings = ((totalBefore - totalAfter) / totalBefore * 100).toFixed(1)
      getDefaultLogger().log('  Total:')
      getDefaultLogger().log(`    Before: ${totalBefore.toFixed(2)} MB`)
      getDefaultLogger().log(`    After:  ${totalAfter.toFixed(2)} MB`)
      getDefaultLogger().log(`    Saved:  ${(totalBefore - totalAfter).toFixed(2)} MB (${totalSavings}%)`)
    }

    getDefaultLogger().log(`\n${colors.green('✓')} All optimizations complete!`)
  }
}

main().catch(error => {
  getDefaultLogger().error(`\n${colors.red('✗')} Optimization failed:`, error.message)
  process.exit(1)
})
