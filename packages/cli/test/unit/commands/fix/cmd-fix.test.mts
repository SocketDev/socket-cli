/**
 * Unit tests for fix command.
 *
 * Tests the command that fixes CVEs in dependencies.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock dependencies.
const mockHandleFix = vi.hoisted(() => vi.fn())
const mockGetDefaultOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: 'test-org' }),
)

vi.mock('../../../../src/commands/fix/handle-fix.mts', () => ({
  handleFix: mockHandleFix,
}))

vi.mock('../../../../src/commands/ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: mockGetDefaultOrgSlug,
}))

// Import after mocks.
const { cmdFix } = await import('../../../../src/commands/fix/cmd-fix.mts')

describe('cmd-fix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdFix.description).toBe('Fix CVEs in dependencies')
    })

    it('should not be hidden', () => {
      expect(cmdFix.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-fix.mts' }
    const context = { parentName: 'socket' }

    it('should support --dry-run flag', async () => {
      await cmdFix.run(['--dry-run'], importMeta, context)

      expect(mockHandleFix).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail if org slug cannot be resolved', async () => {
      mockGetDefaultOrgSlug.mockResolvedValueOnce({
        ok: false,
        code: 1,
        error: 'No org found',
      })

      await cmdFix.run([], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockHandleFix).not.toHaveBeenCalled()
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Unable to resolve'),
      )
    })

    it('should call handleFix with default options', async () => {
      await cmdFix.run([], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          all: false,
          applyFixes: true,
          autopilot: false,
          cwd: expect.any(String),
          debug: false,
          disableMajorUpdates: false,
          ecosystems: [],
          exclude: [],
          ghsas: [],
          include: [],
          minimumReleaseAge: '',
          orgSlug: 'test-org',
          outputFile: '',
          outputKind: 'text',
          prCheck: true,
          prLimit: 10,
          rangeStyle: 'preserve',
          showAffectedDirectDependencies: false,
          silence: false,
        }),
      )
    })

    it('should pass --all flag to handleFix', async () => {
      await cmdFix.run(['--all'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          all: true,
        }),
      )
    })

    it('should pass --id flag to handleFix', async () => {
      await cmdFix.run(['--id', 'CVE-2021-23337'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          ghsas: ['CVE-2021-23337'],
        }),
      )
    })

    it('should pass multiple --id flags to handleFix', async () => {
      await cmdFix.run(
        ['--id', 'CVE-2021-23337', '--id', 'GHSA-xxxx-yyyy-zzzz'],
        importMeta,
        context,
      )

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          ghsas: ['CVE-2021-23337', 'GHSA-xxxx-yyyy-zzzz'],
        }),
      )
    })

    it('should pass comma-separated --id values to handleFix', async () => {
      await cmdFix.run(
        ['--id', 'CVE-2021-23337,GHSA-xxxx-yyyy-zzzz'],
        importMeta,
        context,
      )

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          ghsas: ['CVE-2021-23337', 'GHSA-xxxx-yyyy-zzzz'],
        }),
      )
    })

    it('should fail if both --all and --id are provided', async () => {
      await cmdFix.run(['--all', '--id', 'CVE-2021-23337'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleFix).not.toHaveBeenCalled()
    })

    it('should pass --ecosystems flag to handleFix', async () => {
      await cmdFix.run(['--ecosystems', 'npm'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          ecosystems: ['npm'],
        }),
      )
    })

    it('should pass multiple ecosystems to handleFix', async () => {
      await cmdFix.run(['--ecosystems', 'npm,pypi'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          ecosystems: ['npm', 'pypi'],
        }),
      )
    })

    it('should fail with invalid ecosystem', async () => {
      await cmdFix.run(['--ecosystems', 'invalid'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockHandleFix).not.toHaveBeenCalled()
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Invalid ecosystem'),
      )
    })

    it('should pass --range-style flag to handleFix', async () => {
      await cmdFix.run(['--range-style', 'pin'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          rangeStyle: 'pin',
        }),
      )
    })

    it('should fail with invalid range-style', async () => {
      await cmdFix.run(['--range-style', 'invalid'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleFix).not.toHaveBeenCalled()
    })

    it('should pass --no-major-updates flag to handleFix', async () => {
      await cmdFix.run(['--no-major-updates'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          disableMajorUpdates: true,
        }),
      )
    })

    it('should pass --no-apply-fixes flag to handleFix', async () => {
      await cmdFix.run(['--no-apply-fixes'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          applyFixes: false,
        }),
      )
    })

    it('should pass --autopilot flag to handleFix', async () => {
      await cmdFix.run(['--autopilot'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          autopilot: true,
        }),
      )
    })

    it('should pass --debug flag to handleFix', async () => {
      await cmdFix.run(['--debug'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          debug: true,
        }),
      )
    })

    it('should pass --pr-limit flag to handleFix', async () => {
      await cmdFix.run(['--pr-limit', '5'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          prLimit: 5,
        }),
      )
    })

    it('should pass --output-file flag to handleFix', async () => {
      await cmdFix.run(['--output-file', './fixes.json'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          outputFile: './fixes.json',
        }),
      )
    })

    it('should pass --minimum-release-age flag to handleFix', async () => {
      await cmdFix.run(['--minimum-release-age', '1w'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          minimumReleaseAge: '1w',
        }),
      )
    })

    it('should pass --show-affected-direct-dependencies flag to handleFix', async () => {
      await cmdFix.run(
        ['--show-affected-direct-dependencies'],
        importMeta,
        context,
      )

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          showAffectedDirectDependencies: true,
        }),
      )
    })

    it('should pass --silence flag to handleFix', async () => {
      await cmdFix.run(['--silence'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          silence: true,
        }),
      )
    })

    it('should pass --include flag to handleFix', async () => {
      await cmdFix.run(['--include', 'packages/*'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          include: ['packages/*'],
        }),
      )
    })

    it('should pass --exclude flag to handleFix', async () => {
      await cmdFix.run(['--exclude', 'test/*'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          exclude: ['test/*'],
        }),
      )
    })

    it('should support custom cwd argument', async () => {
      // Use a path that definitely exists (the test's own cwd) because
      // cmd-fix now validates the target directory upfront.
      const realDir = process.cwd()
      await cmdFix.run([realDir], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: realDir,
        }),
      )
    })

    it('should fail fast when target directory does not exist', async () => {
      await cmdFix.run(['./this/path/does/not/exist'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockHandleFix).not.toHaveBeenCalled()
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Target directory does not exist'),
      )
    })

    it('should fail fast when a GHSA is passed as a positional arg', async () => {
      await cmdFix.run(['GHSA-xxxx-xxxx-xxxx'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockHandleFix).not.toHaveBeenCalled()
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining(
          'looks like a vulnerability identifier, not a directory path',
        ),
      )
    })

    it('should normalize a lowercase GHSA suggestion to prefix-upper / body-lower', async () => {
      await cmdFix.run(['ghsa-abcd-efgh-ijkl'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockHandleFix).not.toHaveBeenCalled()
      // handle-fix.mts validates GHSA format as /^GHSA-[a-z0-9]{4}-...$/:
      // prefix must be uppercase, body segments must stay lowercase.
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('--id GHSA-abcd-efgh-ijkl'),
      )
    })

    it('should normalize a lowercase CVE suggestion to uppercase CVE prefix', async () => {
      await cmdFix.run(['cve-2021-23337'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockHandleFix).not.toHaveBeenCalled()
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('--id CVE-2021-23337'),
      )
    })

    it('should leave a PURL suggestion untouched', async () => {
      await cmdFix.run(['pkg:npm/left-pad@1.3.0'], importMeta, context)

      expect(process.exitCode).toBe(1)
      expect(mockHandleFix).not.toHaveBeenCalled()
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('--id pkg:npm/left-pad@1.3.0'),
      )
    })

    it('should fail fast without calling getDefaultOrgSlug when input looks like an ID', async () => {
      await cmdFix.run(['GHSA-xxxx-xxxx-xxxx'], importMeta, context)

      // The validation must run before the network-backed org-slug resolution,
      // so users without a configured API token still see the helpful message.
      expect(mockGetDefaultOrgSlug).not.toHaveBeenCalled()
    })

    it('should fail fast without calling getDefaultOrgSlug when target dir missing', async () => {
      await cmdFix.run(['./this/path/does/not/exist'], importMeta, context)

      expect(mockGetDefaultOrgSlug).not.toHaveBeenCalled()
    })

    it('should support --json output mode', async () => {
      await cmdFix.run(['--json'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      await cmdFix.run(['--markdown'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail if both --json and --markdown are provided', async () => {
      await cmdFix.run(['--json', '--markdown'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockHandleFix).not.toHaveBeenCalled()
    })

    it('should show all vulnerabilities in dry-run with --all', async () => {
      await cmdFix.run(['--dry-run', '--all'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('all vulnerabilities'),
      )
    })

    it('should show specific vulnerability count in dry-run with --id', async () => {
      await cmdFix.run(
        ['--dry-run', '--id', 'CVE-2021-23337,GHSA-xxxx-yyyy-zzzz'],
        importMeta,
        context,
      )

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('2 specified vulnerability'),
      )
    })

    it('should show compute-only mode in dry-run with --no-apply-fixes', async () => {
      await cmdFix.run(['--dry-run', '--no-apply-fixes'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('compute fixes only'),
      )
    })

    it('should handle org slug error with specific error code', async () => {
      mockGetDefaultOrgSlug.mockResolvedValueOnce({
        ok: false,
        code: 42,
        error: 'Specific error',
      })

      await cmdFix.run([], importMeta, context)

      expect(process.exitCode).toBe(42)
      expect(mockHandleFix).not.toHaveBeenCalled()
    })

    it('should show ecosystems in dry-run output', async () => {
      await cmdFix.run(['--dry-run', '--ecosystems', 'npm,pypi'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should show auto-discovered targets in dry-run when no --id or --all', async () => {
      await cmdFix.run(['--dry-run'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('auto-discovered'),
      )
    })


    it('should show PR info in dry-run when apply fixes enabled', async () => {
      await cmdFix.run(['--dry-run'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should pass --no-pr-check flag to handleFix', async () => {
      await cmdFix.run(['--no-pr-check'], importMeta, context)

      expect(mockHandleFix).toHaveBeenCalledWith(
        expect.objectContaining({
          prCheck: false,
        }),
      )
    })
  })
})
