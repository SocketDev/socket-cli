#!/usr/bin/env node
/**
 * @file Reconcile the local machine's Claude Code plugin state to the
 *   wheelhouse-canonical SHA-pinned set.
 *
 *   What the reconciler does:
 *
 *   1. Ensures the `socket-wheelhouse` marketplace is added to Claude
 *      Code (`~/.claude/plugins/known_marketplaces.json`).
 *   2. For each plugin in the wheelhouse marketplace's
 *      `.claude-plugin/marketplace.json`:
 *      - If installed under a *different* marketplace (foreign source) —
 *        uninstalls it, then installs ours. Wheelhouse is the pin
 *        authority; foreign installs are silently overriding our pin.
 *      - If installed under our marketplace at the right SHA — no-op.
 *      - If installed under our marketplace at a stale SHA — uninstalls
 *        + reinstalls to bump.
 *      - If not installed at all — installs.
 *   3. Warns (does NOT auto-remove) about marketplaces that exist
 *      locally + only serve plugins we now serve canonically. The
 *      user might intentionally keep a dev-source override; let them
 *      remove it explicitly.
 *
 *   Idempotent — running twice in a row is a no-op. Designed for
 *   `pnpm setup` wiring in every fleet repo.
 *
 *   Pin discipline is enforced by `.claude/hooks/marketplace-comment-guard/`:
 *   every `plugins[].source.sha` in `marketplace.json` must have a row
 *   in `.claude-plugin/README.md` with matching version + sha + ISO
 *   date.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

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
  installLocation?: string
}

export interface PluginListEntry {
  id: string
  version?: string
  scope?: string
  enabled?: boolean
  installPath?: string
}

export interface MarketplacePluginSource {
  source: string
  url?: string
  path?: string
  ref?: string
  sha?: string
  commit?: string
}

export interface MarketplacePlugin {
  name: string
  source: MarketplacePluginSource
}

export interface MarketplaceManifest {
  name?: string
  plugins?: MarketplacePlugin[]
}

/**
 * Parse the plugin's `installPath` to extract the SHA prefix it was
 * pinned to (12 chars). Returns `null` for directory installs,
 * version-tagged installs, or any path shape we don't recognize as
 * SHA-pinned. Used to detect drift between manifest pin and on-disk
 * install.
 */
export function extractInstalledSha(
  installPath: string | undefined,
): string | null {
  if (!installPath) return null
  const dirName = path.basename(installPath)
  const m = SHA_PINNED_DIR_NAME.exec(dirName)
  return m ? m[1] ?? null : null
}

/**
 * Find an existing install of `pluginName` that came from a marketplace
 * *other than* ours. Plugin ids have the shape `<name>@<marketplace>`.
 * Returns the foreign install entry, or `undefined` if none.
 */
export function findForeignInstall(
  pluginName: string,
  plugins: PluginListEntry[],
  ourMarketplace: string,
): PluginListEntry | undefined {
  const ourId = `${pluginName}@${ourMarketplace}`
  for (const p of plugins) {
    if (!p.id.startsWith(`${pluginName}@`)) continue
    if (p.id === ourId) continue
    return p
  }
  return undefined
}

/**
 * Identify marketplaces that look orphaned — exist locally, aren't
 * ours, and only serve plugins our marketplace now serves canonically.
 * Returns the marketplace names; we warn the user rather than
 * auto-remove (a dev-source override is a legitimate deliberate state).
 */
export function findOrphanMarketplaces(
  marketplaces: MarketplaceListEntry[],
  ourMarketplace: string,
  ourPluginNames: Set<string>,
  plugins: PluginListEntry[],
): string[] {
  const orphans: string[] = []
  for (const mkt of marketplaces) {
    if (mkt.name === ourMarketplace) continue
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
 * Run `claude` CLI synchronously; return stdout + exit code. Stderr
 * goes through to our own stderr so the user sees CLI errors in real
 * time. Fails loudly on non-zero exit codes — the install flow has no
 * graceful fallback if the CLI itself is broken.
 */
function runClaudeCli(args: string[]): string {
  const result = spawnSync('claude', args, {
    encoding: 'utf8',
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
  return result.stdout
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
    logger.log(
      `Marketplace "${MARKETPLACE_NAME}" already added (source: ${existing.source}).`,
    )
    return existing
  }
  logger.log(`Adding marketplace "${MARKETPLACE_NAME}" from ${MARKETPLACE_URL}…`)
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
 * Reconcile a single plugin to the wheelhouse pin. Handles four cases:
 * foreign install (uninstall + install), missing (install), stale SHA
 * (uninstall + reinstall), and correct (no-op).
 */
function reconcilePlugin(plugin: MarketplacePlugin): void {
  const ourInstallId = `${plugin.name}@${MARKETPLACE_NAME}`
  const expectedShaPrefix = plugin.source.sha?.slice(0, 12) ?? null
  const pinDescription =
    plugin.source.sha ?? plugin.source.ref ?? '<no ref>'

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

  // (2) Our install present? Check SHA.
  const ours = plugins.find(p => p.id === ourInstallId)
  if (ours) {
    const installedShaPrefix = extractInstalledSha(ours.installPath)
    if (!expectedShaPrefix) {
      // Manifest pin has no SHA — we can't drift-compare. Trust the
      // existing install.
      logger.log(`Plugin ${ourInstallId} already installed (manifest has no SHA to compare).`)
      return
    }
    if (installedShaPrefix === expectedShaPrefix) {
      logger.log(`Plugin ${ourInstallId} already installed at pinned SHA ${expectedShaPrefix}.`)
      return
    }
    // Drift: our install is at a different SHA. Reinstall.
    logger.log(
      `Plugin ${ourInstallId} drift: installed at ${installedShaPrefix ?? '<unknown>'}, manifest pins ${expectedShaPrefix}. Reinstalling.`,
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
  for (const name of orphans) {
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
  for (const plugin of plugins) {
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
