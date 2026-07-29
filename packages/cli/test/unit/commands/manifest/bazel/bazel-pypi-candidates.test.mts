/**
 * Unit tests for pip hub candidate parsing: MODULE.bazel / WORKSPACE static
 * scans, show_extension output parsing, and the DoS guards.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  parseBazelModPipExtensionCandidates,
  parsePypiHubCandidates,
} from '../../../../../src/commands/manifest/bazel/bazel-pypi-candidates.mts'

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

describe('bazel-pypi-candidates', () => {
  let tmp: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmp = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
  })

  afterEach(async () => {
    await safeDelete(tmp)
  })

  describe('parseBazelModPipExtensionCandidates', () => {
    it('parses pip metadata from bazel mod show_extension output', () => {
      const result = parseBazelModPipExtensionCandidates(
        'pip.parse(hub_name="pypi", python_version="3.12", requirements_lock="//:requirements_lock.txt")\n' +
          'use_repo(pip, "pypi")\n',
      )
      expect(result).toEqual([
        {
          hubName: 'pypi',
          pythonVersion: '3.12',
          requirementsLockLabel: '//:requirements_lock.txt',
          source: 'bazel-mod-show-extension',
          workspaceMode: 'bzlmod',
        },
      ])
    })

    it('filters show_extension pip.parse entries not exported by use_repo', () => {
      const result = parseBazelModPipExtensionCandidates(
        'pip.parse(hub_name="hidden", requirements_lock="//:req.txt")\n' +
          'use_repo(pip, "pypi")\n',
      )
      expect(result).toEqual([])
    })
  })

  describe('parsePypiHubCandidates', () => {
    it('parses single pip.parse from bzlmod-only', () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(\n' +
          '    hub_name = "pypi",\n' +
          '    python_version = "3.12",\n' +
          '    requirements_lock = "//:requirements_lock.txt",\n' +
          ')\n' +
          'use_repo(pip, "pypi")\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hubName: 'pypi',
        pythonVersion: '3.12',
        requirementsLockLabel: '//:requirements_lock.txt',
        source: 'MODULE.bazel',
        workspaceMode: 'bzlmod',
      })
    })

    it('parses renamed use_extension binding', () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'my_pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'my_pip.parse(\n' +
          '    hub_name = "custom_pypi",\n' +
          '    requirements_lock = "//:requirements_lock.txt",\n' +
          ')\n' +
          'use_repo(my_pip, "custom_pypi")\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hubName: 'custom_pypi',
        pythonVersion: undefined,
        requirementsLockLabel: '//:requirements_lock.txt',
        source: 'MODULE.bazel',
        workspaceMode: 'bzlmod',
      })
    })

    it('parses single-quoted bzlmod pip.parse attributes', () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(\n' +
          "    hub_name = 'custom_pypi',\n" +
          "    python_version = '3.12',\n" +
          "    requirements_lock = '//:requirements_lock.txt',\n" +
          ')\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hubName: 'custom_pypi',
        pythonVersion: '3.12',
        requirementsLockLabel: '//:requirements_lock.txt',
        source: 'MODULE.bazel',
        workspaceMode: 'bzlmod',
      })
    })

    it('parses pip_parse name from legacy WORKSPACE', () => {
      writeFileSync(
        path.join(tmp, 'WORKSPACE'),
        'pip_parse(\n' +
          '    name = "pypi",\n' +
          '    requirements_lock = "//:requirements_lock.txt",\n' +
          ')\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hubName: 'pypi',
        pythonVersion: undefined,
        requirementsLockLabel: '//:requirements_lock.txt',
        source: 'WORKSPACE',
        workspaceMode: 'legacy',
      })
    })

    it('parses single-quoted legacy pip_parse and lockfile attributes', () => {
      writeFileSync(
        path.join(tmp, 'WORKSPACE'),
        'pip_parse(\n' +
          "    name = 'pypi',\n" +
          "    requirements_lock = '//:requirements_lock.txt',\n" +
          ')\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hubName: 'pypi',
        pythonVersion: undefined,
        requirementsLockLabel: '//:requirements_lock.txt',
        source: 'WORKSPACE',
        workspaceMode: 'legacy',
      })
    })

    it('parses pip_install name from legacy WORKSPACE', () => {
      writeFileSync(
        path.join(tmp, 'WORKSPACE'),
        'pip_install(\n' +
          '    name = "pypi",\n' +
          '    requirements = ["//:requirements.txt"],\n' +
          ')\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hubName: 'pypi',
        pythonVersion: undefined,
        requirementsLockLabel: undefined,
        source: 'WORKSPACE',
        workspaceMode: 'legacy',
      })
    })

    it('parses single-quoted pip_install name from legacy WORKSPACE', () => {
      writeFileSync(
        path.join(tmp, 'WORKSPACE'),
        "pip_install(name = 'pypi', requirements = ['//:requirements.txt'])\n",
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hubName: 'pypi',
        pythonVersion: undefined,
        requirementsLockLabel: undefined,
        source: 'WORKSPACE',
        workspaceMode: 'legacy',
      })
    })

    it('parses pip_repository name from legacy WORKSPACE', () => {
      writeFileSync(
        path.join(tmp, 'WORKSPACE'),
        'pip_repository(\n' +
          '    name = "pypi",\n' +
          '    requirements = ["//:requirements.txt"],\n' +
          ')\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        hubName: 'pypi',
        pythonVersion: undefined,
        requirementsLockLabel: undefined,
        source: 'WORKSPACE',
        workspaceMode: 'legacy',
      })
    })

    it('parses multiple hubs from a single MODULE.bazel', () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "pypi", python_version = "3.11", requirements_lock = "//:req1.txt")\n' +
          'pip.parse(hub_name = "pip_test", python_version = "3.12", requirements_lock = "//:req2.txt")\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(2)
      const names = result.map(r => r.hubName).toSorted()
      expect(names).toEqual(['pip_test', 'pypi'])
    })

    it('handles multiple python_version values', () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "pypi", python_version = "3.11", requirements_lock = "//:req.txt")\n' +
          'pip.parse(hub_name = "pypi_312", python_version = "3.12", requirements_lock = "//:req2.txt")\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toHaveLength(2)
      const pypi = result.find(r => r.hubName === 'pypi')
      expect(pypi?.pythonVersion).toBe('3.11')
      const pypi312 = result.find(r => r.hubName === 'pypi_312')
      expect(pypi312?.pythonVersion).toBe('3.12')
    })

    it('returns empty array on a directory without bazel markers', () => {
      expect(parsePypiHubCandidates(FIXTURES)).toEqual([])
    })

    it('ignores malformed pip.parse blocks without hub_name', () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(requirements_lock = "//:req.txt")\n',
      )
      const result = parsePypiHubCandidates(tmp)
      expect(result).toEqual([])
    })
  })

  describe('verbose diagnostics', () => {
    function loggedLines(): string {
      return mockLogger.log.mock.calls
        .map(args => args.map(a => String(a)).join(' '))
        .join('\n')
    }

    it('parsePypiHubCandidates stays silent when verbose is unset', () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n',
      )
      parsePypiHubCandidates(tmp)
      expect(mockLogger.log).not.toHaveBeenCalled()
    })

    it('parsePypiHubCandidates emits scanned-files + candidate set when verbose', () => {
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n',
      )
      parsePypiHubCandidates(tmp, { verbose: true })
      const text = loggedLines()
      expect(text).toContain('discovery: scanned')
      expect(text).toContain('MODULE.bazel')
      expect(text).toContain('use_extension pip binding')
    })
  })

  describe('DoS guard', () => {
    it('completes parse on 1MB pathological input within 1s', () => {
      const lines: string[] = []
      let totalLen = 0
      while (totalLen < 1_000_000) {
        const line =
          'pip.parse(hub_name = "x_' +
          lines.length +
          '", requirements_lock = "//:req.txt")'
        lines.push(line)
        totalLen += line.length + 1
      }
      writeFileSync(
        path.join(tmp, 'MODULE.bazel'),
        'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
          lines.join('\n') +
          '\n',
      )
      const start = process.hrtime.bigint()
      expect(() => parsePypiHubCandidates(tmp)).toThrow(
        /more than 256 pip hub candidates/,
      )
      const elapsed = process.hrtime.bigint() - start
      expect(elapsed).toBeLessThan(1_000_000_000n)
    })

    it('ignores oversized MODULE.bazel files', () => {
      // Write a file larger than MAX_WORKSPACE_FILE_BYTES (5MB).
      const bigContent = 'x'.repeat(6 * 1024 * 1024)
      writeFileSync(path.join(tmp, 'MODULE.bazel'), bigContent)
      const result = parsePypiHubCandidates(tmp)
      expect(result).toEqual([])
    })

    it('ignores oversized WORKSPACE files', () => {
      const bigContent = 'x'.repeat(6 * 1024 * 1024)
      writeFileSync(path.join(tmp, 'WORKSPACE'), bigContent)
      const result = parsePypiHubCandidates(tmp)
      expect(result).toEqual([])
    })

    it('ignores oversized top-level .bzl files', () => {
      // Write a 6MB .bzl file (exceeds MAX_WORKSPACE_FILE_BYTES = 5MB).
      // The oversized file should be silently dropped by
      // safeReadWorkspaceFile, not parsed for legacy
      // pip_parse/pip_install/pip_repository hits.
      const bigContent = 'x'.repeat(6 * 1024 * 1024)
      writeFileSync(path.join(tmp, 'pip_repo.bzl'), bigContent)
      const result = parsePypiHubCandidates(tmp)
      expect(result).toEqual([])
    })
  })
})
