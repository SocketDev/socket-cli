/**
 * Unit tests for Coana facts-file utilities.
 *
 * Test Coverage:
 * - compressSocketFactsForUpload: swaps .socket.facts.json paths for
 *   brotli-compressed .br temps, leaves other paths alone, cleans up.
 * - extractTier1ReachabilityScanId: plain JSON + edge cases.
 * - extractReachabilityErrors: plain JSON + missing + malformed.
 *
 * Related Files:
 * - utils/coana.mts (implementation)
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  compressSocketFactsForUpload,
  extractReachabilityErrors,
  extractTier1ReachabilityScanId,
} from './coana.mts'

describe('coana facts-file utils', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'socket-coana-facts-'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writePlain(name: string, body: unknown): string {
    const filePath = path.join(tmpDir, name)
    writeFileSync(filePath, JSON.stringify(body))
    return filePath
  }

  describe('compressSocketFactsForUpload', () => {
    it('swaps a .socket.facts.json path for a brotli .br temp file', async () => {
      const wrapDir = mkdtempSync(path.join(tmpdir(), 'socket-coana-wrap-'))
      const inputPath = path.join(wrapDir, '.socket.facts.json')
      const payload = { tier1ReachabilityScanId: 'compress-test', a: 1, b: 2 }
      writeFileSync(inputPath, JSON.stringify(payload))

      const result = await compressSocketFactsForUpload([inputPath])
      const swappedPath = result.paths[0]!
      try {
        expect(result.paths).toHaveLength(1)
        expect(swappedPath).not.toBe(inputPath)
        expect(path.basename(swappedPath)).toBe('.socket.facts.json.br')
        expect(existsSync(swappedPath)).toBe(true)
        // Temp file lives in a subdir of the source's parent directory, NOT
        // under tmpdir(). This keeps `path.relative(cwd, swappedPath)`
        // traversal-free so depscan's multipart ingest accepts the entry.
        expect(path.dirname(path.dirname(swappedPath))).toBe(wrapDir)
        // The temp file is real brotli that round-trips to the original JSON.
        const roundTripped = brotliDecompressSync(
          readFileSync(swappedPath),
        ).toString('utf8')
        expect(JSON.parse(roundTripped)).toEqual(payload)
      } finally {
        await result.cleanup()
        rmSync(wrapDir, { recursive: true, force: true })
      }
      // Cleanup removes the temp .br file.
      expect(existsSync(swappedPath)).toBe(false)
    })

    it('leaves non-facts paths unchanged', async () => {
      const wrapDir = mkdtempSync(path.join(tmpdir(), 'socket-coana-wrap-'))
      const lock = path.join(wrapDir, 'package-lock.json')
      const pkg = path.join(wrapDir, 'package.json')
      writeFileSync(lock, '{}')
      writeFileSync(pkg, '{}')

      const result = await compressSocketFactsForUpload([lock, pkg])
      try {
        expect(result.paths).toEqual([lock, pkg])
      } finally {
        await result.cleanup()
        rmSync(wrapDir, { recursive: true, force: true })
      }
    })

    it('leaves a missing .socket.facts.json path unchanged', async () => {
      const wrapDir = mkdtempSync(path.join(tmpdir(), 'socket-coana-wrap-'))
      const missingFacts = path.join(wrapDir, '.socket.facts.json')
      // Note: no writeFileSync — file does not exist.

      const result = await compressSocketFactsForUpload([missingFacts])
      try {
        expect(result.paths).toEqual([missingFacts])
      } finally {
        await result.cleanup()
        rmSync(wrapDir, { recursive: true, force: true })
      }
    })

    it('mixes facts and non-facts entries correctly', async () => {
      const wrapDir = mkdtempSync(path.join(tmpdir(), 'socket-coana-wrap-'))
      const facts = path.join(wrapDir, '.socket.facts.json')
      const lock = path.join(wrapDir, 'package-lock.json')
      writeFileSync(facts, JSON.stringify({ tier1ReachabilityScanId: 'mix' }))
      writeFileSync(lock, '{"name":"x"}')

      const result = await compressSocketFactsForUpload([lock, facts])
      try {
        expect(result.paths[0]).toBe(lock)
        expect(result.paths[1]).not.toBe(facts)
        expect(path.basename(result.paths[1]!)).toBe('.socket.facts.json.br')
        const roundTripped = JSON.parse(
          brotliDecompressSync(readFileSync(result.paths[1]!)).toString('utf8'),
        )
        expect(roundTripped.tier1ReachabilityScanId).toBe('mix')
      } finally {
        await result.cleanup()
        rmSync(wrapDir, { recursive: true, force: true })
      }
    })

    it('cleanup is idempotent (safe to call twice)', async () => {
      const wrapDir = mkdtempSync(path.join(tmpdir(), 'socket-coana-wrap-'))
      const facts = path.join(wrapDir, '.socket.facts.json')
      writeFileSync(facts, JSON.stringify({ tier1ReachabilityScanId: 'idem' }))

      const result = await compressSocketFactsForUpload([facts])
      await result.cleanup()
      await expect(result.cleanup()).resolves.not.toThrow()
      rmSync(wrapDir, { recursive: true, force: true })
    })
  })

  describe('extractTier1ReachabilityScanId', () => {
    it('reads scan ID from plain JSON file', () => {
      const file = writePlain('plain-id.json', {
        tier1ReachabilityScanId: 'scan-123',
      })

      expect(extractTier1ReachabilityScanId(file)).toBe('scan-123')
    })

    it('returns undefined for missing file', () => {
      expect(
        extractTier1ReachabilityScanId(path.join(tmpDir, 'missing.json')),
      ).toBeUndefined()
    })

    it('returns undefined when tier1ReachabilityScanId is missing', () => {
      const file = writePlain('missing-field.json', { otherField: 'value' })

      expect(extractTier1ReachabilityScanId(file)).toBeUndefined()
    })

    it('returns undefined for null scan ID', () => {
      const file = writePlain('null-id.json', { tier1ReachabilityScanId: null })

      expect(extractTier1ReachabilityScanId(file)).toBeUndefined()
    })

    it('returns undefined for empty / whitespace scan ID', () => {
      const blank = writePlain('blank-id.json', {
        tier1ReachabilityScanId: '   ',
      })
      const empty = writePlain('empty-id.json', {
        tier1ReachabilityScanId: '',
      })

      expect(extractTier1ReachabilityScanId(blank)).toBeUndefined()
      expect(extractTier1ReachabilityScanId(empty)).toBeUndefined()
    })

    it('trims whitespace from scan ID', () => {
      const file = writePlain('padded-id.json', {
        tier1ReachabilityScanId: '  scan-456  ',
      })

      expect(extractTier1ReachabilityScanId(file)).toBe('scan-456')
    })

    it('coerces numeric scan ID to string', () => {
      const file = writePlain('numeric-id.json', {
        tier1ReachabilityScanId: 12345,
      })

      expect(extractTier1ReachabilityScanId(file)).toBe('12345')
    })
  })

  describe('extractReachabilityErrors', () => {
    const errorComponentsBody = {
      components: [
        {
          name: 'lodash',
          version: '4.17.21',
          reachability: [
            {
              ghsa_id: 'GHSA-aaaa-bbbb-cccc',
              reachability: [
                { type: 'error', subprojectPath: 'packages/web' },
                { type: 'reachable', subprojectPath: 'packages/api' },
              ],
            },
          ],
        },
        {
          name: 'axios',
          version: '1.4.0',
          reachability: [
            {
              ghsa_id: 'GHSA-xxxx-yyyy-zzzz',
              reachability: [{ type: 'error', subprojectPath: 'packages/api' }],
            },
          ],
        },
      ],
    }

    const expectedErrors = [
      {
        componentName: 'lodash',
        componentVersion: '4.17.21',
        ghsaId: 'GHSA-aaaa-bbbb-cccc',
        subprojectPath: 'packages/web',
      },
      {
        componentName: 'axios',
        componentVersion: '1.4.0',
        ghsaId: 'GHSA-xxxx-yyyy-zzzz',
        subprojectPath: 'packages/api',
      },
    ]

    it('extracts errors from plain JSON', () => {
      const file = writePlain('errors-plain.json', errorComponentsBody)

      expect(extractReachabilityErrors(file)).toEqual(expectedErrors)
    })

    it('returns empty array for missing file', () => {
      expect(
        extractReachabilityErrors(path.join(tmpDir, 'missing-errors.json')),
      ).toEqual([])
    })

    it('returns empty array when components is missing', () => {
      const file = writePlain('errors-no-components.json', { other: true })

      expect(extractReachabilityErrors(file)).toEqual([])
    })

    it('skips components with no reachability arrays', () => {
      const file = writePlain('errors-skip.json', {
        components: [
          { name: 'just-name', version: '1.0.0' },
          {
            name: 'no-inner',
            version: '1.0.0',
            reachability: [{ ghsa_id: 'GHSA-1' }],
          },
        ],
      })

      expect(extractReachabilityErrors(file)).toEqual([])
    })
  })
})
