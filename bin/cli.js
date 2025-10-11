#!/usr/bin/env node
'use strict'

async function main() {
  const Module = require('node:module')
  const path = require('node:path')
  const rootPath = path.join(__dirname, '..')
  Module.enableCompileCache?.(path.join(rootPath, '.cache'))

  const { default: constants } = require(
    path.join(rootPath, 'dist/constants.js'),
  )

  // Detect if running as pkg/yao-pkg binary
  const isPkg = typeof process.pkg !== 'undefined'

  if (isPkg) {
    // Running as pkg binary - directly execute CLI without spawning
    process.exitCode = 1

    // Set environment variables
    Object.assign(process.env, constants.processEnv)

    // Directly require and execute the CLI
    require(constants.distCliPath)
  } else {
    // Running as normal Node - use spawn with flags
    const { spawn } = require(
      path.join(
        rootPath,
        'dist/external/@socketsecurity/registry/dist/lib/spawn.js',
      ),
    )

    process.exitCode = 1

    const spawnPromise = spawn(
      constants.execPath,
      [
        ...constants.nodeNoWarningsFlags,
        ...constants.nodeDebugFlags,
        ...constants.nodeHardenFlags,
        ...constants.nodeMemoryFlags,
        // Preload Sentry instrumentation in @socketsecurity/cli-with-sentry builds.
        ...(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
          ? ['--require', constants.preloadSentryPath]
          : []),
        constants.distCliPath,
        ...process.argv.slice(2),
      ],
      {
        env: {
          ...process.env,
          ...constants.processEnv,
        },
        stdio: 'inherit',
      },
    )

    // See https://nodejs.org/api/child_process.html#event-exit.
    spawnPromise.process.on('exit', (code, signalName) => {
      if (signalName) {
        process.kill(process.pid, signalName)
      } else if (typeof code === 'number') {
        // eslint-disable-next-line n/no-process-exit
        process.exit(code)
      }
    })

    await spawnPromise
  }
}

main().catch(console.error)
