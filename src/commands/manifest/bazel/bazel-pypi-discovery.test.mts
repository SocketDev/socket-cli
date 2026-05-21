import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  discoverPypiHubs,
  parsePypiHubCandidates,
  validatePypiHub,
} from './bazel-pypi-discovery.mts'

import type { RepoProbe } from './bazel-repo-discovery.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

const acceptingPypiProbe: RepoProbe = async () => ({
  stdout:
    'alias(\n  name = "pkg",\n  actual = select(...),\n)\n@pypi//requests:pkg\n',
  code: 0,
})

const rejectingPypiProbe: RepoProbe = async () => ({ stdout: '', code: 0 })

const failingPypiProbe: RepoProbe = async () => ({ stdout: '', code: 1 })

const throwingPypiProbe: RepoProbe = async () => {
  throw new Error('bazel exploded')
}

const selectivePypiProbe: RepoProbe = async name =>
  name === 'pypi'
    ? { stdout: '@pypi//requests:pkg\n', code: 0 }
    : { stdout: '', code: 0 }

const aliasOnlyProbe: RepoProbe = async () => ({
  stdout: 'alias(\n  name = "pkg",\n  actual = "//foo:bar",\n)\n',
  code: 0,
})

const noPypiNameProbe: RepoProbe = async () => ({
  stdout: 'alias(\n  name = "pkg",\n)\n',
  code: 0,
})

describe('bazel-pypi-discovery', () => {
  describe('parsePypiHubCandidates', () => {
    it('parses single pip.parse from bzlmod-only', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(\n' +
            '    hub_name = "pypi",\n' +
            '    python_version = "3.12",\n' +
            '    requirements_lock = "//:requirements_lock.txt",\n' +
            ')\n' +
            'use_repo(pip, "pypi")\n',
        )
        const result = parsePypiHubCandidates(dir)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          hubName: 'pypi',
          source: 'MODULE.bazel',
          workspaceMode: 'bzlmod',
          pythonVersion: '3.12',
          requirementsLockLabel: '//:requirements_lock.txt',
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('parses renamed use_extension binding', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'my_pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'my_pip.parse(\n' +
            '    hub_name = "custom_pypi",\n' +
            '    requirements_lock = "//:requirements_lock.txt",\n' +
            ')\n' +
            'use_repo(my_pip, "custom_pypi")\n',
        )
        const result = parsePypiHubCandidates(dir)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          hubName: 'custom_pypi',
          source: 'MODULE.bazel',
          workspaceMode: 'bzlmod',
          requirementsLockLabel: '//:requirements_lock.txt',
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('parses pip_parse name from legacy WORKSPACE', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'WORKSPACE'),
          'pip_parse(\n' +
            '    name = "pypi",\n' +
            '    requirements_lock = "//:requirements_lock.txt",\n' +
            ')\n',
        )
        const result = parsePypiHubCandidates(dir)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          hubName: 'pypi',
          source: 'WORKSPACE',
          workspaceMode: 'legacy',
          requirementsLockLabel: '//:requirements_lock.txt',
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('parses pip_install name from legacy WORKSPACE', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'WORKSPACE'),
          'pip_install(\n' +
            '    name = "pypi",\n' +
            '    requirements = ["//:requirements.txt"],\n' +
            ')\n',
        )
        const result = parsePypiHubCandidates(dir)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          hubName: 'pypi',
          source: 'WORKSPACE',
          workspaceMode: 'legacy',
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('parses pip_repository name from legacy WORKSPACE', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'WORKSPACE'),
          'pip_repository(\n' +
            '    name = "pypi",\n' +
            '    requirements = ["//:requirements.txt"],\n' +
            ')\n',
        )
        const result = parsePypiHubCandidates(dir)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          hubName: 'pypi',
          source: 'WORKSPACE',
          workspaceMode: 'legacy',
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('parses multiple hubs from a single MODULE.bazel', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(hub_name = "pypi", python_version = "3.11", requirements_lock = "//:req1.txt")\n' +
            'pip.parse(hub_name = "pip_test", python_version = "3.12", requirements_lock = "//:req2.txt")\n',
        )
        const result = parsePypiHubCandidates(dir)
        expect(result).toHaveLength(2)
        const names = result.map(r => r.hubName).sort()
        expect(names).toEqual(['pip_test', 'pypi'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('handles multiple python_version values', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(hub_name = "pypi", python_version = "3.11", requirements_lock = "//:req.txt")\n' +
            'pip.parse(hub_name = "pypi_312", python_version = "3.12", requirements_lock = "//:req2.txt")\n',
        )
        const result = parsePypiHubCandidates(dir)
        expect(result).toHaveLength(2)
        const pypi = result.find(r => r.hubName === 'pypi')
        expect(pypi?.pythonVersion).toBe('3.11')
        const pypi312 = result.find(r => r.hubName === 'pypi_312')
        expect(pypi312?.pythonVersion).toBe('3.12')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('returns empty array on a directory without bazel markers', () => {
      expect(parsePypiHubCandidates(FIXTURES)).toEqual([])
    })

    it('ignores malformed pip.parse blocks without hub_name', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(requirements_lock = "//:req.txt")\n',
        )
        const result = parsePypiHubCandidates(dir)
        expect(result).toEqual([])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
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
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n' +
            'pip.parse(hub_name = "pip_test", requirements_lock = "//:req2.txt")\n',
        )
        const result = await discoverPypiHubs(dir, acceptingPypiProbe)
        expect(Array.from(result.keys()).sort()).toEqual(['pip_test', 'pypi'])
        for (const info of result.values()) {
          expect(info.probeStdout).toContain(':pkg')
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('does not treat bare visible repo candidates as PyPI hubs', async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n',
        )
        const result = await discoverPypiHubs(dir, acceptingPypiProbe, [
          'native_pypi',
        ])
        expect(Array.from(result.keys())).toEqual(['pypi'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('filters out candidates the probe rejects', async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n' +
            'pip.parse(hub_name = "rejected", requirements_lock = "//:req2.txt")\n',
        )
        const result = await discoverPypiHubs(dir, selectivePypiProbe)
        expect(Array.from(result.keys())).toEqual(['pypi'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('always seeds with default pypi hub', async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        // No MODULE.bazel or WORKSPACE — only the default seed can match.
        const result = await discoverPypiHubs(dir, selectivePypiProbe)
        expect(Array.from(result.keys())).toEqual(['pypi'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('verbose diagnostics', () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      logSpy = vi.spyOn(logger, 'log').mockImplementation(() => logger)
    })

    afterEach(() => {
      logSpy.mockRestore()
    })

    function loggedLines(): string {
      return logSpy.mock.calls
        .map(args => args.map(a => String(a)).join(' '))
        .join('\n')
    }

    it('parsePypiHubCandidates stays silent when verbose is unset', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n',
        )
        parsePypiHubCandidates(dir)
        expect(logSpy).not.toHaveBeenCalled()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('parsePypiHubCandidates emits scanned-files + candidate set when verbose=true', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n',
        )
        parsePypiHubCandidates(dir, true)
        const text = loggedLines()
        expect(text).toContain('discovery: scanned')
        expect(text).toContain('MODULE.bazel')
        expect(text).toContain('use_extension pip binding')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('validatePypiHub logs ACCEPT under verbose', async () => {
      await validatePypiHub('pypi', acceptingPypiProbe, true)
      expect(loggedLines()).toMatch(
        /probe @pypi:\s*ACCEPT \(hub alias\/pkg marker found\)/,
      )
    })

    it('validatePypiHub logs REJECT (no marker) under verbose', async () => {
      await validatePypiHub('not_pypi', rejectingPypiProbe, true)
      expect(loggedLines()).toMatch(/probe @not_pypi:\s*REJECT/)
    })

    it('validatePypiHub logs REJECT (probe threw) under verbose', async () => {
      await validatePypiHub('boom', throwingPypiProbe, true)
      expect(loggedLines()).toMatch(/probe @boom:\s*REJECT \(probe threw\)/)
    })

    it('discoverPypiHubs propagates verbose into the full pipeline', async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            'pip.parse(hub_name = "pypi", requirements_lock = "//:req.txt")\n' +
            'pip.parse(hub_name = "rejected", requirements_lock = "//:req2.txt")\n',
        )
        await discoverPypiHubs(dir, selectivePypiProbe, undefined, true)
        const text = loggedLines()
        expect(text).toContain('candidate source: static parse')
        expect(text).toContain('candidate set to probe')
        expect(text).toMatch(/probe @pypi:\s*ACCEPT/)
        expect(text).toMatch(/probe @rejected:\s*REJECT/)
        expect(text).toContain('validated pip hubs')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('DoS guard', () => {
    it('completes parse on 1MB pathological input within 1s', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
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
          path.join(dir, 'MODULE.bazel'),
          'pip = use_extension("@rules_python//python/extensions:pip.bzl", "pip")\n' +
            lines.join('\n') +
            '\n',
        )
        const start = process.hrtime.bigint()
        expect(() => parsePypiHubCandidates(dir)).toThrow(
          /more than 256 pip hub candidates/,
        )
        const elapsed = process.hrtime.bigint() - start
        expect(elapsed).toBeLessThan(1_000_000_000n)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('ignores oversized MODULE.bazel files', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        // Write a file larger than MAX_WORKSPACE_FILE_BYTES (5MB).
        const bigContent = 'x'.repeat(6 * 1024 * 1024)
        writeFileSync(path.join(dir, 'MODULE.bazel'), bigContent)
        const result = parsePypiHubCandidates(dir)
        expect(result).toEqual([])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('ignores oversized WORKSPACE files', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        const bigContent = 'x'.repeat(6 * 1024 * 1024)
        writeFileSync(path.join(dir, 'WORKSPACE'), bigContent)
        const result = parsePypiHubCandidates(dir)
        expect(result).toEqual([])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('ignores oversized top-level .bzl files', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-pypi-'))
      try {
        // Write a 6MB .bzl file (exceeds MAX_WORKSPACE_FILE_BYTES = 5MB).
        // The oversized file should be silently dropped by safeReadFile,
        // not parsed for legacy pip_parse/pip_install/pip_repository hits.
        const bigContent = 'x'.repeat(6 * 1024 * 1024)
        writeFileSync(path.join(dir, 'pip_repo.bzl'), bigContent)
        const result = parsePypiHubCandidates(dir)
        expect(result).toEqual([])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
