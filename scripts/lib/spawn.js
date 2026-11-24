'use strict'

const crossSpawn = require('cross-spawn')

const { sync: spawnSyncRaw } = crossSpawn
const { stripAnsi } = require('./strings')

function fetchPackageManifest(spec) {
  const result = spawnSyncRaw('npm', ['view', spec, 'version', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `npm view ${spec} failed: ${stripAnsi(result.stderr || '').trim()}`,
    )
  }
  const response = JSON.parse(String(result.stdout || 'null'))
  const version =
    Array.isArray(response) && response.length === 1 ? response[0] : response
  if (typeof version !== 'string' || !version) {
    throw new Error(`npm view ${spec} did not return a version`)
  }
  return { name: spec.slice(0, spec.lastIndexOf('@')) || spec, version }
}

function spawnSync(command, args, options = {}) {
  const result = spawnSyncRaw(command, args, {
    ...options,
    encoding: options.encoding ?? 'utf8',
  })
  if (typeof result.stdout === 'string') {
    result.stdout = result.stdout.trim()
  }
  if (typeof result.stderr === 'string') {
    result.stderr = result.stderr.trim()
  }
  return result
}

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(command, args, options)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve({ code, signal })
      } else {
        reject(
          Object.assign(new Error(`${command} exited with ${code ?? signal}`), {
            code,
            signal,
          }),
        )
      }
    })
  })
}

module.exports = { fetchPackageManifest, spawnAsync, spawnSync }
