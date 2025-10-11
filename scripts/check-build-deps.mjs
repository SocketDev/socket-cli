/**
 * @fileoverview Check and optionally install build dependencies for yao-pkg
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
import { spawn } from '@socketsecurity/registry/lib/spawn'

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
  console.log('📦 Installing UPX...')

  try {
    if (IS_MACOS) {
      console.log('   Using Homebrew...')
      const result = await spawn('brew', ['install', 'upx'], {
        stdio: 'inherit',
        shell: false,
      })
      return result.code === 0
    } else if (IS_LINUX) {
      // Try apt first (Ubuntu/Debian)
      if (await commandExists('apt-get')) {
        console.log('   Using apt-get...')
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
        console.log('   Using dnf...')
        const result = await spawn('sudo', ['dnf', 'install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }

      // Try yum (older RHEL/CentOS)
      if (await commandExists('yum')) {
        console.log('   Using yum...')
        const result = await spawn('sudo', ['yum', 'install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }
    } else if (IS_WINDOWS) {
      if (await commandExists('choco')) {
        console.log('   Using Chocolatey...')
        const result = await spawn('choco', ['install', '-y', 'upx'], {
          stdio: 'inherit',
          shell: false,
        })
        return result.code === 0
      }
    }
  } catch (error) {
    console.log(`   ❌ Installation failed: ${error.message}`)
    return false
  }

  console.log('   ❌ No supported package manager found')
  return false
}

/**
 * Main check function
 */
async function main() {
  console.log('🔍 Checking build dependencies...')
  console.log()

  const checks = []
  let hasErrors = false
  let hasWarnings = false

  // Check build tools
  console.log('📋 Build Tools:')

  const gcc = await commandExists('gcc')
  const gccVersion = gcc ? await getVersion('gcc') : null
  checks.push({ name: 'gcc', required: true, found: gcc, version: gccVersion })
  console.log(`   ${gcc ? '✅' : '❌'} gcc: ${gccVersion || 'not found'}`)
  if (!gcc) {
    hasErrors = true
  }

  const gxx = await commandExists('g++')
  const gxxVersion = gxx ? await getVersion('g++') : null
  checks.push({ name: 'g++', required: true, found: gxx, version: gxxVersion })
  console.log(`   ${gxx ? '✅' : '❌'} g++: ${gxxVersion || 'not found'}`)
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
  console.log(`   ${make ? '✅' : '❌'} make: ${makeVersion || 'not found'}`)
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
  console.log(
    `   ${python ? '✅' : '❌'} python3: ${pythonVersion || 'not found'}`,
  )
  if (!python) {
    hasErrors = true
  }

  const git = await commandExists('git')
  const gitVersion = git ? await getVersion('git') : null
  checks.push({ name: 'git', required: true, found: git, version: gitVersion })
  console.log(`   ${git ? '✅' : '❌'} git: ${gitVersion || 'not found'}`)
  if (!git) {
    hasErrors = true
  }

  console.log()

  // Check optional tools
  console.log('🔧 Optional Tools:')

  const upx = await commandExists('upx')
  const upxVersion = upx ? await getVersion('upx') : null
  checks.push({ name: 'upx', required: false, found: upx, version: upxVersion })

  if (IS_MACOS) {
    console.log(`   ℹ️  UPX: not used on macOS (incompatible with code signing)`)
  } else {
    console.log(`   ${upx ? '✅' : '⚠️ '} upx: ${upxVersion || 'not found'}`)
    if (!upx) {
      hasWarnings = true
      console.log(
        '      UPX enables 30-50% binary compression on Linux/Windows',
      )
      console.log(
        '      Build will succeed without UPX but produce larger binaries',
      )
    }
  }

  console.log()

  // Check disk space
  console.log('💾 Disk Space:')
  const diskSpace = await checkDiskSpace()
  console.log(`   Available: ${diskSpace}`)
  console.log('   Required: ~10GB for Node.js source and build')
  console.log()

  // Check existing build
  const nodeBuilt = existsSync(
    '.custom-node-build/node-yao-pkg/out/Release/node',
  )
  if (nodeBuilt) {
    console.log('✅ Custom Node.js binary already built')
    console.log('   Location: .custom-node-build/node-yao-pkg/out/Release/node')
    console.log()
  }

  // Summary
  console.log('📊 Summary:')
  const required = checks.filter(c => c.required)
  const optional = checks.filter(c => !c.required)

  const requiredOk = required.filter(c => c.found).length
  const optionalOk = optional.filter(c => c.found).length

  console.log(
    `   Required: ${requiredOk}/${required.length} ` +
      `${requiredOk === required.length ? '✅' : '❌'}`,
  )
  console.log(
    `   Optional: ${optionalOk}/${optional.length} ` +
      `${optionalOk === optional.length ? '✅' : '⚠️ '}`,
  )
  console.log()

  // Platform-specific installation instructions
  if (hasErrors) {
    console.log('❌ Missing required dependencies!')
    console.log()
    console.log('📥 Installation instructions:')
    console.log()

    if (IS_MACOS) {
      console.log('   macOS (Homebrew):')
      console.log('   $ xcode-select --install')
      console.log('   $ brew install python@3')
      console.log()
    } else if (IS_LINUX) {
      console.log('   Ubuntu/Debian:')
      console.log(
        '   $ sudo apt-get install build-essential python3 git upx-ucl',
      )
      console.log()
      console.log('   RHEL/Fedora/CentOS:')
      console.log('   $ sudo dnf install gcc gcc-c++ make python3 git upx')
      console.log()
    } else if (IS_WINDOWS) {
      console.log('   Windows (Chocolatey):')
      console.log(
        '   $ choco install visualstudio2022buildtools python git upx',
      )
      console.log()
      console.log('   Or use WSL2 (recommended):')
      console.log('   $ wsl --install -d Ubuntu')
      console.log()
    }

    process.exit(1)
  }

  // Offer to install UPX
  if (hasWarnings && !upx && !IS_MACOS && !IS_CI) {
    console.log('⚠️  UPX is not installed')
    console.log()
    console.log('UPX compression benefits:')
    console.log('   • 30-50% smaller binaries (~44MB → ~22-31MB)')
    console.log('   • Fast decompression (~50ms startup overhead)')
    console.log('   • Recommended for distribution builds')
    console.log()

    // In interactive mode, offer to install
    if (process.stdin.isTTY) {
      console.log('Would you like to install UPX now? (y/N)')

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
          console.log('✅ UPX installed successfully!')
        } else {
          console.log('❌ UPX installation failed')
          console.log('   You can install it manually later')
        }
      } else {
        console.log('⏭️  Skipping UPX installation')
        console.log(
          '   Build will continue but produce larger binaries (~44MB vs ~22-31MB)',
        )
      }
    } else {
      console.log('ℹ️  To install UPX manually:')
      if (IS_LINUX) {
        console.log('   $ sudo apt-get install upx-ucl  # Ubuntu/Debian')
        console.log('   $ sudo dnf install upx          # RHEL/Fedora')
      } else if (IS_WINDOWS) {
        console.log('   $ choco install upx')
      }
    }

    console.log()
  }

  // Success
  console.log('✅ All required dependencies are available')
  if (hasWarnings) {
    console.log(
      '⚠️  Some optional optimizations are unavailable (build will succeed)',
    )
  }
  console.log()
  console.log('Ready to build! Run:')
  console.log('   pnpm run build:yao-pkg:node')
  console.log()
}

// Run checks
main().catch(error => {
  console.error('❌ Dependency check failed:', error.message)
  process.exit(1)
})
