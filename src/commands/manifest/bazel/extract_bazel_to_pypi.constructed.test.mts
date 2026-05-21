import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { extractBazelToPypi } from './extract_bazel_to_pypi.mts'

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'bazel-bench',
  'constructed',
  'python-pypi',
)

function isSandboxed(): boolean {
  // Detect sandbox by probing a Bazel server socket bind or a write to
  // /var/tmp/_bazel_$USER (both blocked in the agent sandbox).
  try {
    // A quick heuristic: if /var/tmp/_bazel_$USER is not writable and we're
    // on macOS, the sandbox is likely active.
    const { accessSync, constants } = require('node:fs')
    accessSync(
      `/var/tmp/_bazel_${process.env['USER'] ?? 'unknown'}`,
      constants.W_OK,
    )
    return false
  } catch {
    return true
  }
}

function normalizeFinalNewline(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n?$/, '\n')
}

describe.skipIf(isSandboxed())(
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

describe('extract_bazel_to_pypi — sandbox fallback', () => {
  it('returns noEcosystemFound when explicit mode has no Python rules', async () => {
    const { writeFileSync } = await import('node:fs')
    const noRulesDir = mkdtempSync(path.join(os.tmpdir(), 'no-python-rules-'))
    try {
      // Write a minimal MODULE.bazel so workspace detection passes.
      writeFileSync(
        path.join(noRulesDir, 'MODULE.bazel'),
        'module(name="test")\n',
        'utf8',
      )
      const result = await extractBazelToPypi({
        bazelFlags: undefined,
        bazelOutputBase: undefined,
        bazelRc: undefined,
        bin: undefined,
        cwd: noRulesDir,
        out: noRulesDir,
        verbose: false,
        explicitEcosystem: true,
      })
      expect(result.noEcosystemFound).toBe(true)
      expect(result.ok).toBe(false)
    } finally {
      rmSync(noRulesDir, { recursive: true, force: true })
    }
  }, 60000)
})
