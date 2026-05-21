/**
 * Unit tests for buildHelpLines (with-subcommands-help.mts).
 *
 * Covers the bucketed root-help layout, sub-command flat-list path, and the
 * --help-full environment-variable expansion.
 *
 * The bucket layout is driven by the `buckets` option (a map from subcommand
 * name → CliBucket). Adding a command to a bucket = one map entry; no parallel
 * hand-maintained list to drift.
 */

import { describe, expect, it, vi } from 'vitest'

import { buildHelpLines } from '../../../../src/util/cli/with-subcommands-help.mts'

import type {
  CliBuckets,
  CliSubcommand,
} from '../../../../src/util/cli/with-subcommands-shared.mts'
import type { MeowFlags } from '../../../../src/flags.mts'

vi.mock('@socketsecurity/lib-stable/logger', () => ({
  getDefaultLogger: () => ({
    fail: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  }),
}))

export function makeSubcommand(
  description: string,
  hidden = false,
): CliSubcommand {
  return {
    description,
    hidden,
    run: async () => {},
  }
}

const FLAGS: MeowFlags = {
  banner: { type: 'boolean', default: true, description: 'Banner' } as unknown,
  spinner: {
    type: 'boolean',
    default: true,
    description: 'Spinner',
  } as unknown,
  json: { type: 'boolean', description: 'JSON output' } as unknown,
  markdown: { type: 'boolean', description: 'Markdown output' } as unknown,
}

/**
 * A representative subcommand registry covering all bucket categories, used by
 * most root-help tests.
 */
export function rootSubcommands(): Record<string, CliSubcommand> {
  const names = [
    // main bucket.
    'fix',
    'optimize',
    'cdxgen',
    'ci',
    'login',
    // api bucket.
    'analytics',
    'audit-log',
    'organization',
    'package',
    'repository',
    'scan',
    'threat-feed',
    // tools bucket.
    'manifest',
    'npm',
    'npx',
    'pycli',
    'raw-npm',
    'raw-npx',
    'sfw',
    // config bucket.
    'config',
    'install',
    'logout',
    'uninstall',
    'whoami',
    'wrapper',
    // unbucketed (registered + reachable but not surfaced in
    // top-level help).
    'ask',
    'bundler',
    'mcp',
  ]
  const subs: Record<string, CliSubcommand> = {}
  for (let i = 0, { length } = names; i < length; i += 1) {
    const n = names[i]
    subs[n] = makeSubcommand(`${n} description`)
  }
  return subs
}

/**
 * Bucket assignments mirroring `rootCommandBuckets` in src/commands.mts. Tests
 * pass this through `buildHelpLines`.
 */
const ROOT_BUCKETS: CliBuckets = {
  // main.
  fix: 'main',
  optimize: 'main',
  cdxgen: 'main',
  ci: 'main',
  login: 'main',
  // api.
  analytics: 'api',
  'audit-log': 'api',
  organization: 'api',
  package: 'api',
  repository: 'api',
  scan: 'api',
  'threat-feed': 'api',
  // tools.
  manifest: 'tools',
  npm: 'tools',
  npx: 'tools',
  pycli: 'tools',
  'raw-npm': 'tools',
  'raw-npx': 'tools',
  sfw: 'tools',
  // config.
  config: 'config',
  install: 'config',
  logout: 'config',
  uninstall: 'config',
  whoami: 'config',
  wrapper: 'config',
}

describe('buildHelpLines', () => {
  describe('root-command bucketed layout', () => {
    it('emits Usage / Main commands / Socket API / Local tools / CLI configuration buckets', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        buckets: ROOT_BUCKETS,
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

    it('places each bucketed command under its assigned section', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        buckets: ROOT_BUCKETS,
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: rootSubcommands(),
      })
      const blob = lines.join('\n')

      // Main commands bucket.
      const mainStart = blob.indexOf('Main commands')
      const apiStart = blob.indexOf('Socket API')
      expect(mainStart).toBeGreaterThan(-1)
      expect(apiStart).toBeGreaterThan(mainStart)

      // 'optimize' is in main; should appear between mainStart and apiStart.
      const optimizeIdx = blob.indexOf('optimize')
      expect(optimizeIdx).toBeGreaterThan(mainStart)
      expect(optimizeIdx).toBeLessThan(apiStart)

      // 'analytics' is in api; should appear after apiStart.
      const analyticsIdx = blob.indexOf('analytics')
      expect(analyticsIdx).toBeGreaterThan(apiStart)
    })

    it('omits unbucketed commands from the top-level layout', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        buckets: ROOT_BUCKETS,
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: rootSubcommands(),
      })
      const blob = lines.join('\n')
      // 'mcp' is registered but unbucketed — should not appear in
      // any of the four bucket sections. (The Options block / env
      // section don't render command names.)
      expect(blob).not.toContain('mcp description')
    })

    it('skips bucket entries whose subcommand is not registered (line 212)', () => {
      // A bucket entry that has no matching subcommand should be silently
      // skipped — defensive guard for stale buckets vs. removed commands.
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        buckets: { fix: 'main', 'ghost-command': 'main' } as unknown,
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: { fix: makeSubcommand('fix description') } as unknown,
      })
      const blob = lines.join('\n')
      expect(blob).toContain('fix')
      expect(blob).not.toContain('ghost-command')
    })

    it('emits hero rows in the Main commands bucket', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        buckets: ROOT_BUCKETS,
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: rootSubcommands(),
      })
      const blob = lines.join('\n')
      // The static hero rows that aren't standalone commands.
      expect(blob).toContain('socket scan create')
      expect(blob).toContain('socket npm/lodash@4.17.21')
    })

    it('renders bucket sections in the canonical order: main, api, tools, config', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        buckets: ROOT_BUCKETS,
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: rootSubcommands(),
      })
      const blob = lines.join('\n')
      const idxMain = blob.indexOf('Main commands')
      const idxApi = blob.indexOf('Socket API')
      const idxTools = blob.indexOf('Local tools')
      const idxConfig = blob.indexOf('CLI configuration')
      expect(idxMain).toBeGreaterThan(-1)
      expect(idxApi).toBeGreaterThan(idxMain)
      expect(idxTools).toBeGreaterThan(idxApi)
      expect(idxConfig).toBeGreaterThan(idxTools)
    })

    it('skips empty buckets', () => {
      // Subcommands that only fill api + config; main and tools have
      // no entries (and main has hero rows so it still renders).
      const apiOnlySubs: Record<string, CliSubcommand> = {
        analytics: makeSubcommand('analytics description'),
        config: makeSubcommand('config description'),
      }
      const apiOnlyBuckets: CliBuckets = {
        analytics: 'api',
        config: 'config',
      }
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        buckets: apiOnlyBuckets,
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: apiOnlySubs,
      })
      const blob = lines.join('\n')
      // main has hero rows so it always renders even when empty.
      expect(blob).toContain('Main commands')
      expect(blob).toContain('Socket API')
      expect(blob).toContain('CLI configuration')
      // Local tools has no entries AND no hero rows → suppressed.
      expect(blob).not.toContain('Local tools')
    })

    it('skips hidden subcommands during bucket grouping', () => {
      const subs = rootSubcommands()
      // Mark analytics hidden — should be excluded from api section.
      subs['analytics'] = makeSubcommand('analytics description', true)
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        buckets: ROOT_BUCKETS,
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: subs,
      })
      const blob = lines.join('\n')
      // Hidden command should not surface.
      expect(blob).not.toContain('analytics description')
      // Other commands in the same bucket should still render.
      expect(blob).toContain('Socket API')
      expect(blob).toContain('audit-log')
    })

    it('falls back to a buckets-less render when no buckets are passed', () => {
      // Backwards-compat for downstream callers that don't yet pass
      // a buckets map: the root layout still renders the static hero
      // rows (Main commands has hero rows that don't depend on bucket
      // assignments).
      const lines = buildHelpLines({
        aliases: {},
        argv: [],
        flags: FLAGS,
        isRootCommand: true,
        name: 'socket',
        subcommands: rootSubcommands(),
      })
      const blob = lines.join('\n')
      // Hero rows still render.
      expect(blob).toContain('Main commands')
      expect(blob).toContain('socket scan create')
      // No api / tools / config sections (no bucket assignments).
      expect(blob).not.toContain('Socket API')
      expect(blob).not.toContain('Local tools')
      expect(blob).not.toContain('CLI configuration')
    })
  })

  describe('--help-full', () => {
    it('shows condensed env-var hint when --help-full is absent', () => {
      const lines = buildHelpLines({
        aliases: {},
        argv: ['--help'],
        buckets: ROOT_BUCKETS,
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
        buckets: ROOT_BUCKETS,
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
        buckets: ROOT_BUCKETS,
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
