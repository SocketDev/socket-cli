import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { extractBazelToPypi } from './extract_bazel_to_pypi.mts'

const FIXTURE_DIR = process.env['SOCKET_BAZEL_PYPI_FIXTURE'] ?? ''

function normalizeFinalNewline(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n?$/, '\n')
}

describe.skipIf(!FIXTURE_DIR)(
  'extract_bazel_to_pypi — constructed fixture',
  () => {
    let tmp: string

    beforeEach(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'pypi-constructed-'))
    })

    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true })
    })

    it('produces exact requirements.txt matching the committed oracle', async () => {
      expect(existsSync(FIXTURE_DIR)).toBe(true)

      const result = await extractBazelToPypi({
        bazelFlags: undefined,
        bazelOutputBase: undefined,
        bazelRc: undefined,
        bin: undefined,
        cwd: FIXTURE_DIR,
        out: tmp,
        verbose: true,
      })

      expect(result.ok).toBe(true)
      expect(result.manifestPath).toBeDefined()
      expect(existsSync(result.manifestPath!)).toBe(true)

      const actualContent = normalizeFinalNewline(
        readFileSync(result.manifestPath!, 'utf8'),
      )
      const actualLines = actualContent.split('\n').filter(l => l.trim() !== '')

      const oraclePath = path.resolve(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '..',
        'test',
        'fixtures',
        'manifest-bazel',
        'python-pypi',
        'requirements.expected.txt',
      )
      const expectedContent = normalizeFinalNewline(
        readFileSync(oraclePath, 'utf8'),
      )
      expect(actualContent).toBe(expectedContent)

      // Verify sorted order (sort by package name only, matching sortPackageLines).
      const sorted = [...actualLines].sort((a, b) => {
        const aName = a.split('==')[0]!.toLowerCase()
        const bName = b.split('==')[0]!.toLowerCase()
        if (aName < bName) {
          return -1
        }
        if (aName > bName) {
          return 1
        }
        return a.localeCompare(b)
      })
      expect(actualLines).toEqual(sorted)
    }, 60000)

    it('explicit --ecosystem pypi mode also produces matching output', async () => {
      expect(existsSync(FIXTURE_DIR)).toBe(true)

      const result = await extractBazelToPypi({
        bazelFlags: undefined,
        bazelOutputBase: undefined,
        bazelRc: undefined,
        bin: undefined,
        cwd: FIXTURE_DIR,
        out: tmp,
        verbose: true,
        explicitEcosystem: true,
      })

      expect(result.ok).toBe(true)
      expect(result.manifestPath).toBeDefined()
    }, 60000)
  },
)
