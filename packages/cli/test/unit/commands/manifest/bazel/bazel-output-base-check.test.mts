/**
 * Unit tests for --bazel-output-base validation (traversal guard, writability).
 */

import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { validateOutputBase } from '../../../../../src/commands/manifest/bazel/bazel-output-base-check.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

describe('validateOutputBase', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'output-base-check-'))
  })

  afterEach(async () => {
    // Restore permissions before cleanup in case a test made a dir read-only.
    try {
      chmodSync(tmp, 0o755)
    } catch {
      // Ignore errors.
    }
    await safeDelete(tmp)
  })

  it('accepts an existing writable directory without throwing', () => {
    expect(() => validateOutputBase(tmp, '/anywhere')).not.toThrow()
  })

  it('accepts a nonexistent path under a writable parent and creates it', () => {
    const child = path.join(tmp, 'new-output-base')
    expect(() => validateOutputBase(child, '/anywhere')).not.toThrow()
  })

  it('throws InputError when path contains `..` segments', () => {
    // Matches the quoted `..` token in the error message.
    expect(() => validateOutputBase('../../etc', tmp)).toThrow(/'\.\.'/)
  })

  it('throws InputError when existing path is not writable', () => {
    // Run only as non-root where chmod actually restricts access.
    if (process.getuid?.() === 0) {
      return
    }
    const ro = path.join(tmp, 'readonly')
    mkdirSync(ro)
    chmodSync(ro, 0o555)
    try {
      expect(() => validateOutputBase(ro, '/anywhere')).toThrow(/not writable/)
    } finally {
      chmodSync(ro, 0o755)
    }
  })

  it('accepts an absolute path inside the OS tempdir when it contains no `..` segments', () => {
    // The tmp dir itself is a writable absolute path with no `..`.
    expect(() => validateOutputBase(tmp, '/anywhere')).not.toThrow()
  })
})
