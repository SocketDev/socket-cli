/**
 * Check and install Rust toolchain if needed.
 *
 * WHAT THIS DOES:
 * 1. Checks if Rust/cargo is installed
 * 2. Checks if wasm32-unknown-unknown target is installed
 * 3. Checks if wasm-pack is installed
 * 4. Installs missing components automatically
 *
 * RUST VERSION:
 * Uses stable Rust toolchain (auto-updated via rustup).
 */

import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'


const logger = getDefaultLogger()
/**
 * Execute command and wait for completion.
 */
async function exec(command, args, options = {}) {
  const result = await spawn(command, args, {
    stdio: options.stdio || 'pipe',
    stdioString: true,
    stripAnsi: false,
    ...options,
  })

  return {
    code: result.code ?? 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

const WIN32 = process.platform === 'win32'
const CARGO_HOME = process.env.CARGO_HOME || path.join(homedir(), '.cargo')
const CARGO_BIN = path.join(CARGO_HOME, 'bin')
const CARGO_PATH = path.join(CARGO_BIN, WIN32 ? 'cargo.exe' : 'cargo')
const RUSTUP_PATH = path.join(CARGO_BIN, WIN32 ? 'rustup.exe' : 'rustup')
const WASM_PACK_PATH = path.join(
  CARGO_BIN,
  WIN32 ? 'wasm-pack.exe' : 'wasm-pack',
)

/**
 * Check if a command exists.
 */
async function commandExists(command) {
  try {
    const result = await exec(WIN32 ? 'where' : 'which', [command])
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if Rust is installed.
 */
async function checkRustInstalled() {
  // Check in $CARGO_HOME/bin first.
  if (existsSync(CARGO_PATH)) {
    return true
  }

  // Check in PATH.
  return await commandExists('cargo')
}

/**
 * Install Rust via rustup (cross-platform).
 */
async function installRust() {
  logger.progress(
    'Installing Rust toolchain via rustup (this may take a few minutes)',
  )

  const isWindows = WIN32

  try {
    if (isWindows) {
      // Windows: Download and run rustup-init.exe.
      const rustupUrl = 'https://win.rustup.rs/x86_64'
      logger.substep(`Downloading rustup-init.exe from ${rustupUrl}`)

      const response = await fetch(rustupUrl)
      if (!response.ok) {
        throw new Error(`Failed to download rustup: ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()

      const tmpDir = path.join(CARGO_HOME, '.tmp')
      await fs.mkdir(tmpDir, { recursive: true })
      const exePath = path.join(tmpDir, 'rustup-init.exe')
      await fs.writeFile(exePath, Buffer.from(buffer))

      logger.substep('Running rustup-init.exe')
      const result = await exec(
        exePath,
        [
          '-y',
          '--default-toolchain',
          'stable',
          '--default-host',
          'x86_64-pc-windows-msvc',
        ],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            CARGO_HOME,
            RUSTUP_HOME:
              process.env.RUSTUP_HOME || path.join(homedir(), '.rustup'),
          },
        },
      )

      if (result.code !== 0) {
        throw new Error('rustup installation failed')
      }

      await fs.unlink(exePath)
    } else {
      // Linux/macOS: Download and run shell script.
      const rustupUrl = 'https://sh.rustup.rs'
      logger.substep(`Downloading rustup from ${rustupUrl}`)

      const response = await fetch(rustupUrl)
      if (!response.ok) {
        throw new Error(`Failed to download rustup: ${response.statusText}`)
      }

      const script = await response.text()

      const tmpDir = path.join(CARGO_HOME, '.tmp')
      await fs.mkdir(tmpDir, { recursive: true })
      const scriptPath = path.join(tmpDir, 'rustup-init.sh')
      await fs.writeFile(scriptPath, script, 'utf-8')

      logger.substep('Running rustup installer')
      const result = await exec(
        'sh',
        [scriptPath, '-y', '--default-toolchain', 'stable'],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            CARGO_HOME,
            RUSTUP_HOME:
              process.env.RUSTUP_HOME || path.join(homedir(), '.rustup'),
          },
        },
      )

      if (result.code !== 0) {
        throw new Error('rustup installation failed')
      }

      await fs.unlink(scriptPath)
    }

    logger.done('Rust installed successfully')
    return true
  } catch (e) {
    logger.error(`Failed to install Rust: ${e.message}`)
    logger.error('Please install manually: https://rustup.rs/')
    return false
  }
}

/**
 * Check if wasm32-unknown-unknown target is installed.
 */
async function checkWasmTargetInstalled() {
  const rustupCmd = existsSync(RUSTUP_PATH) ? RUSTUP_PATH : 'rustup'

  try {
    const result = await exec(rustupCmd, ['target', 'list', '--installed'], {
      stdio: 'pipe',
    })

    if (result.code !== 0) {
      return false
    }

    return result.stdout.includes('wasm32-unknown-unknown')
  } catch {
    return false
  }
}

/**
 * Install wasm32-unknown-unknown target.
 */
async function installWasmTarget() {
  logger.progress('Installing wasm32-unknown-unknown target')

  const rustupCmd = existsSync(RUSTUP_PATH) ? RUSTUP_PATH : 'rustup'

  const result = await exec(
    rustupCmd,
    ['target', 'add', 'wasm32-unknown-unknown'],
    {
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error('Failed to install wasm32 target')
    return false
  }

  logger.done('wasm32-unknown-unknown target installed')
  return true
}

/**
 * Check if wasm-pack is installed.
 */
async function checkWasmPackInstalled() {
  // Check in $CARGO_HOME/bin first.
  if (existsSync(WASM_PACK_PATH)) {
    return true
  }

  // Check in PATH.
  return await commandExists('wasm-pack')
}

/**
 * Install wasm-pack via cargo.
 */
async function installWasmPack() {
  logger.progress('Installing wasm-pack (this may take a few minutes)')

  const cargoCmd = existsSync(CARGO_PATH) ? CARGO_PATH : 'cargo'

  const result = await exec(cargoCmd, ['install', 'wasm-pack'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CARGO_HOME,
    },
  })

  if (result.code !== 0) {
    logger.error('Failed to install wasm-pack')
    return false
  }

  logger.done('wasm-pack installed successfully')
  return true
}

/**
 * Main check and install function.
 */
export async function checkRustToolchain() {
  logger.step('Checking Rust Toolchain')

  // Check Rust.
  const hasRust = await checkRustInstalled()
  if (!hasRust) {
    logger.warn('Rust not found')
    const installed = await installRust()
    if (!installed) {
      return false
    }
  } else {
    logger.info('Rust found')
  }

  // Check wasm32 target.
  const hasWasmTarget = await checkWasmTargetInstalled()
  if (!hasWasmTarget) {
    logger.warn('wasm32-unknown-unknown target not found')
    const installed = await installWasmTarget()
    if (!installed) {
      return false
    }
  } else {
    logger.info('wasm32-unknown-unknown target found')
  }

  // Check wasm-pack.
  const hasWasmPack = await checkWasmPackInstalled()
  if (!hasWasmPack) {
    logger.warn('wasm-pack not found')
    const installed = await installWasmPack()
    if (!installed) {
      return false
    }
  } else {
    logger.info('wasm-pack found')
  }

  logger.success('Rust Toolchain Ready')

  return true
}

/**
 * Get paths to Rust tools.
 */
export function getRustPaths() {
  return {
    cargo: existsSync(CARGO_PATH) ? CARGO_PATH : 'cargo',
    cargoHome: CARGO_HOME,
    rustup: existsSync(RUSTUP_PATH) ? RUSTUP_PATH : 'rustup',
    wasmPack: existsSync(WASM_PACK_PATH) ? WASM_PACK_PATH : 'wasm-pack',
  }
}

// Run if called directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const success = await checkRustToolchain()
  process.exit(success ? 0 : 1)
}
