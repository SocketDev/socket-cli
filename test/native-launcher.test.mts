import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const name = `@socketsecurity/socket-cli-${process.platform}-${process.arch}`
const version = '2.1.0-rc.0'
describe('installed native launcher', () => {
  let root: string
  let launcher: string
  let platform: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'socket launcher '))
    const modules = path.join(root, 'node_modules')
    const app = path.join(modules, 'socket')
    platform = path.join(modules, name)
    await mkdir(app, { recursive: true })
    await mkdir(platform, { recursive: true })
    launcher = path.join(app, 'socket.cjs')
    await copyFile(
      new URL('../scripts/release/native-launcher.cjs', import.meta.url),
      launcher,
    )
    await writeFile(
      path.join(app, 'package.json'),
      JSON.stringify({
        name: 'socket',
        version,
        optionalDependencies: { [name]: version },
      }),
    )
    await writeFile(
      path.join(platform, 'package.json'),
      JSON.stringify({ name, version }),
    )
    if (process.platform === 'win32') {
      await copyFile(
        path.join(process.env['SystemRoot']!, 'System32', 'cmd.exe'),
        path.join(platform, 'socket.exe'),
      )
    } else {
      await writeFile(
        path.join(platform, 'socket'),
        '#!/bin/sh\nexec /bin/sh "$@"\n',
        { mode: 0o755 },
      )
    }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('uses the matching hoisted package and preserves its exit code', async () => {
    const args =
      process.platform === 'win32' ? ['/d', '/c', 'exit 37'] : ['-c', 'exit 37']
    await expect(
      run(process.execPath, [launcher, ...args]),
    ).rejects.toMatchObject({ code: 37 })
  })

  it('rejects a different hoisted version before starting it', async () => {
    await writeFile(
      path.join(platform, 'package.json'),
      JSON.stringify({ name, version: '2.1.0-rc.1' }),
    )
    await expect(
      run(process.execPath, [launcher, 'unused']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(`Expected ${name}@${version}`),
    })
  })

  it.skipIf(process.platform === 'win32').each(['host', 'without execve'])(
    'passes a targeted termination signal to the running executable (%s)',
    { timeout: 15_000 },
    async mode => {
      // A service supervisor signals the launcher PID directly (no terminal group).
      const options =
        mode === 'without execve'
          ? ['--import', 'data:text/javascript,process.execve=undefined']
          : []
      const fixture = `
        process.once('SIGTERM', () => {
          process.stdout.write(' SIGTERM', () => process.kill(process.pid, 'SIGTERM'))
        })
        setTimeout(() => process.exit(1), 10_000)
        process.stdout.write('ready')
      `
      const child = spawn(
        process.execPath,
        [
          ...options,
          launcher,
          '-c',
          'exec "$@"',
          'fixture',
          process.execPath,
          '-e',
          fixture,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let output = ''
      child.stdout.setEncoding('utf8').on('data', chunk => {
        output += chunk
      })
      const closed = once(child, 'close')
      try {
        await Promise.race([once(child.stdout, 'data'), closed])
        expect(child.kill('SIGTERM')).toBe(true)
        await expect(closed).resolves.toEqual([null, 'SIGTERM'])
        expect(output).toBe('ready SIGTERM')
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
      }
    },
  )
})
