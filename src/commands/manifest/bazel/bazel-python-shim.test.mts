import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  findBazelExecutable,
  getBazelEnvironment,
  getBazelEnvironmentValue,
} from './bazel-process.mts'
import { provisionPythonShim } from './bazel-python-shim.mts'
import { isStandaloneSea } from '../../../sea/runtime.mts'

vi.mock('../../../sea/runtime.mts', () => ({ isStandaloneSea: vi.fn() }))

const python = await findBazelExecutable(
  process.platform === 'win32' ? 'python' : 'python3',
  getBazelEnvironment(),
  process.cwd(),
)

describe('provisionPythonShim', () => {
  let cwd: string
  const shims: string[] = []

  beforeEach(() => {
    vi.mocked(isStandaloneSea).mockReturnValue(false)
    cwd = mkdtempSync(path.join(os.tmpdir(), 'bazel python '))
  })

  afterEach(() => {
    for (const dir of [cwd, ...shims.splice(0)]) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
    }
  })

  it('reports missing Python in the supplied environment', async () => {
    await expect(
      provisionPythonShim(getBazelEnvironment({ PATH: cwd }), cwd),
    ).rejects.toThrow(/python.exe|Neither python nor python3/)
  })

  it('rejects an executable that does not run Python 3', async () => {
    copyFileSync(
      process.execPath,
      path.join(cwd, process.platform === 'win32' ? 'python.exe' : 'python'),
    )
    await expect(
      provisionPythonShim(getBazelEnvironment({ PATH: cwd }), cwd),
    ).rejects.toThrow(/did not run as Python 3/)
  })

  it.skipIf(!python)(
    'checks a working interpreter in the supplied environment',
    async () => {
      if (!python) {
        throw new Error('Python fixture is unavailable')
      }
      if (process.platform === 'win32') {
        const env = getBazelEnvironment({ Path: path.dirname(python) })
        expect(await provisionPythonShim(env, cwd)).toEqual({
          env,
          shimDir: undefined,
        })
      } else {
        symlinkSync(python, path.join(cwd, 'python'))
        const env = getBazelEnvironment({ PATH: cwd })
        expect(await provisionPythonShim(env, cwd)).toEqual({
          env,
          shimDir: undefined,
        })
      }
      await expect(
        provisionPythonShim(
          getBazelEnvironment({ PATH: path.join(cwd, 'missing') }),
          cwd,
        ),
      ).rejects.toThrow(/python/)
    },
  )

  it.skipIf(!python || process.platform === 'win32')(
    'creates separate Unix shims for concurrent calls',
    async () => {
      if (!python) {
        throw new Error('Python fixture is unavailable')
      }
      symlinkSync(python, path.join(cwd, 'python3'))
      const results = await Promise.all([
        provisionPythonShim(getBazelEnvironment({ PATH: cwd }), cwd),
        provisionPythonShim(getBazelEnvironment({ PATH: cwd }), cwd),
      ])
      for (const result of results) {
        if (!result.shimDir) {
          throw new Error('Expected a Python shim')
        }
        shims.push(result.shimDir)
        expect(existsSync(path.join(result.shimDir, 'python'))).toBe(true)
        expect(readlinkSync(path.join(result.shimDir, 'python'))).toBe(python)
        expect(result.env['PATH']).toContain(cwd)
      }
      expect(results[0]?.shimDir).not.toBe(results[1]?.shimDir)
    },
  )

  it.skipIf(!python || process.platform === 'win32')(
    'uses python3 when python is not Python 3',
    async () => {
      if (!python) {
        throw new Error('Python fixture is unavailable')
      }
      copyFileSync(process.execPath, path.join(cwd, 'python'))
      symlinkSync(python, path.join(cwd, 'python3'))
      const result = await provisionPythonShim(
        getBazelEnvironment({ PATH: cwd }),
        cwd,
      )
      if (!result.shimDir) {
        throw new Error('Expected a Python shim')
      }
      shims.push(result.shimDir)
      expect(readlinkSync(path.join(result.shimDir, 'python'))).toBe(python)
    },
  )

  it.skipIf(!python || process.platform !== 'win32')(
    'keeps an overridden Windows interpreter beside its runtime files',
    async () => {
      if (!python) {
        throw new Error('Python fixture is unavailable')
      }
      vi.mocked(isStandaloneSea).mockReturnValue(true)
      const env = getBazelEnvironment({
        SOCKET_CLI_PYTHON_PATH: path.relative(cwd, python),
        Path: 'existing-path',
      })
      const result = await provisionPythonShim(env, cwd)
      expect(result.shimDir).toBeUndefined()
      expect(getBazelEnvironmentValue(result.env, 'PATH')).toBe(
        `${path.dirname(python)}${path.delimiter}existing-path`,
      )
    },
  )
})
