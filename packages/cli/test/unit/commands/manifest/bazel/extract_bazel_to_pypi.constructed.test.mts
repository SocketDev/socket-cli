/**
 * Live-bazel oracle test for the PyPI extraction pipeline against the
 * constructed `bazel-bench` fixture workspace. Skipped when the external
 * fixture corpus is absent — it lives in a sibling `bazel-bench` checkout,
 * not in this repository — or when the Bazel server cannot run.
 */

import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { extractBazelToPypi } from '../../../../../src/commands/manifest/bazel/extract_bazel_to_pypi.mts'
import { tolerantTimeout } from '../../../../../../../test/fleet/_shared/lib/timing.mts'

const testDir = path.dirname(fileURLToPath(import.meta.url))

// The constructed workspace lives in a sibling `bazel-bench` checkout next to
// this repository: <projects>/bazel-bench/constructed/python-pypi.
const FIXTURE_DIR = path.resolve(
  testDir,
  '..',
  '..',
  '..',
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
  // Detect sandbox by probing a write to /var/tmp/_bazel_$USER, which the
  // agent sandbox blocks.
  try {
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
  // Normalize CRLF to LF.
  return text.replace(/\r\n/g, '\n').replace(/\n?$/, '\n')
}

describe.skipIf(isSandboxed() || !existsSync(FIXTURE_DIR))(
  'extract_bazel_to_pypi — constructed fixture',
  () => {
    let tmp: string

    beforeEach(() => {
      tmp = mkdtempSync(path.join(os.tmpdir(), 'pypi-constructed-'))
    })

    afterEach(async () => {
      await safeDelete(tmp)
    })

    it(
      'produces exact requirements.txt matching the committed oracle',
      async () => {
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
        const actualLines = actualContent
          .split('\n')
          .filter(l => l.trim() !== '')

        const oraclePath = path.resolve(
          testDir,
          '..',
          '..',
          '..',
          '..',
          'fixtures',
          'manifest-bazel',
          'python-pypi',
          'requirements.golden.txt',
        )
        const expectedContent = normalizeFinalNewline(
          readFileSync(oraclePath, 'utf8'),
        )
        expect(actualContent).toBe(expectedContent)

        // Verify sorted order (sort by package name only, matching
        // sortPackageLines).
        const sorted = [...actualLines].toSorted((a, b) => {
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
      },
      tolerantTimeout(60_000),
    )
  },
)
