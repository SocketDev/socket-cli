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
    async mode => {
      // A service supervisor signals the launcher PID directly (no terminal group).
      const options = []
      if (mode === 'without execve') {
        const preload = path.join(root, 'old-node.cjs')
        await writeFile(preload, 'process.execve = undefined')
        options.push('--require', preload)
      }
      const child = spawn(
        process.execPath,
        [...options, launcher, '-c', 'printf "%s\\n" "$$"; exec sleep 20'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const exited = once(child, 'exit')
      const [output] = await once(child.stdout, 'data')
      const nativePid = Number(String(output).trim())
      try {
        child.kill('SIGTERM')
        await expect(exited).resolves.toEqual([null, 'SIGTERM'])
        expect(() => process.kill(nativePid, 0)).toThrow()
      } finally {
        try {
          process.kill(nativePid, 'SIGKILL')
        } catch {}
      }
    },
  )
})
