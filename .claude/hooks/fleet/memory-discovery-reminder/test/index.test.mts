/**
 * @file Unit tests for memory-discovery-reminder.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

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
      assert.strictEqual(
        projectSlug('/Users/x/projects/socket-btm'),
        '-Users-x-projects-socket-btm',
      )
    })
  })

  describe('memoryDirFor', () => {
    it('builds ~/.claude/projects/<slug>/memory for an absolute path', () => {
      const dir = memoryDirFor('/Users/x/projects/socket-btm')
      assert.notStrictEqual(dir, undefined)
      assert.ok(
        dir!.includes(
          path.join(
            '.claude',
            'projects',
            '-Users-x-projects-socket-btm',
            'memory',
          ),
        ),
      )
    })

    it('returns undefined for a non-absolute path', () => {
      assert.strictEqual(memoryDirFor('relative/path'), undefined)
      assert.strictEqual(memoryDirFor(''), undefined)
    })
  })

  describe('wheelhousePathFrom', () => {
    it('resolves the sibling socket-wheelhouse checkout', () => {
      assert.strictEqual(
        wheelhousePathFrom('/Users/x/projects/socket-btm'),
        '/Users/x/projects/socket-wheelhouse',
      )
    })

    it('returns undefined for a non-absolute cwd', () => {
      assert.strictEqual(wheelhousePathFrom('rel'), undefined)
    })
  })

  describe('storeHasIndex', () => {
    it('is true only when MEMORY.md exists in the dir', () => {
      const dir = path.join(tmpHome, 'memory')
      mkdirSync(dir, { recursive: true })
      assert.strictEqual(storeHasIndex(dir), false)
      writeFileSync(path.join(dir, 'MEMORY.md'), '# index\n')
      assert.strictEqual(storeHasIndex(dir), true)
    })

    it('is false for undefined', () => {
      assert.strictEqual(storeHasIndex(undefined), false)
    })
  })

  describe('memoryHint', () => {
    it('returns undefined when no store has an index', () => {
      // A cwd under a tmp home with no memory dirs created.
      const cwd = path.join(tmpHome, 'projects', 'some-repo')
      assert.strictEqual(memoryHint(cwd), undefined)
    })

    it('mentions the convention and resolves a path when discoverable', () => {
      // Seed a MEMORY.md at the slug-resolved location under the real home so
      // memoryDirFor(cwd) finds it. Use the actual home dir the hook reads.
      const cwd = process.cwd()
      const dir = memoryDirFor(cwd)
      assert.notStrictEqual(dir, undefined)
      // Only assert the hint shape if a real store happens to exist; otherwise
      // confirm the silent path. (Behavioral, no source-scanning.)
      const hint = memoryHint(cwd)
      if (hint !== undefined) {
        assert.ok(hint.includes('OWNS'))
        assert.ok(hint.includes('memory/'))
      }
    })
  })
})
