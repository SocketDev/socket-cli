#!/usr/bin/env node
'use strict'

void (async () => {
  const Module = require('node:module')
  const os = require('node:os')
  const path = require('node:path')
  const rootPath = path.join(__dirname, '..')
  Module.enableCompileCache?.(path.join(rootPath, '.cache'))

  const { default: constants } = require(
    path.join(rootPath, 'dist/constants.js'),
  )
  const { spawn } = require(
    path.join(rootPath, 'external/@socketsecurity/registry/lib/spawn.js'),
  )

  process.exitCode = 1

  const spawnPromise = spawn(
    constants.execPath,
    [
      ...constants.nodeNoWarningsFlags,
      ...constants.nodeDebugFlags,
      ...constants.nodeHardenFlags,
      ...constants.nodeMemoryFlags,
      ...(constants.ENV.INLINED_SOCKET_CLI_SENTRY_BUILD
        ? ['--require', constants.instrumentWithSentryPath]
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

  // The child shares our process group and handles the signal itself; wait briefly for it
  // to exit (so its final output isn't printed after the prompt returns) and mirror its
  // exit below. SIGKILL and leave if it outlasts the grace, or on a second signal.
  const SHUTDOWN_GRACE_MS = 3_000
  const hardAbort = signalName => {
    const child = spawnPromise.process
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
    // eslint-disable-next-line n/no-process-exit
    process.exit(signalName === 'SIGTERM' ? 143 : 130)
  }
  let sawSignal = false
  const onSignal = signalName => {
    if (sawSignal) {
      hardAbort(signalName)
      return
    }
    sawSignal = true
    setTimeout(() => hardAbort(signalName), SHUTDOWN_GRACE_MS).unref?.()
  }
  const onSigint = () => onSignal('SIGINT')
  const onSigterm = () => onSignal('SIGTERM')
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on('exit', (code, signalName) => {
    if (signalName) {
      // Mirror a signal death as the conventional 128 + signum exit code. Exit explicitly
      // rather than re-raising the signal: with our handlers installed the re-raise would
      // race `await spawnPromise` resolving and could leave the default exitCode of 1.
      const signum = os.constants.signals[signalName] ?? 0
      // eslint-disable-next-line n/no-process-exit
      process.exit(128 + signum)
    } else if (typeof code === 'number') {
      // eslint-disable-next-line n/no-process-exit
      process.exit(code)
    }
  })

  await spawnPromise
})()
