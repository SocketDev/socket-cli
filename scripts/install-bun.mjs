/**
 * @fileoverview Script to install Bun runtime.
 */

import { spawn } from 'node:child_process'
import { platform } from 'node:process'

import { logger } from '@socketsecurity/registry/lib/logger'
import { printHeader } from '@socketsecurity/registry/lib/stdio/header'

/**
 * Run command and return exit code.
 */
function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options,
    })

    child.on('close', code => {
      resolve(code ?? 0)
    })

    child.on('error', () => {
      resolve(1)
    })
  })
}

async function main() {
  printHeader('Bun Installer')
  logger.logNewline()

  logger.log('This script will install Bun runtime on your system.')
  logger.logNewline()

  // Determine install command based on platform.
  let installCommand
  let installArgs

  if (platform === 'win32') {
    // Windows installation.
    installCommand = 'powershell'
    installArgs = [
      '-c',
      'irm bun.sh/install.ps1 | iex',
    ]
    logger.log('Installing Bun for Windows...')
  } else {
    // Unix-like systems (macOS, Linux).
    installCommand = 'bash'
    installArgs = [
      '-c',
      'curl -fsSL https://bun.sh/install | bash',
    ]
    logger.log('Installing Bun for Unix-like systems...')
  }

  logger.logNewline()
  logger.log('Installation command:')
  logger.log(`  ${installCommand} ${installArgs.join(' ')}`)
  logger.logNewline()

  const exitCode = await runCommand(installCommand, installArgs)

  if (exitCode !== 0) {
    logger.error('')
    logger.error('Bun installation failed.')
    logger.logNewline()
    logger.log('Please visit https://bun.sh for manual installation instructions.')
    process.exitCode = exitCode
    return
  }

  logger.success('✅ Bun installed successfully!')
  logger.logNewline()
  logger.log('You may need to restart your terminal or run:')

  if (platform === 'win32') {
    logger.log('  refreshenv')
  } else {
    logger.log('  source ~/.bashrc  # or ~/.zshrc, depending on your shell')
  }

  logger.logNewline()
  logger.log('Then verify the installation with:')
  logger.log('  bun --version')
  logger.logNewline()
}

main()
