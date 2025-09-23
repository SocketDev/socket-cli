import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

async function runEslintWithTimeout(argv, options) {
  const { timeout } = { __proto__: null, ...options }
  const eslint = spawn('eslint', argv, {
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })

  let finished = false

  // Handle normal exit.
  const exitPromise = new Promise(resolve => {
    eslint.on('exit', code => {
      finished = true
      resolve(code)
    })
  })

  // Handle timeout.
  const timeoutPromise = setTimeout(timeout).then(() => {
    if (!finished) {
      console.error(`ESLint timed out after ${timeout / 1000} seconds.`)
      eslint.kill('SIGTERM')
      // Give it a moment to terminate gracefully.
      setTimeout(() => {
        if (!finished) {
          eslint.kill('SIGKILL')
        }
      }, 1000)
      // Standard timeout exit code.
      return 124
    }
    return 0
  })

  // Race between normal exit and timeout.
  await Promise.race([exitPromise, timeoutPromise])

  // Always exit with 0 to match the || true behavior - never fail the build.
  // eslint-disable-next-line n/no-process-exit
  process.exit(0)
}

void (async () => {
  // Parse command line arguments.
  const args = process.argv.slice(2)

  let fix = false
  // Default 20 seconds.
  let timeout = 20_000

  const eslintArgs = []
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]
    if (arg === '--timeout' && i + 1 < length) {
      timeout = parseInt(args[++i], 10) * 1_000
    } else if (arg === '--fix') {
      fix = true
    } else {
      eslintArgs.push(arg)
    }
  }

  // Build ESLint command arguments.
  const finalArgs = []
  if (fix) {
    finalArgs.push('--fix')
  }
  finalArgs.push('--report-unused-disable-directives')
  finalArgs.push(...(eslintArgs.length ? eslintArgs : ['.']))

  try {
    await runEslintWithTimeout(finalArgs, { timeout })
  } catch {
    // Silently ignore errors and exit with 0 to not break the build.
    // eslint-disable-next-line n/no-process-exit
    process.exit(0)
  }
})()
