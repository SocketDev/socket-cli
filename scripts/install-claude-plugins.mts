#!/usr/bin/env node
/**
 * @file Reconcile the local machine's Claude Code plugin state to the
 *   wheelhouse-canonical SHA-pinned set. What the reconciler does:
 *
 *   1. Ensures the `socket-wheelhouse` marketplace is added to Claude Code
 *      (`~/.claude/plugins/known_marketplaces.json`).
 *   2. For each plugin in the wheelhouse marketplace's
 *      `.claude-plugin/marketplace.json`:
 *
 *   - If installed under a _different_ marketplace (foreign source) — uninstalls
 *     it, then installs ours. Wheelhouse is the pin authority; foreign installs
 *     are silently overriding our pin.
 *   - If installed under our marketplace at the right SHA — no-op.
 *   - If installed under our marketplace at a stale SHA — uninstalls
 *   - reinstalls to bump.
 *   - If not installed at all — installs.
 *
 *   3. Warns (does NOT auto-remove) about marketplaces that exist locally + only
 *      serve plugins we now serve canonically. The user might intentionally
 *      keep a dev-source override; let them remove it explicitly. Idempotent —
 *      running twice in a row is a no-op. Designed for `pnpm setup` wiring in
 *      every fleet repo. Pin discipline is enforced by
 *      `.claude/hooks/marketplace-comment-guard/`: every `plugins[].source.sha`
 *      in `marketplace.json` must have a row in `.claude-plugin/README.md` with
 *      matching version + sha + ISO date.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// Canonical marketplace identity. The repo URL is what `claude plugin
// marketplace add` resolves; the name is what Claude Code records in
// `known_marketplaces.json` and what plugins reference via `@<name>`.
const MARKETPLACE_NAME = 'socket-wheelhouse'
const MARKETPLACE_URL = 'https://github.com/SocketDev/socket-wheelhouse'

// Claude Code stores SHA-pinned plugin installs at a cache directory
// whose name is `<sha-12-chars>-<content-hash-8-chars>`. We parse the
// first segment to extract the pinned SHA for drift comparison.
const SHA_PINNED_DIR_NAME = /^([0-9a-f]{12})-[0-9a-f]{8,}$/

export interface MarketplaceListEntry {
  name: string
  source: string
  installLocation?: string | undefined
}

export interface PluginListEntry {
  id: string
  version?: string | undefined
  scope?: string | undefined
  enabled?: boolean | undefined
  installPath?: string | undefined
}

export interface MarketplacePluginSource {
  source: string
  url?: string | undefined
  path?: string | undefined
  ref?: string | undefined
  sha?: string | undefined
  commit?: string | undefined
}

export interface MarketplacePlugin {
  name: string
  source: MarketplacePluginSource
}

export interface MarketplaceManifest {
  name?: string | undefined
  plugins?: MarketplacePlugin[] | undefined
}

/**
 * Parse the plugin's `installPath` to extract the SHA prefix it was pinned to
 * (12 chars). Returns `null` for directory installs, version-tagged installs,
 * or any path shape we don't recognize as SHA-pinned. Claude Code uses this
 * dir-name shape for ref-less pins; version-tagged pins use a dir name like
 * `1.0.1` instead — see `lookupInstalledSha` for the authoritative source.
 */
export function extractInstalledSha(
  installPath: string | undefined,
): string | undefined {
  if (!installPath) {
    return undefined
  }
  const dirName = path.basename(installPath)
  const m = SHA_PINNED_DIR_NAME.exec(dirName)
  return m ? (m[1] ?? undefined) : undefined
}

/**
 * Look up the installed `gitCommitSha` for a plugin from Claude Code's own
 * state file `~/.claude/plugins/installed_plugins.json`. This is the
 * authoritative record of which commit a plugin was installed from, regardless
 * of whether the cache dir is SHA-prefixed (`9cb4fe40-deadbeef/`) or
 * version-tagged (`1.0.1/`).
 *
 * Returns the full 40-char SHA, or `null` if the file/entry is missing or the
 * `gitCommitSha` field is absent (some plugin sources don't carry it —
 * directory installs, for example).
 */
export function lookupInstalledSha(
  installedPluginsJson: unknown,
  installId: string,
): string | undefined {
  if (!installedPluginsJson || typeof installedPluginsJson !== 'object') {
    return undefined
  }
  const plugins = (installedPluginsJson as { plugins?: unknown | undefined })
    .plugins
  if (!plugins || typeof plugins !== 'object') {
    return undefined
  }
  const entries = (plugins as Record<string, unknown>)[installId]
  if (!Array.isArray(entries)) {
    return undefined
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const sha = (entry as { gitCommitSha?: unknown | undefined }).gitCommitSha
    if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) {
      return sha
    }
  }
  return undefined
}

/**
 * Find an existing install of `pluginName` that came from a marketplace _other
 * than_ ours. Plugin ids have the shape `<name>@<marketplace>`. Returns the
 * foreign install entry, or `undefined` if none.
 */
export function findForeignInstall(
  pluginName: string,
  plugins: PluginListEntry[],
  ourMarketplace: string,
): PluginListEntry | undefined {
  const ourId = `${pluginName}@${ourMarketplace}`
  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const p = plugins[i]!
    if (!p.id.startsWith(`${pluginName}@`)) {
      continue
    }
    if (p.id === ourId) {
      continue
    }
    return p
  }
  return undefined
}

/**
 * Identify marketplaces that look orphaned — exist locally, aren't ours, and
 * only serve plugins our marketplace now serves canonically. Returns the
 * marketplace names; we warn the user rather than auto-remove (a dev-source
 * override is a legitimate deliberate state).
 */
export function findOrphanMarketplaces(
  marketplaces: MarketplaceListEntry[],
  ourMarketplace: string,
  ourPluginNames: Set<string>,
  plugins: PluginListEntry[],
): string[] {
  const orphans: string[] = []
  for (let i = 0, { length } = marketplaces; i < length; i += 1) {
    const mkt = marketplaces[i]!
    if (mkt.name === ourMarketplace) {
      continue
    }
    // Find every plugin installed from this marketplace.
    const installedFromHere = plugins
      .filter(p => p.id.endsWith(`@${mkt.name}`))
      .map(p => p.id.slice(0, -`@${mkt.name}`.length))
    if (installedFromHere.length === 0) {
      // No installs from this marketplace — leave it alone. The user
      // added it for a reason we can't see.
      continue
    }
    if (installedFromHere.every(name => ourPluginNames.has(name))) {
      orphans.push(mkt.name)
    }
  }
  return orphans
}

/**
 * Run `claude` CLI synchronously; return stdout + exit code. Stderr goes
 * through to our own stderr so the user sees CLI errors in real time. Fails
 * loudly on non-zero exit codes — the install flow has no graceful fallback if
 * the CLI itself is broken.
 */
function runClaudeCli(args: string[]): string {
  const result = spawnSync('claude', args, {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.error) {
    throw new Error(
      `failed to spawn claude CLI: ${errorMessage(result.error)}. ` +
        'Is the Claude Code CLI installed and on PATH?',
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `claude ${args.join(' ')} exited with status ${result.status}`,
    )
  }
  return String(result.stdout)
}

function listMarketplaces(): MarketplaceListEntry[] {
  const stdout = runClaudeCli(['plugin', 'marketplace', 'list', '--json'])
  try {
    return JSON.parse(stdout) as MarketplaceListEntry[]
  } catch {
    return []
  }
}

function listPlugins(): PluginListEntry[] {
  const stdout = runClaudeCli(['plugin', 'list', '--json'])
  try {
    return JSON.parse(stdout) as PluginListEntry[]
  } catch {
    return []
  }
}

function ensureMarketplace(): MarketplaceListEntry {
  const existing = listMarketplaces().find(m => m.name === MARKETPLACE_NAME)
  if (existing) {
    // Marketplace already added — but the local snapshot may be stale
    // relative to upstream. Pull a fresh copy so we read today's pinned
    // set, not whatever was committed when this machine first added the
    // marketplace. Cheap (Claude Code downloads a tarball snapshot, no
    // git clone) and idempotent.
    logger.log(
      `Marketplace "${MARKETPLACE_NAME}" already added; refreshing snapshot…`,
    )
    runClaudeCli(['plugin', 'marketplace', 'update', MARKETPLACE_NAME])
    return existing
  }
  logger.log(
    `Adding marketplace "${MARKETPLACE_NAME}" from ${MARKETPLACE_URL}…`,
  )
  runClaudeCli([
    'plugin',
    'marketplace',
    'add',
    MARKETPLACE_URL,
    '--scope',
    'user',
  ])
  const added = listMarketplaces().find(m => m.name === MARKETPLACE_NAME)
  if (!added) {
    throw new Error(
      `marketplace "${MARKETPLACE_NAME}" did not appear in plugin ` +
        'marketplace list after add — check the CLI output above.',
    )
  }
  return added
}

/**
 * Load `~/.claude/plugins/installed_plugins.json` — Claude Code's authoritative
 * state file for which commit each installed plugin came from. Returns `null`
 * if the file is absent or unparseable; the reconciler falls back to
 * path-prefix parsing in that case.
 */
function loadInstalledPluginsState(): unknown {
  const home = process.env['HOME'] ?? process.env['USERPROFILE']
  if (!home || !path.isAbsolute(home)) {
    return undefined
  }
  const stateFile = path.join(
    home,
    '.claude',
    'plugins',
    'installed_plugins.json',
  )
  if (!existsSync(stateFile)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    return undefined
  }
}

function loadMarketplaceManifest(
  marketplace: MarketplaceListEntry,
): MarketplaceManifest {
  if (!marketplace.installLocation) {
    throw new Error(
      `marketplace "${marketplace.name}" has no installLocation; ` +
        'cannot read its marketplace.json.',
    )
  }
  const manifestPath = path.join(
    marketplace.installLocation,
    '.claude-plugin',
    'marketplace.json',
  )
  if (!existsSync(manifestPath)) {
    throw new Error(
      `marketplace.json not found at ${manifestPath} ` +
        '— the marketplace install may be stale; try ' +
        `\`claude plugin marketplace update ${marketplace.name}\`.`,
    )
  }
  const raw = readFileSync(manifestPath, 'utf8')
  return JSON.parse(raw) as MarketplaceManifest
}

function uninstallPlugin(installId: string): void {
  logger.log(`Uninstalling ${installId}…`)
  runClaudeCli(['plugin', 'uninstall', installId, '--scope', 'user'])
}

function installPlugin(installId: string, pinDescription: string): void {
  logger.log(`Installing ${installId} pinned to ${pinDescription}…`)
  runClaudeCli(['plugin', 'install', installId, '--scope', 'user'])
}

/**
 * Resolve the installed SHA for a plugin. Prefer the authoritative
 * `gitCommitSha` field from `~/.claude/plugins/installed_plugins.json`; fall
 * back to parsing the cache dir name for ref-less SHA-prefix installs. Returns
 * the full 40-char SHA (or 12-char prefix from the fallback path), or `null` if
 * neither source resolves.
 */
function resolveInstalledSha(
  ours: PluginListEntry,
  state: unknown,
): string | undefined {
  const fromState = lookupInstalledSha(state, ours.id)
  if (fromState) {
    return fromState
  }
  return extractInstalledSha(ours.installPath)
}

/**
 * Reconcile a single plugin to the wheelhouse pin. Handles four cases: foreign
 * install (uninstall + install), missing (install), stale SHA (uninstall +
 * reinstall), and correct (no-op).
 */
function reconcilePlugin(plugin: MarketplacePlugin): void {
  const ourInstallId = `${plugin.name}@${MARKETPLACE_NAME}`
  const expectedSha = plugin.source.sha ?? undefined
  const pinDescription = plugin.source.sha ?? plugin.source.ref ?? '<no ref>'

  let plugins = listPlugins()

  // (1) Foreign install: same plugin name, different marketplace. Wheelhouse
  // is the pin authority; uninstall the foreign install so our pin can
  // take effect. The user's enabledPlugins entry under the foreign id
  // disappears as a side effect of the CLI uninstall.
  const foreign = findForeignInstall(plugin.name, plugins, MARKETPLACE_NAME)
  if (foreign) {
    logger.log(
      `Found foreign install ${foreign.id} (path: ${foreign.installPath ?? '<unknown>'}); rewiring to ${ourInstallId}.`,
    )
    uninstallPlugin(foreign.id)
    plugins = listPlugins()
  }

  // (2) Our install present? Check SHA against installed_plugins.json's
  // gitCommitSha field (authoritative) with cache-dir-name parsing as
  // fallback. Both SHA forms can compare: the authoritative one is full
  // 40-char, the fallback is 12-char prefix, so compare on a shared
  // 12-char prefix.
  const ours = plugins.find(p => p.id === ourInstallId)
  if (ours) {
    if (!expectedSha) {
      // Manifest pin has no SHA — we can't drift-compare. Trust the
      // existing install.
      logger.log(
        `Plugin ${ourInstallId} already installed (manifest has no SHA to compare).`,
      )
      return
    }
    const state = loadInstalledPluginsState()
    const installedSha = resolveInstalledSha(ours, state)
    const expectedPrefix = expectedSha.slice(0, 12)
    const installedPrefix = installedSha?.slice(0, 12) ?? undefined
    if (installedPrefix === expectedPrefix) {
      logger.log(
        `Plugin ${ourInstallId} already installed at pinned SHA ${expectedPrefix}.`,
      )
      return
    }
    // Drift: our install is at a different SHA. Reinstall.
    logger.log(
      `Plugin ${ourInstallId} drift: installed at ${installedPrefix ?? '<unknown>'}, manifest pins ${expectedPrefix}. Reinstalling.`,
    )
    uninstallPlugin(ourInstallId)
    installPlugin(ourInstallId, pinDescription)
    return
  }

  // (3) Not installed at all (or we just uninstalled a foreign copy).
  installPlugin(ourInstallId, pinDescription)
  const after = listPlugins().find(p => p.id === ourInstallId)
  if (!after) {
    throw new Error(
      `plugin ${ourInstallId} did not appear in plugin list after install ` +
        '— check the CLI output above.',
    )
  }
}

function warnOrphanMarketplaces(
  marketplaces: MarketplaceListEntry[],
  ourPluginNames: Set<string>,
  plugins: PluginListEntry[],
): void {
  const orphans = findOrphanMarketplaces(
    marketplaces,
    MARKETPLACE_NAME,
    ourPluginNames,
    plugins,
  )
  for (let i = 0, { length } = orphans; i < length; i += 1) {
    const name = orphans[i]!
    logger.warn(
      `Marketplace "${name}" appears to only serve plugins we now pin via ` +
        `"${MARKETPLACE_NAME}". Consider \`claude plugin marketplace remove ${name}\` ` +
        `to keep your config tidy. (Not auto-removed — a deliberate dev-source ` +
        `override is a legitimate state we won't silently undo.)`,
    )
  }
}

function main(): void {
  logger.log(`Reconciling Claude Code plugins to ${MARKETPLACE_NAME}…`)
  const marketplace = ensureMarketplace()
  const manifest = loadMarketplaceManifest(marketplace)
  const plugins = manifest.plugins ?? []
  if (plugins.length === 0) {
    logger.log(
      `marketplace "${MARKETPLACE_NAME}" has no plugins listed — nothing to install.`,
    )
  }
  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const plugin = plugins[i]!
    reconcilePlugin(plugin)
  }

  // Post-pass: warn about marketplaces that now look redundant.
  const ourPluginNames = new Set(plugins.map(p => p.name))
  warnOrphanMarketplaces(listMarketplaces(), ourPluginNames, listPlugins())

  logger.log('Done.')
}

// Skip execution when imported (for tests). The CLI entry is direct
// `node scripts/install-claude-plugins.mts` invocation.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch (e) {
    logger.fail(errorMessage(e))
    process.exit(1)
  }
}
