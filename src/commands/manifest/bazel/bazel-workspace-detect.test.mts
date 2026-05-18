import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from './bazel-workspace-detect.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// from src/commands/manifest/bazel/ to repo root is four levels up, then into
// test/fixtures/manifest-bazel.
const FIXTURES = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
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
