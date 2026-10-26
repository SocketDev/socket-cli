import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runCdxgen } from './run-cdxgen.mts'

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  warn: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: { log: mocks.log, warn: mocks.warn },
}))
vi.mock('../../constants.mts', () => ({
  default: {
    PACKAGE_LOCK_JSON: 'package-lock.json',
    PNPM_LOCK_YAML: 'pnpm-lock.yaml',
    YARN_LOCK: 'yarn.lock',
  },
  FLAG_HELP: '--help',
  NPM: 'npm',
  PNPM: 'pnpm',
  YARN: 'yarn',
}))
vi.mock('../../utils/dlx.mts', () => ({
  spawnCdxgenDlx: mocks.spawn,
  spawnSynpDlx: vi.fn(),
}))
vi.mock('../../utils/fs.mts', () => ({ findUp: vi.fn() }))
vi.mock('../../utils/yarn-version.mts', () => ({
  isYarnBerry: vi.fn(),
}))

describe('cdxgen output diagnostics', () => {
  let directory: string
  let child: EventEmitter

  beforeEach(async () => {
    vi.clearAllMocks()
    directory = await mkdtemp(path.join(os.tmpdir(), 'cdxgen-output-'))
    child = new EventEmitter()
    mocks.spawn.mockResolvedValue({
      spawnPromise: Object.assign(Promise.resolve({ code: 0 }), {
        process: child,
      }),
    })
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('warns before the caller exits for an empty absolute output path', async () => {
    const output = path.join(directory, 'empty-sbom.json')
    await writeFile(output, JSON.stringify({ components: [] }))
    await runCdxgen({ output })
    let warnedBeforeCallerExit = false
    child.on('exit', () => {
      warnedBeforeCallerExit = mocks.warn.mock.calls.length === 1
    })
    child.emit('exit', 0, null)
    expect(warnedBeforeCallerExit).toBe(true)
    expect(mocks.warn).toHaveBeenCalledOnce()
    expect(mocks.warn.mock.calls[0]?.[0]).toContain(output)
  })

  it('does not warn for populated components', async () => {
    const output = path.join(directory, 'populated-sbom.json')
    await writeFile(
      output,
      JSON.stringify({
        components: [{ name: 'example-library', version: '1.0.0' }],
      }),
    )
    await runCdxgen({ output })
    child.emit('exit', 0, null)
    expect(mocks.warn).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledOnce()
  })

  it.each([
    [1, null],
    [null, 'SIGTERM'],
  ])(
    'does not report stale output after unsuccessful termination',
    async (code, signal) => {
      const output = path.join(directory, 'stale-sbom.json')
      await writeFile(output, JSON.stringify({ components: [] }))
      await runCdxgen({ output })
      child.emit('exit', code, signal)
      expect(mocks.warn).not.toHaveBeenCalled()
      expect(mocks.log).not.toHaveBeenCalled()
    },
  )

  it('preserves existing behavior for malformed output', async () => {
    const output = path.join(directory, 'malformed-sbom.json')
    await writeFile(output, '{')
    await runCdxgen({ output })
    expect(() => child.emit('exit', 0, null)).not.toThrow()
  })
})
