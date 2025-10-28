/**
 * @fileoverview Check and optionally install build dependencies for smol
 *
 * This script verifies that all required build dependencies are available:
 * - Build tools (gcc, g++, make, python)
 * - UPX (optional, for compression)
 * - Git
 * - Disk space
 *
 * It can optionally install missing dependencies with user permission.
 */

import { existsSync } from 'node:fs'
import { platform } from 'node:os'

import { spawn } from '@socketsecurity/lib/spawn'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const IS_MACOS = platform() === 'darwin'
const IS_LINUX = platform() === 'linux'
const IS_WINDOWS = platform() === 'win32'
const IS_CI = process.env.CI === 'true'

/**
 * Execute a command and check if it exists
 */
async function commandExists(command) {
  try {
    const result = await spawn(IS_WINDOWS ? 'where' : 'which', [command], {
      stdio: 'pipe',
      shell: false,
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Get command version
 */
async function getVersion(command, args = ['--version']) {
  try {
    const result = await spawn(command, args, {
      stdio: 'pipe',
      shell: false,
    })
    if (result.code === 0) {
      return result.stdout.trim().split('\n')[0]
    }
  } catch {
    return null
  }
  return null
}

/**
 * Check disk space (simplified)
 */
async function checkDiskSpace() {
  try {
    const result = await spawn('df', ['-h', '.'], {
      stdio: 'pipe',
      shell: false,
    })
    if (result.code === 0) {
      const lines = result.stdout.trim().split('\n')
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/)
        return parts[3] // Available space
      }
    }
  } catch {
    return 'unknown'
  }
  return 'unknown'
}

/**
 * Install UPX via package manager
 */
async function installUpx() {
  logger.log('📦 Installing UPX...')

  try {
    if (IS_MACOS) {
      logger.log('   Using Homebrew...')
      const result = await spawn('brew', ['install', 'upx'], {
        stdio: 'inherit',
        shell: false,
      })
      return result.code === 0
    }
    if (IS_LINUX) {
      // Try apt first (Ubuntu/Debian)
      if (await commandExists('apt-get')) {
        logger.log('   Using apt-get...')
        const result = await spawn(
          'sudo',
          ['apt-get', 'install', '-y', 'upx-ucl'],
          {
            stdio: 'inherit',
            shell: false,
          },
        )
        return result.code === 0
      }

      // Try dnf (RHEL/Fedora)
      if (await commandExists('dnf')) {
        logger.log('   Using dnf...')
        const result = await spawn('sudo', ['dnf', 'install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }

      // Try yum (older RHEL/CentOS)
      if (await commandExists('yum')) {
        logger.log('   Using yum...')
        const result = await spawn('sudo', ['yum', 'install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }
    } else if (IS_WINDOWS) {
      if (await commandExists('choco')) {
        logger.log('   Using Chocolatey...')
        const result = await spawn('choco', ['install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }
    }
  } catch (error) {
    logger.log(`   ${colors.red('✗')} Installation failed: ${error.message}`)
    return false
  }

  logger.log(`   ${colors.red('✗')} No supported package manager found`)
  return false
}

/**
 * Main check function
 */
async function main() {
  logger.log('🔍 Checking build dependencies...')
  logger.log('')

  const checks = []
  let hasErrors = false
  let hasWarnings = false

  // Check build tools
  logger.log('📋 Build Tools:')

  const gcc = await commandExists('gcc')
  const gccVersion = gcc ? await getVersion('gcc') : null
  checks.push({ name: 'gcc', required: true, found: gcc, version: gccVersion })
  logger.log(`   ${gcc ? `${colors.green('✓')}` : `${colors.red('✗')}`} gcc: ${gccVersion || 'not found'}`)
  if (!gcc) {
    hasErrors = true
  }

  const gxx = await commandExists('g++')
  const gxxVersion = gxx ? await getVersion('g++') : null
  checks.push({ name: 'g++', required: true, found: gxx, version: gxxVersion })
  logger.log(`   ${gxx ? `${colors.green('✓')}` : `${colors.red('✗')}`} g++: ${gxxVersion || 'not found'}`)
  if (!gxx) {
    hasErrors = true
  }

  const make = await commandExists('make')
  const makeVersion = make ? await getVersion('make') : null
  checks.push({
    name: 'make',
    required: true,
    found: make,
    version: makeVersion,
  })
  logger.log(`   ${make ? `${colors.green('✓')}` : `${colors.red('✗')}`} make: ${makeVersion || 'not found'}`)
  if (!make) {
    hasErrors = true
  }

  const python = await commandExists('python3')
  const pythonVersion = python ? await getVersion('python3') : null
  checks.push({
    name: 'python3',
    required: true,
    found: python,
    version: pythonVersion,
  })
  logger.log(
    `   ${python ? `${colors.green('✓')}` : `${colors.red('✗')}`} python3: ${pythonVersion || 'not found'}`,
  )
  if (!python) {
    hasErrors = true
  }

  const git = await commandExists('git')
  const gitVersion = git ? await getVersion('git') : null
  checks.push({ name: 'git', required: true, found: git, version: gitVersion })
  logger.log(`   ${git ? `${colors.green('✓')}` : `${colors.red('✗')}`} git: ${gitVersion || 'not found'}`)
  if (!git) {
    hasErrors = true
  }

  logger.log('')

  // Check optional tools
  logger.log('🔧 Optional Tools:')

  const upx = await commandExists('upx')
  const upxVersion = upx ? await getVersion('upx') : null
  checks.push({ name: 'upx', required: false, found: upx, version: upxVersion })

  if (IS_MACOS) {
    logger.log('   ℹ️  UPX: not used on macOS (incompatible with code signing)')
  } else {
    logger.log(`   ${upx ? `${colors.green('✓')}` : `${colors.yellow('⚠')} `} upx: ${upxVersion || 'not found'}`)
    if (!upx) {
      hasWarnings = true
      logger.log(
        '      UPX enables 30-50% binary compression on Linux/Windows',
      )
      logger.log(
        '      Build will succeed without UPX but produce larger binaries',
      )
    }
  }

  logger.log('')

  // Check disk space
  logger.log('💾 Disk Space:')
  const diskSpace = await checkDiskSpace()
  logger.log(`   Available: ${diskSpace}`)
  logger.log('   Required: ~10GB for Node.js source and build')
  logger.log('')

  // Check existing build
  const nodeBuilt = existsSync(
    'build/node-smol/out/Release/node',
  )
  if (nodeBuilt) {
    logger.log(`${colors.green('✓')} Custom Node.js binary already built`)
    logger.log('   Location: build/node-smol/out/Release/node')
    logger.log('')
  }

  // Summary
  logger.log('📊 Summary:')
  const required = checks.filter(c => c.required)
  const optional = checks.filter(c => !c.required)

  const requiredOk = required.filter(c => c.found).length
  const optionalOk = optional.filter(c => c.found).length

  logger.log(
    `   Required: ${requiredOk}/${required.length} ` +
      `${requiredOk === required.length ? `${colors.green('✓')}` : `${colors.red('✗')}`}`,
  )
  logger.log(
    `   Optional: ${optionalOk}/${optional.length} ` +
      `${optionalOk === optional.length ? `${colors.green('✓')}` : `${colors.yellow('⚠')} `}`,
  )
  logger.log('')

  // Platform-specific installation instructions
  if (hasErrors) {
    logger.log(`${colors.red('✗')} Missing required dependencies!`)
    logger.log('')
    logger.log('📥 Installation instructions:')
    logger.log('')

    if (IS_MACOS) {
      logger.log('   macOS (Homebrew):')
      logger.log('   $ xcode-select --install')
      logger.log('   $ brew install python@3')
      logger.log('')
    } else if (IS_LINUX) {
      logger.log('   Ubuntu/Debian:')
      logger.log(
        '   $ sudo apt-get install build-essential python3 git upx-ucl',
      )
      logger.log('')
      logger.log('   RHEL/Fedora/CentOS:')
      logger.log('   $ sudo dnf install gcc gcc-c++ make python3 git upx')
      logger.log('')
    } else if (IS_WINDOWS) {
      logger.log('   Windows (Chocolatey):')
      logger.log(
        '   $ choco install visualstudio2022buildtools python git upx',
      )
      logger.log('')
      logger.log('   Or use WSL2 (recommended):')
      logger.log('   $ wsl --install -d Ubuntu')
      logger.log('')
    }

    process.exit(1)
  }

  // Offer to install UPX
  if (hasWarnings && !upx && !IS_MACOS && !IS_CI) {
    logger.log(`${colors.yellow('⚠')}  UPX is not installed`)
    logger.log('')
    logger.log('UPX compression benefits:')
    logger.log('   • 30-50% smaller binaries (~44MB → ~22-31MB)')
    logger.log('   • Fast decompression (~50ms startup overhead)')
    logger.log('   • Recommended for distribution builds')
    logger.log('')

    // In interactive mode, offer to install
    if (process.stdin.isTTY) {
      logger.log('Would you like to install UPX now? (y/N)')

      // Read user input
      const readline = await import('node:readline')
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      const answer = await new Promise(resolve => {
        rl.question('', resolve)
      })
      rl.close()

      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        const success = await installUpx()
        if (success) {
          logger.log(`${colors.green('✓')} UPX installed successfully!`)
        } else {
          logger.log(`${colors.red('✗')} UPX installation failed`)
          logger.log('   You can install it manually later')
        }
      } else {
        logger.log('⏭️  Skipping UPX installation')
        logger.log(
          '   Build will continue but produce larger binaries (~44MB vs ~22-31MB)',
        )
      }
    } else {
      logger.log('ℹ️  To install UPX manually:')
      if (IS_LINUX) {
        logger.log('   $ sudo apt-get install upx-ucl  # Ubuntu/Debian')
        logger.log('   $ sudo dnf install upx          # RHEL/Fedora')
      } else if (IS_WINDOWS) {
        logger.log('   $ choco install upx')
      }
    }

    logger.log('')
  }

  // Success
  logger.log(`${colors.green('✓')} All required dependencies are available`)
  if (hasWarnings) {
    logger.log(
      `${colors.yellow('⚠')}  Some optional optimizations are unavailable (build will succeed)`,
    )
  }
  logger.log('')
  logger.log('Ready to build! Run:')
  logger.log('   pnpm run build:yao-pkg:node')
  logger.log('')
}

// Run checks
main().catch(error => {
  logger.error(`${colors.red('✗')} Dependency check failed:`, error.message)
  process.exit(1)
})
