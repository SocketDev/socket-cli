// node --test specs for scripts/install-claude-plugins.mts.
//
// We test the pure helpers (extractInstalledSha, findForeignInstall,
// findOrphanMarketplaces). The Claude CLI shell-outs are integration
// surface — they mutate ~/.claude/ and aren't covered here. The pure
// helpers carry the actual reconciliation logic; if they're correct,
// the orchestration in reconcilePlugin / main is straightforward to
// audit by reading.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractInstalledSha,
  findForeignInstall,
  findOrphanMarketplaces,
  lookupInstalledSha,
} from '../install-claude-plugins.mts'
import type {
  MarketplaceListEntry,
  PluginListEntry,
} from '../install-claude-plugins.mts'

const OUR = 'socket-wheelhouse'

test('extractInstalledSha returns 12-char prefix for SHA-pinned cache path', () => {
  const got = extractInstalledSha(
    '/Users/x/.claude/plugins/cache/socket-wheelhouse/codex/9cb4fe409919-deadbeef',
  )
  assert.equal(got, '9cb4fe409919')
})

test('extractInstalledSha handles content-hash of various lengths', () => {
  const got = extractInstalledSha('/x/cache/m/p/abcdef012345-fedcba98')
  assert.equal(got, 'abcdef012345')
})

test('extractInstalledSha returns null for directory-source install (version-tagged)', () => {
  const got = extractInstalledSha('/Users/x/projects/codex-plugin-cc')
  assert.equal(got, null)
})

test('extractInstalledSha returns null for version-tagged install', () => {
  const got = extractInstalledSha(
    '/Users/x/.claude/plugins/cache/openai-codex/codex/1.0.1',
  )
  assert.equal(got, null)
})

test('extractInstalledSha returns null for undefined input', () => {
  assert.equal(extractInstalledSha(undefined), null)
})

test('extractInstalledSha returns null for empty string', () => {
  assert.equal(extractInstalledSha(''), null)
})

test('extractInstalledSha rejects shapes that almost-match but are not 12 + 8+', () => {
  // 11 chars instead of 12.
  assert.equal(extractInstalledSha('/x/cache/m/p/9cb4fe40991-deadbeef'), null)
  // No content-hash suffix.
  assert.equal(extractInstalledSha('/x/cache/m/p/9cb4fe409919'), null)
  // Non-hex chars.
  assert.equal(extractInstalledSha('/x/cache/m/p/zzzzzzzzzzzz-deadbeef'), null)
})

const fakePlugin = (id: string, installPath?: string): PluginListEntry => ({
  id,
  scope: 'user',
  enabled: true,
  ...(installPath !== undefined ? { installPath } : {}),
})

test('findForeignInstall finds plugin under non-canonical marketplace', () => {
  const plugins = [
    fakePlugin('codex@openai-codex', '/Users/x/projects/codex-plugin-cc'),
    fakePlugin('clangd-lsp@claude-plugins-official'),
  ]
  const got = findForeignInstall('codex', plugins, OUR)
  assert.ok(got)
  assert.equal(got.id, 'codex@openai-codex')
})

test('findForeignInstall returns undefined when plugin is under our marketplace', () => {
  const plugins = [
    fakePlugin(
      'codex@socket-wheelhouse',
      '/x/cache/socket-wheelhouse/codex/9cb4fe409919-aa',
    ),
  ]
  const got = findForeignInstall('codex', plugins, OUR)
  assert.equal(got, undefined)
})

test('findForeignInstall returns undefined when plugin is not installed at all', () => {
  const plugins = [fakePlugin('clangd-lsp@claude-plugins-official')]
  const got = findForeignInstall('codex', plugins, OUR)
  assert.equal(got, undefined)
})

test('findForeignInstall ignores other plugins with similar prefixes', () => {
  // "codex-helper" should not match "codex" — we match on the exact
  // name before the @ separator.
  const plugins = [fakePlugin('codex-helper@some-mkt')]
  const got = findForeignInstall('codex', plugins, OUR)
  assert.equal(got, undefined)
})

test('findOrphanMarketplaces flags marketplace serving only-our plugins', () => {
  const marketplaces: MarketplaceListEntry[] = [
    { name: OUR, source: 'github' },
    { name: 'openai-codex', source: 'directory' },
  ]
  const plugins = [
    fakePlugin('codex@openai-codex'),
    fakePlugin('codex@socket-wheelhouse'),
  ]
  const got = findOrphanMarketplaces(
    marketplaces,
    OUR,
    new Set(['codex']),
    plugins,
  )
  assert.deepEqual(got, ['openai-codex'])
})

test('findOrphanMarketplaces does NOT flag empty marketplace (no installs from it)', () => {
  // User added a marketplace but installed nothing from it. Leave alone.
  const marketplaces: MarketplaceListEntry[] = [
    { name: OUR, source: 'github' },
    { name: 'experimental', source: 'directory' },
  ]
  const plugins = [fakePlugin('codex@socket-wheelhouse')]
  const got = findOrphanMarketplaces(
    marketplaces,
    OUR,
    new Set(['codex']),
    plugins,
  )
  assert.deepEqual(got, [])
})

test('findOrphanMarketplaces does NOT flag marketplace serving non-overlapping plugins', () => {
  // openai-codex serves codex (ours) AND some-other-plugin (NOT ours).
  // We shouldn't suggest removing it — user might want some-other-plugin.
  const marketplaces: MarketplaceListEntry[] = [
    { name: OUR, source: 'github' },
    { name: 'openai-codex', source: 'directory' },
  ]
  const plugins = [
    fakePlugin('codex@openai-codex'),
    fakePlugin('some-other-plugin@openai-codex'),
  ]
  const got = findOrphanMarketplaces(
    marketplaces,
    OUR,
    new Set(['codex']),
    plugins,
  )
  assert.deepEqual(got, [])
})

test('findOrphanMarketplaces never flags our own marketplace', () => {
  const marketplaces: MarketplaceListEntry[] = [{ name: OUR, source: 'github' }]
  const plugins = [fakePlugin('codex@socket-wheelhouse')]
  const got = findOrphanMarketplaces(
    marketplaces,
    OUR,
    new Set(['codex']),
    plugins,
  )
  assert.deepEqual(got, [])
})

const FULL_SHA = '9cb4fe4099195b2587c402117a3efce6ab5aac78'

test('lookupInstalledSha extracts gitCommitSha from installed_plugins.json shape', () => {
  const state = {
    version: 2,
    plugins: {
      'codex@socket-wheelhouse': [
        {
          scope: 'user',
          installPath: '/x/y/z',
          version: '1.0.1',
          gitCommitSha: FULL_SHA,
        },
      ],
    },
  }
  assert.equal(lookupInstalledSha(state, 'codex@socket-wheelhouse'), FULL_SHA)
})

test('lookupInstalledSha returns null when plugin id is absent', () => {
  const state = { version: 2, plugins: {} }
  assert.equal(lookupInstalledSha(state, 'codex@socket-wheelhouse'), null)
})

test('lookupInstalledSha returns null when entry has no gitCommitSha', () => {
  const state = {
    version: 2,
    plugins: {
      'codex@socket-wheelhouse': [
        { scope: 'user', installPath: '/x/y/z', version: '1.0.1' },
      ],
    },
  }
  assert.equal(lookupInstalledSha(state, 'codex@socket-wheelhouse'), null)
})

test('lookupInstalledSha rejects malformed gitCommitSha values', () => {
  const state = {
    version: 2,
    plugins: {
      'codex@socket-wheelhouse': [{ gitCommitSha: 'not-a-sha' }],
    },
  }
  assert.equal(lookupInstalledSha(state, 'codex@socket-wheelhouse'), null)
})

test('lookupInstalledSha handles null / non-object input', () => {
  assert.equal(lookupInstalledSha(null, 'codex@socket-wheelhouse'), null)
  assert.equal(
    lookupInstalledSha('not-an-object', 'codex@socket-wheelhouse'),
    null,
  )
  assert.equal(lookupInstalledSha({}, 'codex@socket-wheelhouse'), null)
  assert.equal(
    lookupInstalledSha({ plugins: null }, 'codex@socket-wheelhouse'),
    null,
  )
})

test('lookupInstalledSha walks multiple scope entries to find a valid SHA', () => {
  // installed_plugins.json arrays can have multiple entries (one per
  // scope). Take the first valid gitCommitSha.
  const state = {
    plugins: {
      'codex@socket-wheelhouse': [
        { scope: 'local' /* no sha */ },
        { scope: 'user', gitCommitSha: FULL_SHA },
      ],
    },
  }
  assert.equal(lookupInstalledSha(state, 'codex@socket-wheelhouse'), FULL_SHA)
})
