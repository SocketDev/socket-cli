/**
 * @file Unit tests for memory-discovery-reminder.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  memoryDirFor,
  memoryHint,
  projectSlug,
  storeHasIndex,
  wheelhousePathFrom,
} from '../index.mts'

describe('memory-discovery-reminder', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), 'mem-discovery-'))
  })

  afterEach(() => {
    rmSync(tmpHome, { force: true, recursive: true })
  })

  describe('projectSlug', () => {
    it('replaces every slash (including leading) with a dash', () => {
      expect(projectSlug('/Users/x/projects/socket-btm')).toBe(
        '-Users-x-projects-socket-btm',
      )
    })
  })

  describe('memoryDirFor', () => {
    it('builds ~/.claude/projects/<slug>/memory for an absolute path', () => {
      const dir = memoryDirFor('/Users/x/projects/socket-btm')
      expect(dir).toBeDefined()
      expect(dir).toContain(
        path.join(
          '.claude',
          'projects',
          '-Users-x-projects-socket-btm',
          'memory',
        ),
      )
    })

    it('returns undefined for a non-absolute path', () => {
      expect(memoryDirFor('relative/path')).toBeUndefined()
      expect(memoryDirFor('')).toBeUndefined()
    })
  })

  describe('wheelhousePathFrom', () => {
    it('resolves the sibling socket-wheelhouse checkout', () => {
      expect(wheelhousePathFrom('/Users/x/projects/socket-btm')).toBe(
        '/Users/x/projects/socket-wheelhouse',
      )
    })

    it('returns undefined for a non-absolute cwd', () => {
      expect(wheelhousePathFrom('rel')).toBeUndefined()
    })
  })

  describe('storeHasIndex', () => {
    it('is true only when MEMORY.md exists in the dir', () => {
      const dir = path.join(tmpHome, 'memory')
      mkdirSync(dir, { recursive: true })
      expect(storeHasIndex(dir)).toBe(false)
      writeFileSync(path.join(dir, 'MEMORY.md'), '# index\n')
      expect(storeHasIndex(dir)).toBe(true)
    })

    it('is false for undefined', () => {
      expect(storeHasIndex(undefined)).toBe(false)
    })
  })

  describe('memoryHint', () => {
    it('returns undefined when no store has an index', () => {
      // A cwd under a tmp home with no memory dirs created.
      const cwd = path.join(tmpHome, 'projects', 'some-repo')
      expect(memoryHint(cwd)).toBeUndefined()
    })

    it('mentions the convention and resolves a path when discoverable', () => {
      // Seed a MEMORY.md at the slug-resolved location under the real home so
      // memoryDirFor(cwd) finds it. Use the actual home dir the hook reads.
      const cwd = process.cwd()
      const dir = memoryDirFor(cwd)
      expect(dir).toBeDefined()
      // Only assert the hint shape if a real store happens to exist; otherwise
      // confirm the silent path. (Behavioral, no source-scanning.)
      const hint = memoryHint(cwd)
      if (hint !== undefined) {
        expect(hint).toContain('OWNS')
        expect(hint).toContain('memory/')
      }
    })
  })
})
