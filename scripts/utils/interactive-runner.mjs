#!/usr/bin/env node
/**
 * @fileoverview Interactive command runner with Ctrl+O toggle for verbose output.
 * Uses registry/lib/stdio/mask when available, falls back to local implementation.
 */

import { spawn } from 'node:child_process'
import readline from 'node:readline'

import { spinner } from '@socketsecurity/registry/lib/spinner'

// TODO: Use registry exports once built and available:
// import { runWithMask } from '@socketsecurity/registry/lib/stdio/mask'
// export { runWithMask as runInteractive }

/**
 * Run a command with interactive output control.
 * Shows spinner by default, Ctrl+O toggles full output.
 */
export async function runInteractive(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const {
      cwd = process.cwd(),
      env = process.env,
      message = 'Running...',
      showOutput = false,
      toggleText = 'to see full output',
    } = options

    let verbose = showOutput
    let outputBuffer = []
    let isSpinning = !verbose

    // Start spinner if not verbose
    if (isSpinning) {
      spinner.start(`${message} (Ctrl+O ${toggleText})`)
    }

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    // Setup keyboard input handling
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin)
      process.stdin.setRawMode(true)

      const keypressHandler = (str, key) => {
        // Ctrl+O toggles verbose mode
        if (key && key.ctrl && key.name === 'o') {
          verbose = !verbose

          if (verbose) {
            // Stop spinner and show buffered output
            if (isSpinning) {
              spinner.stop()
              isSpinning = false
            }

            // Clear the current line
            process.stdout.write('\r\x1b[K')

            // Show buffered output
            if (outputBuffer.length > 0) {
              console.log('--- Output ---')
              outputBuffer.forEach(line => process.stdout.write(line))
              outputBuffer = []
            }
          } else {
            // Hide output and show spinner
            process.stdout.write('\r\x1b[K')
            if (!isSpinning) {
              spinner.start(`${message} (Ctrl+O ${toggleText})`)
              isSpinning = true
            }
          }
        }
        // Ctrl+C to cancel
        else if (key && key.ctrl && key.name === 'c') {
          child.kill('SIGTERM')
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false)
          }
          process.exit(130)
        }
      }

      process.stdin.on('keypress', keypressHandler)

      // Cleanup on exit
      child.on('exit', () => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
          process.stdin.removeListener('keypress', keypressHandler)
        }
      })
    }

    // Handle stdout
    if (child.stdout) {
      child.stdout.on('data', data => {
        const text = data.toString()
        if (verbose) {
          process.stdout.write(text)
        } else {
          // Buffer the output for later
          outputBuffer.push(text)

          // Keep buffer size reasonable (last 1000 lines)
          const lines = outputBuffer.join('').split('\n')
          if (lines.length > 1000) {
            outputBuffer = [lines.slice(-1000).join('\n')]
          }
        }
      })
    }

    // Handle stderr
    if (child.stderr) {
      child.stderr.on('data', data => {
        const text = data.toString()
        if (verbose) {
          process.stderr.write(text)
        } else {
          outputBuffer.push(text)
        }
      })
    }

    child.on('exit', code => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }

      if (isSpinning) {
        if (code === 0) {
          spinner.success(`${message} completed`)
        } else {
          spinner.fail(`${message} failed`)
          // Show buffered output on failure
          if (outputBuffer.length > 0 && !verbose) {
            console.log('\n--- Output ---')
            outputBuffer.forEach(line => process.stdout.write(line))
          }
        }
      }

      resolve(code || 0)
    })

    child.on('error', error => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }

      if (isSpinning) {
        spinner.fail(`${message} error`)
      }
      reject(error)
    })
  })
}

/**
 * Run multiple commands with interactive output.
 */
export async function runInteractiveSequence(commands) {
  for (const cmd of commands) {
    const { args, command, message, ...options } = cmd
    const exitCode = await runInteractive(command, args, {
      message,
      ...options,
    })
    if (exitCode !== 0) {
      return exitCode
    }
  }
  return 0
}
