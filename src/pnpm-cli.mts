#!/usr/bin/env node

/** @fileoverview pnpm CLI wrapper entry point. */

void (async () => {
  try {
    // Use require to load from built dist path to avoid creating shadow-pnpm-bin files
    const shadowPnpmBin = require('../dist/shadow-pnpm-bin.js')

    // Safely get current working directory, fall back if deleted
    let cwd
    try {
      cwd = process.cwd()
    } catch {
      // If cwd is deleted, use home or temp directory
      const os = require('node:os')
      cwd = process.env['HOME'] || process.env['USERPROFILE'] || os.tmpdir()
    }

    const { spawnPromise } = await shadowPnpmBin(process.argv.slice(2), {
      stdio: 'inherit',
      cwd,
      env: { ...process.env },
    })

    // See https://nodejs.org/api/child_process.html#event-exit
    spawnPromise.process.on(
      'exit',
      (code: number | null, signalName: NodeJS.Signals | null) => {
        if (signalName) {
          // On Windows, only certain signals are supported
          // Fallback to exit code 128 + signal number for unsupported signals
          if (process.platform === 'win32') {
            // Windows supports SIGTERM and SIGINT but not others like SIGHUP
            if (signalName === 'SIGTERM' || signalName === 'SIGINT') {
              process.kill(process.pid, signalName)
            } else {
              // Use conventional exit code for signal termination
              // Default to SIGTERM-like exit code
              // eslint-disable-next-line n/no-process-exit
              process.exit(128 + 15)
            }
          } else {
            process.kill(process.pid, signalName)
          }
        } else if (typeof code === 'number') {
          // eslint-disable-next-line n/no-process-exit
          process.exit(code)
        }
      },
    )

    await spawnPromise
  } catch (error) {
    // Only set exit code on actual failure
    process.exitCode = 1
    throw error
  }
})()
