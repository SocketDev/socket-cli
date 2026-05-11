/**
 * Unit tests for Coana facts-file brotli compression.
 *
 * Test Coverage:
 * - compressSocketFactsForUpload: swaps .socket.facts.json paths for
 *   brotli-compressed .br temps, leaves other paths alone, cleans up.
 *
 * Related Files:
 * - utils/coana/compress-facts.mts (implementation)
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { compressSocketFactsForUpload } from '../../../../src/utils/coana/compress-facts.mts'

describe('compress-facts', () => {
  describe('compressSocketFactsForUpload', () => {
    it('writes brotli .br as a sibling of the source file', async () => {
      const wrapDir = mkdtempSync(path.join(tmpdir(), 'socket-coana-wrap-'))
      const inputPath = path.join(wrapDir, '.socket.facts.json')
      const payload = { tier1ReachabilityScanId: 'compress-test', a: 1, b: 2 }
      writeFileSync(inputPath, JSON.stringify(payload))

      try {
        const result = await compressSocketFactsForUpload([inputPath])
        const swappedPath = result.paths[0]!

        expect(result.paths).toHaveLength(1)
        expect(swappedPath).toBe(`${inputPath}.br`)
        expect(existsSync(swappedPath)).toBe(true)
        // The sibling file is real brotli that round-trips to the original
        // JSON.
        const roundTripped = brotliDecompressSync(
          readFileSync(swappedPath),
        ).toString('utf8')
        expect(JSON.parse(roundTripped)).toEqual(payload)

        // Cleanup removes the sibling .br file but leaves the source intact.
        await result.cleanup()
        expect(existsSync(swappedPath)).toBe(false)
        expect(existsSync(inputPath)).toBe(true)
      } finally {
        rmSync(wrapDir, { recursive: true, force: true })
      }
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
        expect(result.paths[1]).toBe(`${facts}.br`)
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
})
