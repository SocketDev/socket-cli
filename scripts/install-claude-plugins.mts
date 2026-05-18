#!/usr/bin/env node
/**
 * @file Reconcile the local machine's Claude Code plugin state to the
 *   wheelhouse-canonical SHA-pinned set.
 *
 *   - Ensures the `socket-wheelhouse` marketplace is added to Claude
 *     Code (`~/.claude/plugins/known_marketplaces.json`).
 *   - For each plugin in the wheelhouse marketplace's
 *     `.claude-plugin/marketplace.json`, ensures it's installed at the
 *     pinned SHA.
 *
 *   Idempotent — running twice is a no-op. Designed for `pnpm setup`
 *   wiring in every fleet repo.
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

interface MarketplaceListEntry {
  name: string
  source: string
  installLocation?: string
}

interface PluginListEntry {
  id: string
  version?: string
  scope?: string
  enabled?: boolean
  installPath?: string
}

interface MarketplacePluginSource {
  source: string
  url?: string
  path?: string
  ref?: string
  sha?: string
  commit?: string
}

interface MarketplacePlugin {
  name: string
  source: MarketplacePluginSource
}

interface MarketplaceManifest {
  name?: string
  plugins?: MarketplacePlugin[]
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

function ensurePluginInstalled(plugin: MarketplacePlugin): void {
  const installId = `${plugin.name}@${MARKETPLACE_NAME}`
  const installed = listPlugins().find(p => p.id === installId)
  if (installed) {
    logger.log(`Plugin ${installId} already installed (scope: ${installed.scope ?? 'unknown'}).`)
    return
  }
  logger.log(`Installing ${installId} pinned to ${plugin.source.sha ?? plugin.source.ref ?? '<no ref>'}…`)
  runClaudeCli(['plugin', 'install', installId, '--scope', 'user'])
  const after = listPlugins().find(p => p.id === installId)
  if (!after) {
    throw new Error(
      `plugin ${installId} did not appear in plugin list after install ` +
        '— check the CLI output above.',
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
    ensurePluginInstalled(plugin)
  }
  logger.log('Done.')
}

try {
  main()
} catch (e) {
  logger.fail(errorMessage(e))
  process.exit(1)
}
