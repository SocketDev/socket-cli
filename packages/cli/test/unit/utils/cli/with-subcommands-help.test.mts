/**
 * Unit tests for buildHelpLines (with-subcommands-help.mts).
 *
 * Covers the bucketed root-help layout, sub-command flat-list path,
 * and the --help-full environment-variable expansion.
 */

import { describe, expect, it, vi } from 'vitest'

import { buildHelpLines } from '../../../../src/utils/cli/with-subcommands-help.mts'

import type { CliSubcommand } from '../../../../src/utils/cli/with-subcommands-shared.mts'
import type { MeowFlags } from '../../../../src/flags.mts'

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => ({
    fail: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  }),
}))

function makeSubcommand(description: string, hidden = false): CliSubcommand {
  return {
    description,
    hidden,
    run: async () => {},
  }
}

const FLAGS: MeowFlags = {
  banner: { type: 'boolean', default: true, description: 'Banner' } as any,
  spinner: { type: 'boolean', default: true, description: 'Spinner' } as any,
  json: { type: 'boolean', description: 'JSON output' } as any,
  markdown: { type: 'boolean', description: 'Markdown output' } as any,
}

describe('buildHelpLines', () => {
  describe('root-command bucketed layout', () => {
    function rootSubcommands(): Record<string, CliSubcommand> {
      // The exhaustive bucketed set from buildHelpLines.
      const names = [
        'analytics',
        'ask',
        'audit-log',
        'bundler',
        'cargo',
        'cdxgen',
        'ci',
        'config',
        'dependencies',
        'fix',
        'gem',
        'go',
        'install',
        'license',
        'login',
        'logout',
        'manifest',
        'npm',
        'npx',
        'nuget',
        'optimize',
        'organization',
        'package',
        'patch',
        'pip',
        'pycli',
        'raw-npm',
        'raw-npx',
        'repository',
        'scan',
        'sfw',
        'threat-feed',
        'uninstall',
        'uv',
        'whoami',
        'wrapper',
      ]
      const subs: Record<string, CliSubcommand> = {}
      for (const n of names) {
        subs[n] = makeSubcommand(`${n} description`)
      }
      return subs
    }

    it('emits Usage / Main commands / Socket API / Local tools / CLI configuration buckets', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: rootSubcommands(),
      })
      const blob = lines.join('\n')
      expect(blob).toContain('Usage')
      expect(blob).toContain('$ socket <command>')
      expect(blob).toContain('Main commands')
      expect(blob).toContain('Socket API')
      expect(blob).toContain('Local tools')
      expect(blob).toContain('CLI configuration')
    })

    it('shows condensed env-var hint when --help-full is absent', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: ['--help'],
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: rootSubcommands(),
      })
      const blob = lines.join('\n')
      expect(blob).toContain('Environment variables [more')
      expect(blob).toContain('--help-full')
      expect(blob).not.toContain('SOCKET_CLI_API_TOKEN')
    })

    it('expands all env vars when --help-full is present', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: ['--help-full'],
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: rootSubcommands(),
      })
      const blob = lines.join('\n')
      expect(blob).toContain('Environment variables')
      expect(blob).toContain('SOCKET_CLI_API_TOKEN')
      expect(blob).toContain('SOCKET_CLI_CONFIG')
      expect(blob).toContain('GITHUB_API_URL')
      expect(blob).toContain('SOCKET_CLI_GIT_USER_EMAIL')
      expect(blob).toContain('SOCKET_CLI_GIT_USER_NAME')
      expect(blob).toContain('SOCKET_CLI_GITHUB_TOKEN')
      expect(blob).toContain('SOCKET_CLI_NPM_PATH')
      expect(blob).toContain('SOCKET_CLI_ORG_SLUG')
      expect(blob).toContain('SOCKET_CLI_ACCEPT_RISKS')
      expect(blob).toContain('SOCKET_CLI_VIEW_ALL_RISKS')
      expect(blob).toContain('Environment variables for development')
      expect(blob).toContain('SOCKET_CLI_API_BASE_URL')
      expect(blob).toContain('SOCKET_CLI_API_PROXY')
      expect(blob).toContain('SOCKET_CLI_API_TIMEOUT')
      expect(blob).toContain('SOCKET_CLI_DEBUG')
      expect(blob).toContain('DEBUG')
    })

    it('warns about unknown commands not in the bucketed set', () => {
      const subs = rootSubcommands()
      // Add a command not in the canonical Set — should trigger logger.fail.
      subs['unknown-cmd'] = makeSubcommand('a totally new command')
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: subs,
      })
      // The logger.fail is mocked — just verify the function still emits.
      expect(lines.length).toBeGreaterThan(0)
    })

    it('warns when bucketed commands are missing from subcommands map', () => {
      const subs = rootSubcommands()
      // Drop a known-bucketed command — should trigger the "missing"
      // logger.fail path for the leftover Set entries.
      delete subs['scan']
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: subs,
      })
      // logger.fail is mocked. Verify the function still produced lines.
      expect(lines.length).toBeGreaterThan(0)
    })

    it('skips hidden subcommands during bucket reconciliation', () => {
      const subs = rootSubcommands()
      // Mark one as hidden — the filter should exclude it before the Set check.
      subs['analytics'] = makeSubcommand('analytics description', true)
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: subs,
      })
      // The function should run without throwing.
      expect(lines.length).toBeGreaterThan(0)
    })
  })

  describe('sub-command flat layout', () => {
    it('emits a flat alphabetised Commands list', () => {
      const subs: Record<string, CliSubcommand> = {
        create: makeSubcommand('Create a scan'),
        list: makeSubcommand('List scans'),
        del: makeSubcommand('Delete a scan'),
      }
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        flags: FLAGS,
        isRootCommand: false,
        name: 'socket scan',
        subcommands: subs,
      })
      const blob = lines.join('\n')
      expect(blob).toContain('Commands')
      expect(blob).toContain('create')
      expect(blob).toContain('list')
      expect(blob).toContain('del')
      // Should not have root-only buckets.
      expect(blob).not.toContain('Main commands')
      expect(blob).not.toContain('Socket API')
    })

    it('excludes hidden subcommands and aliases pointing at hidden cmds', () => {
      const subs: Record<string, CliSubcommand> = {
        create: makeSubcommand('Create a scan'),
        secret: makeSubcommand('Hidden cmd', true),
      }
      const aliases = {
        c: { description: 'alias for create', argv: ['create'] as const },
        s: { description: 'alias for secret', argv: ['secret'] as const },
        // alias marked hidden directly.
        h: {
          description: 'always hidden',
          argv: ['create'] as const,
          hidden: true,
        },
      }
      const lines = buildHelpLines({
        aliases,
        argv: [],
        flags: FLAGS,
        isRootCommand: false,
        name: 'socket scan',
        subcommands: subs,
      })
      const blob = lines.join('\n')
      expect(blob).toContain('create')
      expect(blob).toContain('alias for create')
      // Hidden subcommand never appears.
      expect(blob).not.toContain('Hidden cmd')
      // Alias pointing at hidden command excluded.
      expect(blob).not.toContain('alias for secret')
      // Alias marked hidden excluded.
      expect(blob).not.toContain('always hidden')
    })

    it('does not emit env-var section for sub-commands', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: ['--help-full'],
        flags: FLAGS,
        isRootCommand: false,
        name: 'socket scan',
        subcommands: {
          create: makeSubcommand('Create a scan'),
        },
      })
      const blob = lines.join('\n')
      expect(blob).not.toContain('Environment variables')
    })
  })

  describe('Options block', () => {
    it('always renders an Options heading', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        flags: FLAGS,
        isRootCommand: false,
        name: 'socket scan',
        subcommands: {
          create: makeSubcommand('Create a scan'),
        },
      })
      expect(lines).toContain('Options')
    })

    it('annotates the root Options heading with always-available note', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: {
          login: makeSubcommand('Log in'),
        },
      })
      const blob = lines.join('\n')
      expect(blob).toContain('Options')
      expect(blob).toContain('All commands have these flags')
    })
  })
})
