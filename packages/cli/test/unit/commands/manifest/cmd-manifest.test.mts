/**
 * Unit tests for manifest parent command.
 *
 * Tests the parent command that manages manifest generation for various ecosystems.
 * This command uses meowWithSubcommands to delegate to specific ecosystem commands.
 *
 * Test Coverage:
 * - Command metadata (description, hidden)
 * - Subcommand registration and routing
 * - Hidden alias (yolo -> auto)
 * - Flag passthrough to subcommands
 *
 * Related Files:
 * - src/commands/manifest/cmd-manifest.mts - Command implementation
 * - src/utils/cli/with-subcommands.mjs - Subcommand handling utility
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

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock meowWithSubcommands.
const mockMeowWithSubcommands = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/cli/with-subcommands.mjs', () => ({
  meowWithSubcommands: mockMeowWithSubcommands,
}))

// Mock all subcommands.
vi.mock('../../../../src/commands/manifest/cmd-manifest-auto.mts', () => ({
  cmdManifestAuto: { description: 'Auto-detect', hidden: false },
}))

vi.mock('../../../../src/commands/manifest/cmd-manifest-cdxgen.mts', () => ({
  cmdManifestCdxgen: { description: 'Run cdxgen', hidden: false },
}))

vi.mock('../../../../src/commands/manifest/cmd-manifest-conda.mts', () => ({
  cmdManifestConda: { description: 'Generate conda manifest', hidden: false },
}))

vi.mock('../../../../src/commands/manifest/cmd-manifest-gradle.mts', () => ({
  cmdManifestGradle: { description: 'Generate gradle manifest', hidden: false },
}))

vi.mock('../../../../src/commands/manifest/cmd-manifest-kotlin.mts', () => ({
  cmdManifestKotlin: { description: 'Generate kotlin manifest', hidden: false },
}))

vi.mock('../../../../src/commands/manifest/cmd-manifest-scala.mts', () => ({
  cmdManifestScala: { description: 'Generate scala manifest', hidden: false },
}))

vi.mock('../../../../src/commands/manifest/cmd-manifest-setup.mts', () => ({
  cmdManifestSetup: { description: 'Setup manifest config', hidden: false },
}))

// Import after mocks.
const { cmdManifest } =
  await import('../../../../src/commands/manifest/cmd-manifest.mts')

describe('cmd-manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifest.description).toBe(
        'Generate a dependency manifest for certain ecosystems',
      )
    })

    it('should not be hidden', () => {
      expect(cmdManifest.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest.mts' }
    const context = { parentName: 'socket' }

    it('should call meowWithSubcommands with correct command name', async () => {
      await cmdManifest.run([], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'socket manifest',
          argv: [],
          importMeta,
        }),
        expect.any(Object),
      )
    })

    it('should register all subcommands', async () => {
      await cmdManifest.run([], importMeta, context)

      const callArgs = mockMeowWithSubcommands.mock.calls[0]
      const subcommands = callArgs[0].subcommands

      expect(subcommands).toHaveProperty('auto')
      expect(subcommands).toHaveProperty('cdxgen')
      expect(subcommands).toHaveProperty('conda')
      expect(subcommands).toHaveProperty('gradle')
      expect(subcommands).toHaveProperty('kotlin')
      expect(subcommands).toHaveProperty('scala')
      expect(subcommands).toHaveProperty('setup')
    })

    it('should register yolo as hidden alias for auto', async () => {
      await cmdManifest.run([], importMeta, context)

      const callArgs = mockMeowWithSubcommands.mock.calls[0]
      const aliases = callArgs[1].aliases

      expect(aliases.yolo).toEqual({
        description: 'Generate a dependency manifest for certain ecosystems',
        hidden: true,
        argv: ['auto'],
      })
    })

    it('should pass common flags configuration', async () => {
      await cmdManifest.run(['--dry-run'], importMeta, context)

      const callArgs = mockMeowWithSubcommands.mock.calls[0]
      const config = callArgs[1]

      expect(config.description).toBe(
        'Generate a dependency manifest for certain ecosystems',
      )
      expect(config.flags).toBeDefined()
      expect(config.flags).toHaveProperty('dryRun')
      expect(config.flags).toHaveProperty('help')
    })

    it('should forward arguments to subcommands', async () => {
      await cmdManifest.run(['scala', '.'], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv: ['scala', '.'],
        }),
        expect.any(Object),
      )
    })

    it('should handle flags in argv', async () => {
      await cmdManifest.run(['--dry-run', 'auto'], importMeta, context)

      expect(mockMeowWithSubcommands).toHaveBeenCalledWith(
        expect.objectContaining({
          argv: ['--dry-run', 'auto'],
        }),
        expect.any(Object),
      )
    })
  })
})
