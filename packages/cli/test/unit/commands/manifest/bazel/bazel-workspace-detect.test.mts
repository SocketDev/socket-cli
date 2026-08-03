/**
 * Unit tests for Bazel workspace mode detection (Bzlmod vs legacy WORKSPACE).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from '../../../../../src/commands/manifest/bazel/bazel-workspace-detect.mts'

const testDir = path.dirname(fileURLToPath(import.meta.url))

// From test/unit/commands/manifest/bazel/ the fixtures live four levels up in
// test/fixtures/manifest-bazel.
const FIXTURES = path.join(
  testDir,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'manifest-bazel',
)

describe('bazel-workspace-detect', () => {
  describe('detectWorkspaceMode', () => {
    it('detects bzlmod-only repo', () => {
      const mode = detectWorkspaceMode(path.join(FIXTURES, 'bzlmod-only'))
      expect(mode).toEqual({ bzlmod: true, workspace: false })
    })

    it('detects legacy-only repo', () => {
      const mode = detectWorkspaceMode(path.join(FIXTURES, 'legacy-only'))
      expect(mode).toEqual({ bzlmod: false, workspace: true })
    })

    it('detects migration-window repo (both files)', () => {
      const mode = detectWorkspaceMode(path.join(FIXTURES, 'migration'))
      expect(mode).toEqual({ bzlmod: true, workspace: true })
    })

    it('throws InputError when neither file present', () => {
      // Matches the marker-file names listed in the error message.
      expect(() =>
        detectWorkspaceMode('/tmp/definitely-not-a-bazel-repo-xyz123'),
      ).toThrowError(/MODULE\.bazel|WORKSPACE/)
    })
  })

  describe('getBazelInvocationFlags', () => {
    it('returns legacy flags for workspace-only', () => {
      expect(
        getBazelInvocationFlags({ bzlmod: false, workspace: true }),
      ).toEqual(['--noenable_bzlmod', '--enable_workspace'])
    })

    it('returns empty array for bzlmod-only', () => {
      expect(
        getBazelInvocationFlags({ bzlmod: true, workspace: false }),
      ).toEqual([])
    })

    it('returns empty array for migration (Bzlmod wins)', () => {
      expect(
        getBazelInvocationFlags({ bzlmod: true, workspace: true }),
      ).toEqual([])
    })
  })
})
