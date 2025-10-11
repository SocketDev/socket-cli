/**
 * @fileoverview Core build utilities for command execution and file operations
 */

import childProcess from 'node:child_process'
import { promises as fs } from 'node:fs'

import colors from 'yoctocolors-cjs'

// Simple logger implementation
export const logger = {
  log: (msg) => console.log(msg),
  success: (msg) => console.log(`${colors.green('✓')} ${msg}`),
  warn: (msg) => console.warn(`${colors.yellow('⚠')} ${msg}`),
  error: (msg) => console.error(msg)
}

/**
 * Execute a command and stream output
 */
export async function exec(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

  logger.log(`$ ${command} ${args.join(' ')}`)

  const exitCode = await new Promise((resolve) => {
    const child = childProcess.spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
    })

    child.on('error', (error) => {
      logger.error(`Failed to execute ${command}: ${error.message}`)
      resolve(1)
    })

    child.on('close', (code) => {
      resolve(code ?? 0)
    })
  })

  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command} ${args.join(' ')}`)
  }
}

/**
 * Execute command quietly (no output unless error)
 */
export async function execQuiet(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

  const exitCode = await new Promise((resolve) => {
    const child = childProcess.spawn(command, args, {
      cwd,
      env,
      stdio: 'pipe',
      shell: false,
    })

    let stderr = ''

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      logger.error(`Failed to execute ${command}: ${error.message}`)
      resolve(1)
    })

    child.on('close', (code) => {
      if (code !== 0 && stderr) {
        logger.error(stderr)
      }
      resolve(code ?? 0)
    })
  })

  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command} ${args.join(' ')}`)
  }
}

/**
 * Execute command and capture output
 */
export async function execCapture(command, args = [], options = {}) {
  const { cwd = process.cwd(), env = process.env } = options

  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      reject(new Error(`Failed to execute ${command}: ${error.message}`))
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

/**
 * Robust file move with retry logic for cross-platform support
 */
export async function moveWithRetry(source, dest, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.rename(source, dest) // eslint-disable-line no-await-in-loop
      return
    } catch (error) {
      if (i === retries - 1) {throw error}

      // On some platforms, rename fails across filesystems
      // Try copy + delete
      try {
        await fs.copyFile(source, dest) // eslint-disable-line no-await-in-loop
        await fs.rm(source, { force: true }) // eslint-disable-line no-await-in-loop
        return
      } catch (copyError) {
        if (i === retries - 1) {throw copyError}
        await new Promise(resolve => setTimeout(resolve, 1000)) // eslint-disable-line no-await-in-loop
      }
    }
  }
}

/**
 * Create a simple spinner for long-running operations
 */
export function createSimpleSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let currentFrame = 0
  let interval

  return {
    start() {
      process.stdout.write(`${frames[0]} ${message}`)
      interval = setInterval(() => {
        currentFrame = (currentFrame + 1) % frames.length
        process.stdout.write(`\r${frames[currentFrame]} ${message}`)
      }, 80)
    },
    stop(success = true) {
      clearInterval(interval)
      process.stdout.write('\r\x1b[K')
      if (success) {
        logger.success(` ${message}`)
      }
    }
  }
}

/**
 * Create a build progress spinner with timing
 */
export function createBuildSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let currentFrame = 0
  let interval
  let startTime

  return {
    start() {
      startTime = Date.now()
      process.stdout.write(`${frames[0]} ${message}`)
      interval = setInterval(() => {
        currentFrame = (currentFrame + 1) % frames.length
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        const minutes = Math.floor(elapsed / 60)
        const seconds = elapsed % 60
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
        process.stdout.write(`\r${frames[currentFrame]} ${message} (${timeStr})`)
      }, 80)
    },
    stop(success = true) {
      clearInterval(interval)
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const minutes = Math.floor(elapsed / 60)
      const seconds = elapsed % 60
      const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

      // Clear the line
      process.stdout.write('\r\x1b[K')

      if (success) {
        logger.success(` Build completed successfully in ${timeStr}`)
      } else {
        logger.error(`${colors.red('✗')} Build failed after ${timeStr}`)
      }
    }
  }
}
