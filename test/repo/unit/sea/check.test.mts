import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  files: new Map<string, string | Buffer>(),
  spawn: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: async (file: string) => fixture.files.get(file),
}))
vi.mock('@socketsecurity/lib-stable/process/spawn/child', () => ({
  spawn: fixture.spawn,
}))

import {
  collectDarwinCrashDiagnostic,
  formatNativeSmokeOutput,
  main,
} from '../../../../scripts/repo/build/sea/check.mts'
import {
  SEA_ENTRYPOINT_PATHS,
  SEA_PAYLOAD_PATH,
  SEA_RECEIPT_PATH,
  seaBinaryPath,
} from '../../../../scripts/repo/build/sea/paths.mts'
import { SEA_TARGETS } from '../../../../scripts/repo/build/sea/targets.mts'

describe('SEA package verification', () => {
  beforeEach(() => {
    fixture.files.clear()
    fixture.spawn
      .mockReset()
      .mockResolvedValue({ code: 0, stdout: 'socket', stderr: '' })
    const bytes = Buffer.from('example executable')
    const digest = createHash('sha256').update(bytes).digest('hex')
    fixture.files.set(SEA_PAYLOAD_PATH, bytes)
    for (const file of Object.values(SEA_ENTRYPOINT_PATHS))
      fixture.files.set(file, bytes)
    for (const target of SEA_TARGETS)
      fixture.files.set(seaBinaryPath(target), bytes)
    fixture.files.set(
      SEA_RECEIPT_PATH,
      JSON.stringify({
        payload: digest,
        entrypoints: Object.fromEntries(
          Object.keys(SEA_ENTRYPOINT_PATHS).map(name => [name, digest]),
        ),
        binaries: Object.fromEntries(
          SEA_TARGETS.map(target => [target, digest]),
        ),
      }),
    )
  })

  it('executes the host smoke tests only after verifying the payload', async () => {
    await main()
    expect(fixture.spawn).toHaveBeenCalledTimes(3)
  })

  it('verifies and executes the requested target bytes', async () => {
    const target = SEA_TARGETS[0]!
    process.argv.push(`--target=${target}`)
    try {
      await main()
      expect(fixture.spawn).toHaveBeenCalledTimes(3)
      expect(fixture.spawn).toHaveBeenCalledWith(
        seaBinaryPath(target),
        ['--version'],
        expect.objectContaining({ throws: false, timeout: 60_000 }),
      )
    } finally {
      process.argv.pop()
    }
  })

  it.each(['--target=', '--target=unknown-platform'])(
    'rejects %s',
    async arg => {
      process.argv.push(arg)
      try {
        await expect(main()).rejects.toThrow(Error)
        expect(fixture.spawn).not.toHaveBeenCalled()
      } finally {
        process.argv.pop()
      }
    },
  )

  it('rejects combining --host and --target', async () => {
    process.argv.push(`--target=${SEA_TARGETS[0]!}`, '--host')
    try {
      await expect(main()).rejects.toThrow(Error)
      expect(fixture.spawn).not.toHaveBeenCalled()
    } finally {
      process.argv.pop()
      process.argv.pop()
    }
  })

  it('rejects a modified binary before executing it', async () => {
    fixture.files.set(
      seaBinaryPath(SEA_TARGETS[0]),
      Buffer.from('modified executable'),
    )
    await expect(main()).rejects.toThrow()
    expect(fixture.spawn).not.toHaveBeenCalled()
  })

  it('rejects a host executable that fails its smoke test', async () => {
    fixture.spawn.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'example failure',
    })
    await expect(main()).rejects.toThrow()
  })

  it('rejects a terminated executable before running more commands', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux',
    })
    fixture.spawn.mockResolvedValue({
      code: null,
      signal: 'SIGSEGV',
      stdout: '',
      stderr: '',
    })
    try {
      await expect(main()).rejects.toThrow(Error)
      expect(fixture.spawn).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: platform,
      })
    }
  })

  it('keeps a failed smoke test failed after collecting an lldb trace', async () => {
    fixture.spawn
      .mockResolvedValueOnce({
        code: null,
        signal: 'SIGSEGV',
        stdout: '',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'frame #0 crash',
        stderr: '',
      })
    const platform = process.platform
    const target = 'darwin-x64'
    process.argv.push(`--target=${target}`)
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    })
    try {
      await expect(main()).rejects.toThrow(Error)
      expect(fixture.spawn).toHaveBeenCalledTimes(2)
      expect(fixture.spawn).toHaveBeenLastCalledWith(
        'lldb',
        [
          '--no-lldbinit',
          '-b',
          '-o',
          'run',
          '-k',
          'bt all',
          '-o',
          'quit',
          '--',
          seaBinaryPath(target),
          '--version',
        ],
        expect.objectContaining({ timeout: 10_000, throws: false }),
      )
    } finally {
      process.argv.pop()
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: platform,
      })
    }
  })
})

describe('native smoke output', () => {
  it('omits empty output', () => {
    expect(formatNativeSmokeOutput('stdout', ' \n')).toBe('')
  })

  it('redacts credentials in captured output', () => {
    const credential = `npm_${'SYNTHETIC00000000000000'}`
    expect(formatNativeSmokeOutput('stderr', Buffer.from(credential))).toBe(
      '\nstderr:\n[redacted]',
    )
  })

  it('retains a bounded output tail', () => {
    const output = `${'x'.repeat(5000)}last line`
    const formatted = formatNativeSmokeOutput('stdout', output)
    expect(formatted.endsWith(output.slice(-4000))).toBe(true)
    expect(formatted.length).toBeLessThan(4100)
  })

  it('skips lldb outside Darwin', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux',
    })
    try {
      await expect(
        collectDarwinCrashDiagnostic('/tmp/socket', {
          spawnProcess: fixture.spawn,
        }),
      ).resolves.toBe('')
      expect(fixture.spawn).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: platform,
      })
    }
  })

  it('does not throw when lldb cannot start', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    })
    fixture.spawn.mockRejectedValueOnce(new Error('lldb unavailable'))
    try {
      await expect(
        collectDarwinCrashDiagnostic('/tmp/socket', {
          spawnProcess: fixture.spawn,
        }),
      ).resolves.toBe('\nLLDB diagnostic unavailable.')
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: platform,
      })
    }
  })

  it('includes the bounded lldb output', async () => {
    const platform = process.platform
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    })
    fixture.spawn.mockResolvedValueOnce({
      code: 0,
      stdout: 'frame #0 crash',
      stderr: '',
    })
    try {
      await expect(
        collectDarwinCrashDiagnostic('/tmp/socket', {
          spawnProcess: fixture.spawn,
        }),
      ).resolves.toContain('frame #0 crash')
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: platform,
      })
    }
  })
})
