/**
 * @fileoverview Unified command execution utilities.
 * Standardized across all socket-* repositories.
 */

import { spawn } from 'node:child_process'

/**
 * Run a command and return exit code.
 */
export async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      ...options,
    })

    child.on('close', code => {
      resolve(code || 0)
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

/**
 * Run a command quietly and capture output.
 */
export async function runCommandQuiet(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      ...options,
      stdio: 'pipe',
    })

    if (child.stdout) {
      child.stdout.on('data', chunk => {
        stdout += chunk.toString()
      })
    }

    if (child.stderr) {
      child.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })
    }

    child.on('close', code => {
      resolve({
        exitCode: code || 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

/**
 * Run multiple commands in sequence.
 */
export async function runSequence(commands) {
  for (const { command, args, options } of commands) {
    const exitCode = await runCommand(command, args, options)
    if (exitCode !== 0) {
      return exitCode
    }
  }
  return 0
}

/**
 * Run multiple commands in parallel.
 */
export async function runParallel(commands) {
  const promises = commands.map(({ command, args, options }) =>
    runCommand(command, args, options),
  )
  const results = await Promise.all(promises)
  return Math.max(...results)
}
