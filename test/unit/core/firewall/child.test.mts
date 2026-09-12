import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as childProcesses from '../../../../src/core/firewall/child-processes.mts'

import { spawnFirewallChild } from '../../../../src/core/firewall/child.mts'

const fixture = fileURLToPath(new URL('./child-fixture.mts', import.meta.url))
const controllers: AbortController[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.abort()
  }
})

describe('firewall child lifecycle', () => {
  it('returns the exit code and removes process listeners', async () => {
    const listeners = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(name =>
      process.listenerCount(name),
    )
    const result = await spawnFirewallChild({
      executable: process.execPath,
      args: ['-e', 'process.exitCode = 23'],
      env: {},
      stdio: 'ignore',
    })
    expect(result).toEqual({ code: 23, signal: null })
    expect(
      ['SIGINT', 'SIGTERM', 'SIGHUP'].map(name => process.listenerCount(name)),
    ).toEqual(listeners)
  })
  it('returns a child signal after cleanup', async () => {
    const result = await spawnFirewallChild({
      executable: process.execPath,
      args: ['-e', 'process.kill(process.pid, "SIGTERM")'],
      env: {},
      stdio: 'ignore',
    })
    expect(result).toEqual({ code: null, signal: 'SIGTERM' })
  })
  it('rejects a spawn error and removes signal listeners', async () => {
    const before = process.listenerCount('SIGTERM')
    await expect(
      spawnFirewallChild({
        executable: '/nonexistent/example-command',
        args: [],
        env: {},
        stdio: 'ignore',
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(process.listenerCount('SIGTERM')).toBe(before)
  })
  it('stops an active child on cancellation', async () => {
    const controller = new AbortController()
    controllers.push(controller)
    const result = spawnFirewallChild({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      env: {},
      stdio: 'ignore',
      signal: controller.signal,
    })
    controller.abort()
    await expect(result).resolves.toMatchObject({ signal: 'SIGTERM' })
  })
  it('does not spawn after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      spawnFirewallChild({
        executable: process.execPath,
        args: [],
        env: {},
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe.skipIf(process.platform === 'win32')(
  'controlling terminal inheritance',
  () => {
    it.each(['none', 'stdout', 'stdin', 'both'])(
      'preserves foreground membership with %s redirected',
      redirected => {
        const harness = `import errno,os,sys
pid,fd=os.forkpty()
if pid == 0:
 redirected=sys.argv[1]
 if redirected in ('stdin','both'): os.dup2(os.open('/dev/null',os.O_RDONLY),0)
 if redirected in ('stdout','both'): os.dup2(os.open('/dev/null',os.O_WRONLY),1)
 os.execv(sys.argv[2],sys.argv[2:])
output=b''
while True:
 try:
  chunk=os.read(fd,65536)
  if not chunk: break
  output+=chunk
 except OSError as error:
  if error.errno != errno.EIO: raise
  break
_,status=os.waitpid(pid,0)
sys.stdout.buffer.write(output)
sys.exit(os.waitstatus_to_exitcode(status))`
        const output = spawnSync(
          '/usr/bin/python3',
          ['-c', harness, redirected, process.execPath, fixture, 'foreground'],
          { encoding: 'utf8', timeout: 10_000 },
        )
        expect(output.status).toBe(0)
        const result = JSON.parse(output.stdout.trim())
        expect(result.process).toBe(result.terminal)
      },
    )
  },
)

it.skipIf(process.platform === 'win32')(
  'kills detached descendants on normal exit and cancellation',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'firewall-child-'))
    try {
      for (const mode of ['exit-with-descendant', 'wait-with-descendant']) {
        const pidPath = path.join(directory, `${mode}.pid`)
        const controller = new AbortController()
        controllers.push(controller)
        const result = spawnFirewallChild({
          executable: process.execPath,
          args: [fixture, mode, pidPath],
          env: {},
          stdio: 'ignore',
          signal: controller.signal,
        })
        for (
          let attempt = 0;
          attempt < 100 && !existsSync(pidPath);
          attempt += 1
        ) {
          await delay(20)
        }
        expect(existsSync(pidPath)).toBe(true)
        const pid = Number(readFileSync(pidPath, 'utf8'))
        if (mode === 'wait-with-descendant') {
          controller.abort()
        }
        if (mode === 'exit-with-descendant') {
          expect((await result).code).toBe(23)
        } else {
          expect((await result).signal).toBe('SIGTERM')
        }
        await expect
          .poll(() => {
            try {
              process.kill(pid, 0)
              return true
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                throw error
              }
              return false
            }
          })
          .toBe(false)
      }
    } finally {
      await safeDelete(directory)
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'cleans attached descendants without signaling the caller group',
  async () => {
    const terminal = vi
      .spyOn(childProcesses, 'hasFirewallControllingTerminal')
      .mockReturnValue(true)
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'firewall-attached-'),
    )
    const controller = new AbortController()
    controllers.push(controller)
    try {
      const pidPath = path.join(directory, 'descendant.pid')
      const result = spawnFirewallChild({
        executable: process.execPath,
        args: [fixture, 'wait-with-descendant', pidPath],
        env: {},
        stdio: 'ignore',
        signal: controller.signal,
      })
      for (
        let attempt = 0;
        attempt < 100 && !existsSync(pidPath);
        attempt += 1
      ) {
        await delay(20)
      }
      expect(existsSync(pidPath)).toBe(true)
      const pid = Number(readFileSync(pidPath, 'utf8'))
      await delay(550)
      controller.abort()
      expect((await result).signal).toBe('SIGTERM')
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0)
            return true
          } catch {
            return false
          }
        })
        .toBe(false)
    } finally {
      controller.abort()
      terminal.mockRestore()
      await safeDelete(directory)
    }
  },
)

it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGHUP'] as const)(
  'forwards %s through its installed handler',
  async signal => {
    const existing = new Set(process.listeners(signal))
    const result = spawnFirewallChild({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      env: {},
      stdio: 'ignore',
    })
    const listener = process
      .listeners(signal)
      .find(candidate => !existing.has(candidate))
    expect(listener).toBeTypeOf('function')
    listener?.()
    expect((await result).signal).toBe(signal)
  },
)
