/**
 * Unit tests for the `socket fix` filter flags.
 *
 * Covers --ecosystems, --package-managers, and --exclude-paths parsing and
 * validation. Split out of cmd-fix.test.mts to stay under the 500-line cap.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdFix } from '../../../../src/commands/fix/cmd-fix.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(
  import('@socketsecurity/lib-stable/logger/default'),
  async importOriginal => {
    const actual = await importOriginal<typeof LoggerModule>()
    return {
      ...actual,
      getDefaultLogger: () => mockLogger,
    }
  },
)

const mockHandleFix = vi.hoisted(() => vi.fn())
const mockGetDefaultOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: 'test-org' }),
)

vi.mock(import('../../../../src/commands/fix/handle-fix.mts'), () => ({
  handleFix: mockHandleFix,
}))

vi.mock(
  import('../../../../src/commands/ci/fetch-default-org-slug.mts'),
  () => ({
    getDefaultOrgSlug: mockGetDefaultOrgSlug,
  }),
)

describe('cmd-fix filter flags', () => {
  const importMeta = { url: 'file:///test/cmd-fix.mts' }
  const context = { parentName: 'socket' }

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('should pass --ecosystems flag to handleFix', async () => {
    await cmdFix.run(['--ecosystems', 'npm'], importMeta, context)

    expect(mockHandleFix).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystems: ['npm'],
      }),
    )
  })

  it('should uppercase and pass --package-managers to handleFix', async () => {
    await cmdFix.run(['--package-managers', 'pnpm,yarn'], importMeta, context)

    expect(mockHandleFix).toHaveBeenCalledWith(
      expect.objectContaining({
        packageManagers: ['PNPM', 'YARN'],
      }),
    )
  })

  it('should reject an unknown --package-managers value', async () => {
    await cmdFix.run(['--package-managers', 'bower'], importMeta, context)

    expect(mockLogger.fail).toHaveBeenCalledWith(
      expect.stringContaining('--package-managers must be one of'),
    )
    expect(mockHandleFix).not.toHaveBeenCalled()
  })

  it('should pass --exclude-paths to handleFix', async () => {
    await cmdFix.run(
      ['--exclude-paths', 'data/postgres/pgdata'],
      importMeta,
      context,
    )

    expect(mockHandleFix).toHaveBeenCalledWith(
      expect.objectContaining({
        excludePaths: ['data/postgres/pgdata'],
      }),
    )
  })

  it('should reject a negated --exclude-paths pattern', async () => {
    await cmdFix.run(['--exclude-paths', '!keep-me'], importMeta, context)

    expect(mockLogger.fail).toHaveBeenCalledWith(
      expect.stringContaining('negation patterns'),
    )
    expect(mockHandleFix).not.toHaveBeenCalled()
  })

  it('should accept --ecosystems case-insensitively', async () => {
    await cmdFix.run(['--ecosystems', 'NPM,PyPI'], importMeta, context)

    expect(mockHandleFix).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystems: ['npm', 'pypi'],
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
      expect.stringContaining('--ecosystems must be one of'),
    )
  })
})
