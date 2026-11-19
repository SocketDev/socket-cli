'use strict'
const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const name = `@socketsecurity/socket-cli-${process.platform}-${process.arch}`
const expected = require('./package.json').optionalDependencies[name]
if (!expected) {
  throw new Error(
    `Unsupported Socket CLI platform: ${process.platform}-${process.arch}`,
  )
}
let manifest
try {
  manifest = require.resolve(`${name}/package.json`)
} catch {
  throw new Error(
    `Could not find ${name}. Install socket with optional dependencies enabled on a supported platform.`,
  )
}
// A consumer may already have a different version hoisted into node_modules.
const installed = JSON.parse(readFileSync(manifest, 'utf8'))
if (installed.name !== name || installed.version !== expected) {
  throw new Error(
    `Expected ${name}@${expected}, found ${installed.name}@${installed.version}.`,
  )
}
const executable = process.platform === 'win32' ? 'socket.exe' : 'socket'
const binary = path.join(path.dirname(manifest), executable)
const args = process.argv.slice(2)
if (process.platform !== 'win32' && process.execve) {
  // Preserve the PID a service supervisor signals when cancelling a scan.
  process.execve(binary, [binary, ...args], process.env)
}
const child = spawn(binary, args, { stdio: 'inherit' })
// Older Unix Node versions need a forwarding wrapper. Windows console
// control events already reach the attached native child.
const signals =
  process.platform === 'win32' ? [] : ['SIGTERM', 'SIGINT', 'SIGHUP']
const forward = signal => child.kill(signal)
for (const signal of signals) {
  process.on(signal, forward)
}
child.on('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  for (const watched of signals) {
    process.off(watched, forward)
  }
  if (signal) {
    process.kill(process.pid, signal)
  } else if (process.exitCode === undefined) {
    process.exitCode = code ?? 1
  }
})
