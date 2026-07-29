/**
 * Unit tests for PyPI hub discovery: probe validation and the parse+validate
 * composition.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger so verbose diagnostics are capturable without TTY noise.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

import {
  discoverPypiHubs,
  validatePypiHub,
} from '../../../../../src/commands/manifest/bazel/bazel-pypi-discovery.mts'

import type { RepoProbe } from '../../../../../src/commands/manifest/bazel/bazel-repo-discovery.mts'

const acceptingPypiProbe: RepoProbe = async () => ({
  code: 0,
  stderr: '',
  stdout:
    'alias(\n  name = "pkg",\n  actual = select(...),\n)\n@pypi//requests:pkg\n',
})

const rejectingPypiProbe: RepoProbe = async () => ({
  code: 0,
  stderr: '',
  stdout: '',
})

const failingPypiProbe: RepoProbe = async () => ({
  code: 1,
  stderr: '',
  stdout: '',
})

const throwingPypiProbe: RepoProbe = async () => {
  throw new Error('bazel exploded')
}

const selectivePypiProbe: RepoProbe = async name =>
  name === 'pypi'
    ? { code: 0, stderr: '', stdout: '@pypi//requests:pkg\n' }
    : { code: 0, stderr: '', stdout: '' }

const aliasOnlyProbe: RepoProbe = async () => ({
  code: 0,
  stderr: '',
  stdout: 'alias(\n  name = "pkg",\n  actual = "//foo:bar",\n)\n',
})

const noPypiNameProbe: RepoProbe = async () => ({
  code: 0,
  stderr: '',
  stdout: 'alias(\n  name = "pkg",\n)\n',
})

describe('bazel-pypi-discovery', () => {
  let tmp: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmp = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-disc-'))
  })

  afterEach(async () => {
    await safeDelete(tmp)
  })

  describe('validatePypiHub', () => {
    it('accepts when probe stdout contains :pkg label', async () => {
      const r = await validatePypiHub('pypi', acceptingPypiProbe)
      expect(r.valid).toBe(true)
      expect(r.stdout).toContain(':pkg')
    })

    it('accepts when probe stdout contains alias rule', async () => {
      const r = await validatePypiHub('pypi', aliasOnlyProbe)
      expect(r.valid).toBe(true)
    })

    it('rejects when probe stdout lacks :pkg or alias', async () => {
      expect(
        (await validatePypiHub('empty_hub', rejectingPypiProbe)).valid,
      ).toBe(false)
    })

    it('rejects on non-zero exit code', async () => {
      expect((await validatePypiHub('crash', failingPypiProbe)).valid).toBe(
        false,
      )
    })

    it('rejects when probe throws', async () => {
      expect((await validatePypiHub('boom', throwingPypiProbe)).valid).toBe(
        false,
      )
    })

    it('does not require pypi_name= in hub stdout', async () => {
      const r = await validatePypiHub('pypi', noPypiNameProbe)
      expect(r.valid).toBe(true)
    })
  })

  describe('discoverPypiHubs', () => {
    it('returns parsed candidates that the probe validates', async () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n' +
          'pip.parse(hub_name = "pip_test", requirements_lock = "//:req2.txt")\n',
      )
      const result = await discoverPypiHubs(tmp, acceptingPypiProbe)
      expect(Array.from(result.keys()).toSorted()).toEqual(['pip_test', 'pypi'])
      for (const info of result.values()) {
        expect(info.probeStdout).toContain(':pkg')
      }
    })

    it('does not treat bare visible repo candidates as PyPI hubs', async () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n',
      )
      const result = await discoverPypiHubs(tmp, acceptingPypiProbe, {
        nativeCandidates: ['native_pypi'],
      })
      expect(Array.from(result.keys())).toEqual(['pypi'])
    })

    it('filters out candidates the probe rejects', async () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n' +
          'pip.parse(hub_name = "rejected", requirements_lock = "//:req2.txt")\n',
      )
      const result = await discoverPypiHubs(tmp, selectivePypiProbe)
      expect(Array.from(result.keys())).toEqual(['pypi'])
    })

    it('always seeds with default pypi hub', async () => {
      // No MODULE.bazel or WORKSPACE — only the default seed can match.
      const result = await discoverPypiHubs(tmp, selectivePypiProbe)
      expect(Array.from(result.keys())).toEqual(['pypi'])
    })

    it('prefers bazel command candidates over static MODULE parsing', async () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "static_pypi", requirements_lock = "//:req.txt")\n',
      )
      const result = await discoverPypiHubs(tmp, acceptingPypiProbe, {
        bazelCommandCandidates: [
          {
            hubName: 'pypi',
            requirementsLockLabel: '//:requirements_lock.txt',
            source: 'bazel-mod-show-extension',
            workspaceMode: 'bzlmod',
          },
        ],
      })
      expect(Array.from(result.keys())).toEqual(['pypi'])
      expect(result.get('pypi')?.source).toBe('bazel-mod-show-extension')
    })
  })

  describe('verbose diagnostics', () => {
    function loggedLines(): string {
      return mockLogger.log.mock.calls
        .map(args => args.map(a => String(a)).join(' '))
        .join('\n')
    }

    it('validatePypiHub logs ACCEPT under verbose', async () => {
      await validatePypiHub('pypi', acceptingPypiProbe, { verbose: true })
      expect(loggedLines()).toMatch(
        /probe @pypi:\s*ACCEPT \(hub alias\/pkg marker found\)/,
      )
    })

    it('validatePypiHub logs REJECT (no marker) under verbose', async () => {
      await validatePypiHub('not_pypi', rejectingPypiProbe, { verbose: true })
      expect(loggedLines()).toMatch(/probe @not_pypi:\s*REJECT/)
    })

    it('validatePypiHub logs REJECT (probe threw) under verbose', async () => {
      await validatePypiHub('boom', throwingPypiProbe, { verbose: true })
      expect(loggedLines()).toMatch(/probe @boom:\s*REJECT \(probe threw\)/)
    })

    it('discoverPypiHubs propagates verbose into the full pipeline', async () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n' +
          'pip.parse(hub_name = "rejected", requirements_lock = "//:req2.txt")\n',
      )
      await discoverPypiHubs(tmp, selectivePypiProbe, { verbose: true })
      const text = loggedLines()
      expect(text).toContain('candidate source: static parse')
      expect(text).toContain('candidate set to probe')
      expect(text).toMatch(/probe @pypi:\s*ACCEPT/)
      expect(text).toMatch(/probe @rejected:\s*REJECT/)
      expect(text).toContain('validated pip hubs')
    })
  })
})
