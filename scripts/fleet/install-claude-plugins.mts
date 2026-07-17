#!/usr/bin/env node
/*
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
 *      `.claude/hooks/fleet/marketplace-comment-guard/`: every
 *      `plugins[].source.sha` in `marketplace.json` must have a row in
 *      `.claude-plugin/README.md` with matching version + sha + ISO date.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { parsePatchFileName } from './constants/plugin-patch.mts'
import { SOAK_DAYS } from './constants/soak.mts'
import { isSocketSourcedRepository } from './constants/socket-scopes.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const DAY_MS = 86_400_000

const logger = getDefaultLogger()

// Wheelhouse-owned patches reapplied to plugin caches after (re)install.
// Some upstream plugins ship bugs we've fixed but can't land upstream yet;
// the cache is overwritten on every install, so the fix has to be reapplied
// from a checked-in diff. Lives in scripts/fleet/plugin-patches/ (a plainly-ours
// dir, not Claude Code's `.claude-plugin/` convention dir). File naming:
// <plugin>-<version>-<slug>.patch — the `<plugin>` + `<version>` prefix maps
// to the cache dir ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_PATCHES_DIR = path.join(SCRIPT_DIR, 'plugin-patches')
// The patch filename grammar + parser live in one shared module so the
// installer and the edit-time `plugin-patch-format-guard` hook can't drift.
// Re-exported so this module's existing surface (the unit test imports
// `parsePatchFileName` from here) keeps working.
export { parsePatchFileName }

// Canonical marketplace identity. The repo URL is what `claude plugin
// marketplace add` resolves; the name is what Claude Code records in
// `known_marketplaces.json` and what plugins reference via `@<name>`.
const MARKETPLACE_NAME = 'socket-wheelhouse'
const MARKETPLACE_URL = 'https://github.com/SocketDev/socket-wheelhouse'

// Claude Code stores SHA-pinned plugin installs at a cache directory
// whose name is `<sha-12-chars>-<content-hash-8-chars>`. We parse the
// first segment to extract the pinned SHA for drift comparison.
const SHA_PINNED_DIR_NAME = /^([0-9a-f]{12})-[0-9a-f]{8,}$/

/**
 * The single owner of the `~/.claude/plugins/` base path — Claude Code's plugin
 * home, which holds both `installed_plugins.json` (the state file) and
 * `cache/<marketplace>/<plugin>/<version>/` (the per-plugin caches). Every
 * other reference derives from this one construction (1 path, 1 reference).
 * Returns `undefined` if HOME / USERPROFILE is unresolvable.
 */
function getPluginsDir(): string | undefined {
  const home = process.env['HOME'] ?? process.env['USERPROFILE']
  if (!home || !path.isAbsolute(home)) {
    return undefined
  }
  return path.join(home, '.claude', 'plugins')
}

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
 * A plugin held out of reconcile by the soak gate: a non-Socket plugin whose
 * pinned SHA is younger than the soak window (or whose commit date / pin can't
 * be verified — fail closed). `committedAt` is undefined when unresolvable.
 */
export interface PluginSoakHold {
  committedAt: Date | undefined
  name: string
  remainingMs: number
  sha: string
}

/**
 * The soak partition of a marketplace's plugins: `cleared` passed the window
 * and reconcile, `exempt` are Socket-owned (own provenance pipeline, mirroring
 * the npm SOCKET_SCOPES bypass), `held` are too-young / unverifiable non-Socket
 * pins the gate keeps from installing.
 */
export interface PluginSoakPartition {
  cleared: MarketplacePlugin[]
  exempt: MarketplacePlugin[]
  held: PluginSoakHold[]
}

/**
 * Resolves a commit's authored date for `owner/repo` at `sha`. Injectable so
 * the unit tests drive the partition without `gh` or the network; returns
 * undefined when unresolvable (an unverifiable date is never soak-cleared).
 */
export type ResolvePluginCommitDate = (
  ownerRepo: string,
  sha: string,
) => Date | undefined

/**
 * Extract the `owner/repo` slug from a plugin source's git URL (both
 * `https://github.com/owner/repo.git` and `git@github.com:owner/repo.git`
 * forms). Returns undefined when the URL is absent or not a GitHub remote.
 */
export function pluginSourceOwnerRepo(
  source: MarketplacePluginSource,
): string | undefined {
  const { url } = source
  if (typeof url !== 'string' || url === '') {
    return undefined
  }
  const m = /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : undefined
}

/**
 * True when a plugin's source repo is Socket-owned (SocketDev org). Socket
 * plugins go through our own provenance pipeline, so they bypass the soak — the
 * same exemption Socket-published npm scopes get.
 */
export function isSocketOwnedPluginSource(
  source: MarketplacePluginSource,
): boolean {
  const ownerRepo = pluginSourceOwnerRepo(source)
  return ownerRepo !== undefined && isSocketSourcedRepository(ownerRepo)
}

/**
 * Soak-partition marketplace plugins. Socket-owned plugins are exempt; every
 * other plugin's pinned SHA must have a commit date at least `soakDays` old.
 * A missing SHA, a non-GitHub URL, or an unverifiable commit date is held
 * (fail closed — a third-party plugin must be SHA-pinned and soak-verifiable to
 * install). Pure given `resolveCommitDate` — the primary unit-test target.
 */
export function partitionPluginsBySoak(options: {
  now: Date
  plugins: readonly MarketplacePlugin[]
  resolveCommitDate: ResolvePluginCommitDate
  soakDays: number
}): PluginSoakPartition {
  const { now, plugins, resolveCommitDate, soakDays } = options
  const soakMs = soakDays * DAY_MS
  const nowMs = now.getTime()
  const cleared: MarketplacePlugin[] = []
  const exempt: MarketplacePlugin[] = []
  const held: PluginSoakHold[] = []
  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const plugin = plugins[i]!
    const { source } = plugin
    if (isSocketOwnedPluginSource(source)) {
      exempt.push(plugin)
      continue
    }
    const ownerRepo = pluginSourceOwnerRepo(source)
    const sha = source.sha
    if (ownerRepo === undefined || typeof sha !== 'string' || sha === '') {
      held.push({
        committedAt: undefined,
        name: plugin.name,
        remainingMs: soakMs,
        sha: typeof sha === 'string' ? sha : '',
      })
      continue
    }
    const committedAt = resolveCommitDate(ownerRepo, sha)
    if (!committedAt || Number.isNaN(committedAt.getTime())) {
      held.push({
        committedAt: undefined,
        name: plugin.name,
        remainingMs: soakMs,
        sha,
      })
      continue
    }
    const ageMs = nowMs - committedAt.getTime()
    if (ageMs >= soakMs) {
      cleared.push(plugin)
    } else {
      held.push({
        committedAt,
        name: plugin.name,
        remainingMs: soakMs - ageMs,
        sha,
      })
    }
  }
  return { cleared, exempt, held }
}

/**
 * Resolve a commit's authored date through the sanctioned `gh api` read path.
 * Returns undefined on any failure so the soak gate treats an unverifiable date
 * as not-cleared (fail closed). Never a raw api.github.com fetch.
 */
function resolvePluginCommitDateViaGhApi(
  ownerRepo: string,
  sha: string,
): Date | undefined {
  const result = spawnSync(
    'gh',
    [
      'api',
      `repos/${ownerRepo}/commits/${sha}`,
      '--jq',
      '.commit.committer.date',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.status !== 0) {
    return undefined
  }
  const iso = String(result.stdout ?? '').trim()
  if (!iso) {
    return undefined
  }
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
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

// The CLI boundary the reconciler runs against. Injectable so unit tests can
// drive reconcilePlugin through every branch without a real `claude` binary.
export type CliRunner = (args: string[]) => string

function listMarketplaces(
  runCli: CliRunner = runClaudeCli,
): MarketplaceListEntry[] {
  const stdout = runCli(['plugin', 'marketplace', 'list', '--json'])
  try {
    return JSON.parse(stdout) as MarketplaceListEntry[]
  } catch {
    return []
  }
}

function listPlugins(runCli: CliRunner = runClaudeCli): PluginListEntry[] {
  const stdout = runCli(['plugin', 'list', '--json'])
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
  const pluginsDir = getPluginsDir()
  if (!pluginsDir) {
    return undefined
  }
  const stateFile = path.join(pluginsDir, 'installed_plugins.json')
  if (!existsSync(stateFile)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    return undefined
  }
}

export function loadMarketplaceManifest(
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

function uninstallPlugin(
  installId: string,
  runCli: CliRunner = runClaudeCli,
): void {
  logger.log(`Uninstalling ${installId}…`)
  runCli(['plugin', 'uninstall', installId, '--scope', 'user'])
}

function installPlugin(
  installId: string,
  pinDescription: string,
  runCli: CliRunner = runClaudeCli,
): void {
  logger.log(`Installing ${installId} pinned to ${pinDescription}…`)
  runCli(['plugin', 'install', installId, '--scope', 'user'])
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

export interface ReconcileOptions {
  // State loader for ~/.claude/plugins/installed_plugins.json; injectable so
  // tests can exercise the SHA-compare branches without a real HOME.
  readonly loadState?: (() => unknown) | undefined
  readonly runCli?: CliRunner | undefined
}

/**
 * Reconcile a single plugin to the wheelhouse pin. Handles four cases: foreign
 * install (uninstall + install), missing (install), stale SHA (uninstall +
 * reinstall), and correct (no-op).
 */
export function reconcilePlugin(
  plugin: MarketplacePlugin,
  options?: ReconcileOptions | undefined,
): void {
  const opts = { __proto__: null, ...options } as ReconcileOptions
  const runCli = opts.runCli ?? runClaudeCli
  const loadState = opts.loadState ?? loadInstalledPluginsState
  const ourInstallId = `${plugin.name}@${MARKETPLACE_NAME}`
  const expectedSha = plugin.source.sha ?? undefined
  const pinDescription = plugin.source.sha ?? plugin.source.ref ?? '<no ref>'

  let plugins = listPlugins(runCli)

  // (1) Foreign install: same plugin name, different marketplace. Wheelhouse
  // is the pin authority; uninstall the foreign install so our pin can
  // take effect. The user's enabledPlugins entry under the foreign id
  // disappears as a side effect of the CLI uninstall.
  const foreign = findForeignInstall(plugin.name, plugins, MARKETPLACE_NAME)
  if (foreign) {
    logger.log(
      `Found foreign install ${foreign.id} (path: ${foreign.installPath ?? '<unknown>'}); rewiring to ${ourInstallId}.`,
    )
    uninstallPlugin(foreign.id, runCli)
    plugins = listPlugins(runCli)
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
    const state = loadState()
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
    uninstallPlugin(ourInstallId, runCli)
    installPlugin(ourInstallId, pinDescription, runCli)
    return
  }

  // (3) Not installed at all (or we just uninstalled a foreign copy).
  installPlugin(ourInstallId, pinDescription, runCli)
  const after = listPlugins(runCli).find(p => p.id === ourInstallId)
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

/**
 * Resolve the on-disk cache dir for a plugin pinned in our marketplace. Claude
 * Code lays caches out at
 * `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. Returns the
 * absolute path, or `undefined` if HOME is unresolvable or the dir is absent.
 */
function resolvePluginCacheDir(
  pluginName: string,
  version: string,
): string | undefined {
  const pluginsDir = getPluginsDir()
  if (!pluginsDir) {
    return undefined
  }
  const dir = path.join(
    pluginsDir,
    'cache',
    MARKETPLACE_NAME,
    pluginName,
    version,
  )
  return existsSync(dir) ? dir : undefined
}

/**
 * Strip the leading `# @key: value` / `#` comment header from a fleet-style
 * patch, returning just the unified-diff body (everything from the first `--- `
 * line onward). Mirrors socket-btm's node-smol patch convention, where the
 * header carries provenance metadata and the apply step feeds only the diff to
 * `patch`. Returns an empty string if the file has no `--- ` line.
 */
export function stripPatchHeader(patchText: string): string {
  const idx = patchText.search(/^--- /m)
  return idx === -1 ? '' : patchText.slice(idx)
}

/**
 * Derive the sidecar dir for a patch file. A patch named `<x>.patch` may ship a
 * companion `<x>.files/` directory whose tree mirrors the plugin cache root
 * (e.g. `<x>.files/scripts/lib/read-stdin-sync.mjs` → `<cache>/scripts/lib/…`).
 * The fleet "smallest patch footprint" rule prefers moving substantial logic
 * into such a sidecar module so the diff itself stays an import + call-site
 * swap, rather than inlining a 30-line function body. Returns the dir path
 * (whether or not it exists — caller checks).
 */
export function patchSidecarDir(patchPath: string): string {
  return patchPath.replace(/\.patch$/, '.files')
}

/**
 * Copy a patch's sidecar `.files/` tree into the plugin cache, overwriting.
 * No-op when the patch ships no sidecar. Runs before the diff is applied so the
 * thin diff's `import` of a sidecar module resolves. Idempotent (plain
 * overwrite copy).
 */
function copyPatchSidecar(patchPath: string, cacheDir: string): void {
  const sidecar = patchSidecarDir(patchPath)
  if (!existsSync(sidecar)) {
    return
  }
  cpSync(sidecar, cacheDir, { recursive: true })
}

/**
 * Reapply wheelhouse-owned patches to plugin caches. The cache is regenerated
 * on every (re)install, so an upstream-bug fix we can't land upstream yet has
 * to be replayed from a checked-in diff.
 *
 * Patches use the fleet (socket-btm) convention: a `# @key: value` provenance
 * header above a plain `diff -u` body (NOT a `git diff` — no `index`/`mode`
 * markers), applied with `patch -p1`, the same tool the node-smol build chain
 * uses. The header is stripped before feeding the diff to `patch`.
 *
 * Idempotent: a forward `--dry-run` that fails while a reverse `--dry-run`
 * succeeds means the fix is already present, so it's skipped. A patch that
 * applies neither way (e.g. the plugin bumped and the patch went stale) is
 * reported, not fatal — a stale patch shouldn't wedge the whole reconcile.
 */
export interface ReapplyPatchesOptions {
  readonly patchesDir?: string | undefined
  // Cache-dir resolver for <plugin>@<version>; injectable so tests can point
  // patches at a tmp tree instead of a real ~/.claude/plugins cache.
  readonly resolveCacheDir?:
    | ((pluginName: string, version: string) => string | undefined)
    | undefined
  // The `patch` binary boundary — receives the extra args (dry-run / reverse),
  // the cache dir, and the diff body; returns the exit status.
  readonly runPatchCommand?:
    | ((
        extraArgs: readonly string[],
        cacheDir: string,
        diff: string,
      ) => { status: number | null })
    | undefined
}

function runPatchBinary(
  extraArgs: readonly string[],
  cacheDir: string,
  diff: string,
): { status: number | null } {
  // patch reads the diff from stdin. -p1 strips the leading a/ b/ segment;
  // --forward refuses to re-apply an already-applied hunk (so the forward
  // dry-run cleanly fails when the fix is present).
  return spawnSync('patch', ['-p1', '--forward', '--silent', ...extraArgs], {
    cwd: cacheDir,
    input: diff,
    stdio: ['pipe', 'ignore', 'ignore'],
  })
}

export function reapplyPluginPatches(
  options?: ReapplyPatchesOptions | undefined,
): void {
  const opts = { __proto__: null, ...options } as ReapplyPatchesOptions
  const patchesDir = opts.patchesDir ?? PLUGIN_PATCHES_DIR
  const resolveCacheDir = opts.resolveCacheDir ?? resolvePluginCacheDir
  const runPatchCommand = opts.runPatchCommand ?? runPatchBinary
  if (!existsSync(patchesDir)) {
    return
  }
  const patchFiles = readdirSync(patchesDir)
    .filter(f => f.endsWith('.patch'))
    // oxlint-disable-next-line unicorn/no-array-sort -- .filter() already returns a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
    .sort()
  for (let i = 0, { length } = patchFiles; i < length; i += 1) {
    const file = patchFiles[i]!
    const parsed = parsePatchFileName(file)
    if (!parsed) {
      logger.warn(
        `Skipping patch "${file}": name must match <plugin>-<version>-<slug>.patch.`,
      )
      continue
    }
    const { plugin: pluginName, version } = parsed
    const patchPath = path.join(patchesDir, file)
    const diff = stripPatchHeader(readFileSync(patchPath, 'utf8'))
    if (!diff) {
      logger.warn(`Skipping patch "${file}": no \`--- \` diff body found.`)
      continue
    }
    const cacheDir = resolveCacheDir(pluginName, version)
    if (!cacheDir) {
      logger.log(
        `Patch "${file}": no cache for ${pluginName}@${version}; skipping (plugin not installed).`,
      )
      continue
    }
    // Copy any sidecar modules into the cache first, so the thin diff's
    // import of them resolves (and so the already-applied reverse-check sees
    // the same tree the forward apply produced).
    copyPatchSidecar(patchPath, cacheDir)
    const runPatch = (extraArgs: readonly string[]) =>
      runPatchCommand(extraArgs, cacheDir, diff)
    if (runPatch(['--dry-run']).status !== 0) {
      // Forward dry-run failed. Either already applied or genuinely stale —
      // a reverse dry-run that succeeds means the fix is already present.
      if (runPatch(['--reverse', '--dry-run']).status === 0) {
        logger.log(
          `Patch "${file}" already applied to ${pluginName}@${version}.`,
        )
      } else {
        logger.warn(
          `Patch "${file}" did not apply to ${pluginName}@${version} ` +
            '(neither forward nor already-applied). The plugin may have ' +
            'changed upstream — regenerate via the regenerating-patches skill.',
        )
      }
      continue
    }
    if (runPatch([]).status === 0) {
      logger.success(`Applied patch "${file}" to ${pluginName}@${version}.`)
    } else {
      logger.warn(`Patch "${file}" dry-run passed but apply failed; skipped.`)
    }
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

  // Soak gate: a non-Socket plugin whose pinned SHA is younger than the fleet
  // soak window (or whose commit date can't be verified) is HELD out of
  // reconcile — a fresh third-party plugin can't land before its soak. Socket
  // plugins bypass (own provenance pipeline).
  const { held } = partitionPluginsBySoak({
    now: new Date(),
    plugins,
    resolveCommitDate: resolvePluginCommitDateViaGhApi,
    soakDays: SOAK_DAYS,
  })
  const heldNames = new Set(held.map(h => h.name))
  for (let i = 0, { length } = held; i < length; i += 1) {
    const { committedAt, name, remainingMs, sha } = held[i]!
    const age =
      committedAt === undefined
        ? 'commit date unverifiable / no pinned SHA'
        : `${Math.ceil(remainingMs / DAY_MS)}d left of ${SOAK_DAYS}d soak`
    logger.fail(
      `Holding plugin "${name}" (${sha.slice(0, 12) || '<no sha>'}) — too fresh: ${age}.`,
    )
  }

  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const plugin = plugins[i]!
    if (heldNames.has(plugin.name)) {
      continue
    }
    reconcilePlugin(plugin)
  }

  // Post-pass: warn about marketplaces that now look redundant.
  const ourPluginNames = new Set(plugins.map(p => p.name))
  warnOrphanMarketplaces(listMarketplaces(), ourPluginNames, listPlugins())

  // Post-pass: reapply wheelhouse-owned patches over the (re)installed caches.
  reapplyPluginPatches()

  if (held.length) {
    logger.fail(
      `${held.length} plugin(s) held under the ${SOAK_DAYS}-day soak — re-run once they clear.`,
    )
    process.exitCode = 1
  }

  logger.log('Done.')
}

// Skip execution when imported (for tests). The CLI entry is direct
// `node scripts/install-claude-plugins.mts` invocation.
if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (e) {
    logger.fail(errorMessage(e))
    process.exit(1)
  }
}
