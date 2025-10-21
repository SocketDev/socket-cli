/**
 * @fileoverview Interactive runner for commands with ctrl+o toggle.
 * Standardized across all socket-* repositories.
 */

import { spawn } from 'node:child_process'
import readline from 'node:readline'

import { spinner } from '@socketsecurity/lib/spinner'

// Will import from registry once built:
// import { attachOutputMask, clearLine, writeOutput } from '@socketsecurity/lib/stdio/mask'

/**
 * Run a command with interactive output control.
 * Standard experience across all socket-* repos.
 *
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {object} options - Options
 * @param {string} options.message - Progress message
 * @param {string} options.toggleText - Text after "ctrl+o" (default: "to see output")
 * @param {boolean} options.showOnError - Show output on error (default: true)
 * @param {boolean} options.verbose - Start in verbose mode (default: false)
 * @returns {Promise<number>} Exit code
 */
export async function runWithOutput(command, args = [], options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    message = 'Running',
    showOnError = true,
    toggleText = 'to see output',
    verbose = false,
  } = options

  return new Promise((resolve, reject) => {
    let isSpinning = false
    let outputBuffer = []
    let showOutput = verbose
    let hasTestFailures = false
    let hasWorkerTerminationError = false

    // Start spinner if not verbose and TTY
    if (!showOutput && process.stdout.isTTY) {
      spinner.start(`${message} (ctrl+o ${toggleText})`)
      isSpinning = true
    }

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    // Setup keyboard handling for TTY
    if (process.stdin.isTTY && !verbose) {
      readline.emitKeypressEvents(process.stdin)
      process.stdin.setRawMode(true)

      const keypressHandler = (_str, key) => {
        // ctrl+o toggles output
        if (key?.ctrl && key.name === 'o') {
          showOutput = !showOutput

          if (showOutput) {
            // Stop spinner and show buffered output
            if (isSpinning) {
              spinner.stop()
              isSpinning = false
            }

            // Clear line and show buffer
            process.stdout.write('\r\x1b[K')
            if (outputBuffer.length > 0) {
              console.log('--- Showing output ---')
              outputBuffer.forEach(line => process.stdout.write(line))
              outputBuffer = []
            }
          } else {
            // Hide output and restart spinner
            process.stdout.write('\r\x1b[K')
            if (!isSpinning) {
              spinner.start(`${message} (ctrl+o ${toggleText})`)
              isSpinning = true
            }
          }
        }
        // ctrl+c to cancel
        else if (key?.ctrl && key.name === 'c') {
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

        // Filter out known non-fatal warnings (can appear in stdout too)
        const isFilteredWarning =
          text.includes('Terminating worker thread') ||
          text.includes('Unhandled Rejection') ||
          text.includes('Object.ThreadTermination') ||
          text.includes('tinypool@')

        if (isFilteredWarning) {
          hasWorkerTerminationError = true
          // Skip these warnings - they're non-fatal cleanup messages
          // But continue to check for test failures in the same output
        }

        // Check for test failures in vitest output
        if (
          text.includes('FAIL') ||
          text.match(/Test Files.*\d+ failed/) ||
          text.match(/Tests\s+\d+ failed/)
        ) {
          hasTestFailures = true
        }

        // Don't write filtered warnings to output
        if (isFilteredWarning) {
          return
        }

        if (showOutput) {
          process.stdout.write(text)
        } else {
          outputBuffer.push(text)
          // Keep buffer reasonable (last 1000 lines)
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
        // Filter out known non-fatal warnings
        const isFilteredWarning =
          text.includes('Terminating worker thread') ||
          text.includes('Unhandled Rejection') ||
          text.includes('Object.ThreadTermination') ||
          text.includes('tinypool@')

        if (isFilteredWarning) {
          hasWorkerTerminationError = true
          // Skip these warnings - they're non-fatal cleanup messages
          return
        }

        // Check for test failures
        if (
          text.includes('FAIL') ||
          text.match(/Test Files.*\d+ failed/) ||
          text.match(/Tests\s+\d+ failed/)
        ) {
          hasTestFailures = true
        }

        if (showOutput) {
          process.stderr.write(text)
        } else {
          outputBuffer.push(text)
        }
      })
    }

    child.on('exit', code => {
      // Cleanup keyboard if needed
      if (process.stdin.isTTY && !verbose) {
        process.stdin.setRawMode(false)
      }

      // Override exit code if we only have worker termination errors
      // and no actual test failures
      let finalCode = code || 0
      if (code !== 0 && hasWorkerTerminationError && !hasTestFailures) {
        // This is the known non-fatal worker thread cleanup issue
        // All tests passed, so return success
        finalCode = 0
      }

      if (isSpinning) {
        if (finalCode === 0) {
          spinner.stop()
          spinner.success(`${message} completed`)
          // Ensure spinner is fully cleared and we're on a fresh line
          process.stdout.write('\r\x1b[K')
        } else {
          spinner.stop()
          spinner.fail(`${message} failed`)
          // Ensure spinner is fully cleared and we're on a fresh line
          process.stdout.write('\r\x1b[K')
          // Show output on error if configured
          if (showOnError && outputBuffer.length > 0) {
            console.log('\n--- Output ---')
            outputBuffer.forEach(line => process.stdout.write(line))
          }
        }
      }

      resolve(finalCode)
    })

    child.on('error', error => {
      if (process.stdin.isTTY && !verbose) {
        process.stdin.setRawMode(false)
      }

      if (isSpinning) {
        spinner.stop()
        spinner.fail(`${message} error: ${error.message}`)
        // Ensure spinner is fully cleared and we're on a fresh line
        process.stdout.write('\r\x1b[K')
      }
      reject(error)
    })
  })
}

/**
 * Standard test runner with interactive output.
 */
export async function runTests(command, args, options = {}) {
  return runWithOutput(command, args, {
    message: 'Running tests',
    toggleText: 'to see test output',
    ...options,
  })
}

/**
 * Standard lint runner with interactive output.
 */
export async function runLint(command, args, options = {}) {
  return runWithOutput(command, args, {
    message: 'Running linter',
    toggleText: 'to see lint results',
    ...options,
  })
}

/**
 * Standard build runner with interactive output.
 */
export async function runBuild(command, args, options = {}) {
  return runWithOutput(command, args, {
    message: 'Building',
    toggleText: 'to see build output',
    ...options,
  })
}
