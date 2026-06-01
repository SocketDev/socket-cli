// node --test specs for scripts/fleet/install-claude-plugins.mts.
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
  parsePatchFileName,
  patchSidecarDir,
  stripPatchHeader,
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
  assert.strictEqual(got, '9cb4fe409919')
})

test('extractInstalledSha handles content-hash of various lengths', () => {
  const got = extractInstalledSha('/x/cache/m/p/abcdef012345-fedcba98')
  assert.strictEqual(got, 'abcdef012345')
})

test('extractInstalledSha returns undefined for directory-source install (version-tagged)', () => {
  const got = extractInstalledSha('/Users/x/projects/codex-plugin-cc')
  assert.strictEqual(got, undefined)
})

test('extractInstalledSha returns undefined for version-tagged install', () => {
  const got = extractInstalledSha(
    '/Users/x/.claude/plugins/cache/openai-codex/codex/1.0.1',
  )
  assert.strictEqual(got, undefined)
})

test('extractInstalledSha returns undefined for undefined input', () => {
  assert.strictEqual(extractInstalledSha(undefined), undefined)
})

test('extractInstalledSha returns undefined for empty string', () => {
  assert.strictEqual(extractInstalledSha(''), undefined)
})

test('extractInstalledSha rejects shapes that almost-match but are not 12 + 8+', () => {
  // 11 chars instead of 12.
  assert.strictEqual(
    extractInstalledSha('/x/cache/m/p/9cb4fe40991-deadbeef'),
    undefined,
  )
  // No content-hash suffix.
  assert.strictEqual(
    extractInstalledSha('/x/cache/m/p/9cb4fe409919'),
    undefined,
  )
  // Non-hex chars.
  assert.strictEqual(
    extractInstalledSha('/x/cache/m/p/zzzzzzzzzzzz-deadbeef'),
    undefined,
  )
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
  assert.strictEqual(got.id, 'codex@openai-codex')
})

test('findForeignInstall returns undefined when plugin is under our marketplace', () => {
  const plugins = [
    fakePlugin(
      'codex@socket-wheelhouse',
      '/x/cache/socket-wheelhouse/codex/9cb4fe409919-aa',
    ),
  ]
  const got = findForeignInstall('codex', plugins, OUR)
  assert.strictEqual(got, undefined)
})

test('findForeignInstall returns undefined when plugin is not installed at all', () => {
  const plugins = [fakePlugin('clangd-lsp@claude-plugins-official')]
  const got = findForeignInstall('codex', plugins, OUR)
  assert.strictEqual(got, undefined)
})

test('findForeignInstall ignores other plugins with similar prefixes', () => {
  // "codex-helper" should not match "codex" — we match on the exact
  // name before the @ separator.
  const plugins = [fakePlugin('codex-helper@some-mkt')]
  const got = findForeignInstall('codex', plugins, OUR)
  assert.strictEqual(got, undefined)
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
  assert.deepStrictEqual(got, ['openai-codex'])
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
  assert.deepStrictEqual(got, [])
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
  assert.deepStrictEqual(got, [])
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
  assert.deepStrictEqual(got, [])
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
  assert.strictEqual(
    lookupInstalledSha(state, 'codex@socket-wheelhouse'),
    FULL_SHA,
  )
})

test('lookupInstalledSha returns undefined when plugin id is absent', () => {
  const state = { version: 2, plugins: {} }
  assert.strictEqual(
    lookupInstalledSha(state, 'codex@socket-wheelhouse'),
    undefined,
  )
})

test('lookupInstalledSha returns undefined when entry has no gitCommitSha', () => {
  const state = {
    version: 2,
    plugins: {
      'codex@socket-wheelhouse': [
        { scope: 'user', installPath: '/x/y/z', version: '1.0.1' },
      ],
    },
  }
  assert.strictEqual(
    lookupInstalledSha(state, 'codex@socket-wheelhouse'),
    undefined,
  )
})

test('lookupInstalledSha rejects malformed gitCommitSha values', () => {
  const state = {
    version: 2,
    plugins: {
      'codex@socket-wheelhouse': [{ gitCommitSha: 'not-a-sha' }],
    },
  }
  assert.strictEqual(
    lookupInstalledSha(state, 'codex@socket-wheelhouse'),
    undefined,
  )
})

test('lookupInstalledSha handles null / non-object input', () => {
  assert.strictEqual(
    lookupInstalledSha(undefined, 'codex@socket-wheelhouse'),
    undefined,
  )
  assert.strictEqual(
    lookupInstalledSha('not-an-object', 'codex@socket-wheelhouse'),
    undefined,
  )
  assert.strictEqual(
    lookupInstalledSha({}, 'codex@socket-wheelhouse'),
    undefined,
  )
  assert.strictEqual(
    lookupInstalledSha({ plugins: undefined }, 'codex@socket-wheelhouse'),
    undefined,
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
  assert.strictEqual(
    lookupInstalledSha(state, 'codex@socket-wheelhouse'),
    FULL_SHA,
  )
})

test('parsePatchFileName parses <plugin>-<version>-<slug>.patch', () => {
  assert.deepStrictEqual(parsePatchFileName('codex-1.0.1-stdin-eagain.patch'), {
    plugin: 'codex',
    version: '1.0.1',
  })
})

test('parsePatchFileName keeps a hyphenated plugin name (version anchor disambiguates)', () => {
  // The greedy plugin capture stops at the dotted-semver anchor, so a
  // hyphenated plugin name survives.
  assert.deepStrictEqual(
    parsePatchFileName('socket-foo-2.3.4-fix-crash.patch'),
    {
      plugin: 'socket-foo',
      version: '2.3.4',
    },
  )
})

test('parsePatchFileName returns undefined without a dotted-semver version', () => {
  assert.strictEqual(parsePatchFileName('codex-latest-fix.patch'), undefined)
  assert.strictEqual(parsePatchFileName('codex-1.0-fix.patch'), undefined)
})

test('parsePatchFileName returns undefined without a slug after the version', () => {
  assert.strictEqual(parsePatchFileName('codex-1.0.1.patch'), undefined)
})

test('parsePatchFileName returns undefined for a non-.patch file', () => {
  assert.strictEqual(parsePatchFileName('codex-1.0.1-fix.diff'), undefined)
  assert.strictEqual(parsePatchFileName('README.md'), undefined)
})

test('parsePatchFileName rejects uppercase (file naming is lowercase-kebab)', () => {
  assert.strictEqual(parsePatchFileName('Codex-1.0.1-Fix.patch'), undefined)
})

test('stripPatchHeader drops the # provenance header, keeps the diff body', () => {
  const patch = [
    '# @plugin: codex',
    '# @description: fix something',
    '#',
    '--- a/scripts/lib/fs.mjs',
    '+++ b/scripts/lib/fs.mjs',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
    '',
  ].join('\n')
  const body = stripPatchHeader(patch)
  assert.ok(body.startsWith('--- a/scripts/lib/fs.mjs'))
  assert.ok(!body.includes('@plugin'))
})

test('stripPatchHeader returns the whole body when there is no header', () => {
  const body = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n'
  assert.strictEqual(stripPatchHeader(body), body)
})

test('stripPatchHeader returns empty string when no diff body is present', () => {
  assert.strictEqual(
    stripPatchHeader('# @plugin: codex\n# just a comment\n'),
    '',
  )
})

test('stripPatchHeader only matches --- at line start (not mid-line)', () => {
  // A `---` inside a comment line must not be mistaken for the diff start.
  const patch =
    '# note: see --- somewhere\n--- a/real\n+++ b/real\n@@ -1 +1 @@\n-x\n+y\n'
  const body = stripPatchHeader(patch)
  assert.ok(body.startsWith('--- a/real'))
})

test('patchSidecarDir maps <x>.patch → <x>.files', () => {
  assert.strictEqual(
    patchSidecarDir('/a/b/codex-1.0.1-stdin-eagain.patch'),
    '/a/b/codex-1.0.1-stdin-eagain.files',
  )
})

test('patchSidecarDir only rewrites a trailing .patch extension', () => {
  // A `.patch` mid-path must not be rewritten — only the final extension.
  assert.strictEqual(
    patchSidecarDir('/a/.patch-stuff/codex-1.0.1-x.patch'),
    '/a/.patch-stuff/codex-1.0.1-x.files',
  )
})
