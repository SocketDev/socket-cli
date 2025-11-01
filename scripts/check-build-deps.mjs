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
import { getDefaultLogger } from '@socketsecurity/lib/logger'
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
  getDefaultLogger().log('📦 Installing UPX...')

  try {
    if (IS_MACOS) {
      getDefaultLogger().log('   Using Homebrew...')
      const result = await spawn('brew', ['install', 'upx'], {
        stdio: 'inherit',
        shell: false,
      })
      return result.code === 0
    }
    if (IS_LINUX) {
      // Try apt first (Ubuntu/Debian)
      if (await commandExists('apt-get')) {
        getDefaultLogger().log('   Using apt-get...')
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
        getDefaultLogger().log('   Using dnf...')
        const result = await spawn('sudo', ['dnf', 'install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }

      // Try yum (older RHEL/CentOS)
      if (await commandExists('yum')) {
        getDefaultLogger().log('   Using yum...')
        const result = await spawn('sudo', ['yum', 'install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }
    } else if (IS_WINDOWS) {
      if (await commandExists('choco')) {
        getDefaultLogger().log('   Using Chocolatey...')
        const result = await spawn('choco', ['install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }
    }
  } catch (error) {
    getDefaultLogger().log(`   ${colors.red('✗')} Installation failed: ${error.message}`)
    return false
  }

  getDefaultLogger().log(`   ${colors.red('✗')} No supported package manager found`)
  return false
}

/**
 * Main check function
 */
async function main() {
  getDefaultLogger().log('🔍 Checking build dependencies...')
  getDefaultLogger().log('')

  const checks = []
  let hasErrors = false
  let hasWarnings = false

  // Check build tools
  getDefaultLogger().log('📋 Build Tools:')

  const gcc = await commandExists('gcc')
  const gccVersion = gcc ? await getVersion('gcc') : null
  checks.push({ name: 'gcc', required: true, found: gcc, version: gccVersion })
  getDefaultLogger().log(`   ${gcc ? `${colors.green('✓')}` : `${colors.red('✗')}`} gcc: ${gccVersion || 'not found'}`)
  if (!gcc) {
    hasErrors = true
  }

  const gxx = await commandExists('g++')
  const gxxVersion = gxx ? await getVersion('g++') : null
  checks.push({ name: 'g++', required: true, found: gxx, version: gxxVersion })
  getDefaultLogger().log(`   ${gxx ? `${colors.green('✓')}` : `${colors.red('✗')}`} g++: ${gxxVersion || 'not found'}`)
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
  getDefaultLogger().log(`   ${make ? `${colors.green('✓')}` : `${colors.red('✗')}`} make: ${makeVersion || 'not found'}`)
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
  getDefaultLogger().log(
    `   ${python ? `${colors.green('✓')}` : `${colors.red('✗')}`} python3: ${pythonVersion || 'not found'}`,
  )
  if (!python) {
    hasErrors = true
  }

  const git = await commandExists('git')
  const gitVersion = git ? await getVersion('git') : null
  checks.push({ name: 'git', required: true, found: git, version: gitVersion })
  getDefaultLogger().log(`   ${git ? `${colors.green('✓')}` : `${colors.red('✗')}`} git: ${gitVersion || 'not found'}`)
  if (!git) {
    hasErrors = true
  }

  getDefaultLogger().log('')

  // Check optional tools
  getDefaultLogger().log('🔧 Optional Tools:')

  const upx = await commandExists('upx')
  const upxVersion = upx ? await getVersion('upx') : null
  checks.push({ name: 'upx', required: false, found: upx, version: upxVersion })

  if (IS_MACOS) {
    getDefaultLogger().log('   ℹ️  UPX: not used on macOS (incompatible with code signing)')
  } else {
    getDefaultLogger().log(`   ${upx ? `${colors.green('✓')}` : `${colors.yellow('⚠')} `} upx: ${upxVersion || 'not found'}`)
    if (!upx) {
      hasWarnings = true
      getDefaultLogger().log(
        '      UPX enables 30-50% binary compression on Linux/Windows',
      )
      getDefaultLogger().log(
        '      Build will succeed without UPX but produce larger binaries',
      )
    }
  }

  getDefaultLogger().log('')

  // Check disk space
  getDefaultLogger().log('💾 Disk Space:')
  const diskSpace = await checkDiskSpace()
  getDefaultLogger().log(`   Available: ${diskSpace}`)
  getDefaultLogger().log('   Required: ~10GB for Node.js source and build')
  getDefaultLogger().log('')

  // Check existing build
  const nodeBuilt = existsSync(
    'build/node-smol/out/Release/node',
  )
  if (nodeBuilt) {
    getDefaultLogger().log(`${colors.green('✓')} Custom Node.js binary already built`)
    getDefaultLogger().log('   Location: build/node-smol/out/Release/node')
    getDefaultLogger().log('')
  }

  // Summary
  getDefaultLogger().log('📊 Summary:')
  const required = checks.filter(c => c.required)
  const optional = checks.filter(c => !c.required)

  const requiredOk = required.filter(c => c.found).length
  const optionalOk = optional.filter(c => c.found).length

  getDefaultLogger().log(
    `   Required: ${requiredOk}/${required.length} ` +
      `${requiredOk === required.length ? `${colors.green('✓')}` : `${colors.red('✗')}`}`,
  )
  getDefaultLogger().log(
    `   Optional: ${optionalOk}/${optional.length} ` +
      `${optionalOk === optional.length ? `${colors.green('✓')}` : `${colors.yellow('⚠')} `}`,
  )
  getDefaultLogger().log('')

  // Platform-specific installation instructions
  if (hasErrors) {
    getDefaultLogger().log(`${colors.red('✗')} Missing required dependencies!`)
    getDefaultLogger().log('')
    getDefaultLogger().log('📥 Installation instructions:')
    getDefaultLogger().log('')

    if (IS_MACOS) {
      getDefaultLogger().log('   macOS (Homebrew):')
      getDefaultLogger().log('   $ xcode-select --install')
      getDefaultLogger().log('   $ brew install python@3')
      getDefaultLogger().log('')
    } else if (IS_LINUX) {
      getDefaultLogger().log('   Ubuntu/Debian:')
      getDefaultLogger().log(
        '   $ sudo apt-get install build-essential python3 git upx-ucl',
      )
      getDefaultLogger().log('')
      getDefaultLogger().log('   RHEL/Fedora/CentOS:')
      getDefaultLogger().log('   $ sudo dnf install gcc gcc-c++ make python3 git upx')
      getDefaultLogger().log('')
    } else if (IS_WINDOWS) {
      getDefaultLogger().log('   Windows (Chocolatey):')
      getDefaultLogger().log(
        '   $ choco install visualstudio2022buildtools python git upx',
      )
      getDefaultLogger().log('')
      getDefaultLogger().log('   Or use WSL2 (recommended):')
      getDefaultLogger().log('   $ wsl --install -d Ubuntu')
      getDefaultLogger().log('')
    }

    process.exit(1)
  }

  // Offer to install UPX
  if (hasWarnings && !upx && !IS_MACOS && !IS_CI) {
    getDefaultLogger().log(`${colors.yellow('⚠')}  UPX is not installed`)
    getDefaultLogger().log('')
    getDefaultLogger().log('UPX compression benefits:')
    getDefaultLogger().log('   • 30-50% smaller binaries (~44MB → ~22-31MB)')
    getDefaultLogger().log('   • Fast decompression (~50ms startup overhead)')
    getDefaultLogger().log('   • Recommended for distribution builds')
    getDefaultLogger().log('')

    // In interactive mode, offer to install
    if (process.stdin.isTTY) {
      getDefaultLogger().log('Would you like to install UPX now? (y/N)')

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
          getDefaultLogger().log(`${colors.green('✓')} UPX installed successfully!`)
        } else {
          getDefaultLogger().log(`${colors.red('✗')} UPX installation failed`)
          getDefaultLogger().log('   You can install it manually later')
        }
      } else {
        getDefaultLogger().log('⏭️  Skipping UPX installation')
        getDefaultLogger().log(
          '   Build will continue but produce larger binaries (~44MB vs ~22-31MB)',
        )
      }
    } else {
      getDefaultLogger().log('ℹ️  To install UPX manually:')
      if (IS_LINUX) {
        getDefaultLogger().log('   $ sudo apt-get install upx-ucl  # Ubuntu/Debian')
        getDefaultLogger().log('   $ sudo dnf install upx          # RHEL/Fedora')
      } else if (IS_WINDOWS) {
        getDefaultLogger().log('   $ choco install upx')
      }
    }

    getDefaultLogger().log('')
  }

  // Success
  getDefaultLogger().log(`${colors.green('✓')} All required dependencies are available`)
  if (hasWarnings) {
    getDefaultLogger().log(
      `${colors.yellow('⚠')}  Some optional optimizations are unavailable (build will succeed)`,
    )
  }
  getDefaultLogger().log('')
  getDefaultLogger().log('Ready to build! Run:')
  getDefaultLogger().log('   pnpm run build:yao-pkg:node')
  getDefaultLogger().log('')
}

// Run checks
main().catch(error => {
  getDefaultLogger().error(`${colors.red('✗')} Dependency check failed:`, error.message)
  process.exit(1)
})
