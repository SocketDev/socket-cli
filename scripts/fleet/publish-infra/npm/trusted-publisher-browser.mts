#!/usr/bin/env node
/*
 * @file Npm Trusted Publisher settings driver — reads and mass-applies the
 *   fleet's canonical GitHub Actions trusted-publisher config across packages
 *   by driving `https://www.npmjs.com/package/<pkg>/access` in a signed-in
 *   Chrome — playwright-core against the SAME durable profile and launch
 *   shape as `staged-browser-read.mts`, so the operator's staged-publish
 *   sign-in is reused. Modes: `read <pkg…>` prints each package's
 *   CURRENT form values as a table (read-only); `apply <pkg…>` prints the
 *   current-to-desired diff per package and is DRY-RUN BY DEFAULT — `--drive` (the agent takes the wheel of your signed-in session)
 *   fills the form (workflow filename, environment name, allowed-action
 *   checkboxes) and clicks Save, then RE-READS the form and only counts the
 *   package done when the saved state matches desired: success is the page's
 *   answer, never the click. `--socket-registry` expands the worklist to
 *   every published @socketregistry/* package from socket-registry's own
 *   `registry/manifest.json` (local sibling checkout, else `gh api`).
 *   Fail-soft per package: one failure never aborts the batch; a summary
 *   prints at the end. The pure planners live in
 *   `trusted-publisher-parse.mts` + `trusted-publisher-plan.mts`; the
 *   page-level form I/O in `trusted-publisher-page.mts`. The sign-in and
 *   challenge contract — reuse the seeded session, PAUSE a human-verification
 *   challenge for the operator instead of blind-retrying — is owned by
 *   `browser-session.mts` (`runChallengeAware`); see
 *   `docs/agents.md/fleet/npm-anti-bot-rhythm.md`.
 *   Usage: node scripts/fleet/publish-infra/npm/trusted-publisher-browser.mts
 *   read|apply [<pkg>…] [--socket-registry] [--drive] [--repo <owner/name>]
 *   [--profile-dir <dir>]
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import type { Page } from 'playwright-core'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { runMain } from '../../_shared/run-main.mts'
import type { ScriptMeta } from '../../_shared/run-main.mts'
import { logger, rootPath, runCapture } from '../shared.mts'
import { openNpmBrowserSession } from './browser-session.mts'
import type {
  NpmBrowserSession,
  NpmBrowserSessionOptions,
} from './browser-session.mts'
import {
  accessUrl,
  driveVerifiedSave,
  readTrustedPublisher,
} from './trusted-publisher-page.mts'
import {
  desiredTrustedPublisher,
  diffTrustedPublisher,
  formatApplySummary,
  formatPartialSaveFailure,
  parseSocketRegistryManifest,
  renderPlannedEdits,
  renderReadTable,
  SOCKET_REGISTRY_SCOPE,
} from './trusted-publisher-plan.mts'
import type { AccessReadRow, ApplyResult } from './trusted-publisher-plan.mts'

/**
 * Open the signed-in npm session for the trusted-publisher driver — the
 * SHARED fleet bootstrap from `staged-browser-read.mts`: system Chrome via
 * `launchPersistentContext` on the ONE durable profile under
 * `~/.config/socket-wheelhouse/`, so an operator already signed in for the
 * publish gate is signed in here too, and never a second per-tool profile.
 * The `launch` seam stays injectable so tests never start a browser.
 */
export async function openTrustedPublisherSession(
  options?: NpmBrowserSessionOptions | undefined,
): Promise<NpmBrowserSession> {
  const session = await openNpmBrowserSession(options)
  logger.log(`Signed in to npm as ${session.user}.`)
  return session
}

/**
 * Extract a repo's declared napi platform tokens from its parsed
 * `socket-wheelhouse.json` value: `napi.platforms` as a non-empty array of
 * strings, or undefined when the block is absent or malformed. These are the
 * raw napi-rs target tokens (`darwin-arm64`, `linux-x64-gnu`) that tail a
 * per-platform package name. Pure — exported for tests.
 */
export function napiPlatformsFromConfig(
  configValue: unknown,
): readonly string[] | undefined {
  const napi = (
    configValue as { napi?: unknown | undefined } | null | undefined
  )?.napi as { platforms?: unknown | undefined } | undefined
  const platforms = napi?.platforms
  if (!Array.isArray(platforms)) {
    return undefined
  }
  const tokens: string[] = []
  for (let i = 0, { length } = platforms; i < length; i += 1) {
    const token = platforms[i]
    if (typeof token === 'string' && token) {
      tokens.push(token)
    }
  }
  return tokens.length ? tokens : undefined
}

/**
 * Read a sibling checkout's declared napi platform tokens: the target repo's
 * `.config/repo/socket-wheelhouse.json` `napi.platforms`, resolved at
 * `../<repoName>` next to this checkout — the same sibling layout the
 * `--socket-registry` expansion uses. Fail-soft: an unreachable checkout, an
 * absent config, or a malformed body yields undefined, so a package whose repo
 * cannot be read keeps the js workflow. `readFile` is injectable so tests drive
 * it with no disk.
 */
export async function readSiblingNapiPlatforms(
  repoName: string,
  options?:
    | { readFile?: ((file: string) => Promise<string>) | undefined }
    | undefined,
): Promise<readonly string[] | undefined> {
  const { readFile = (file: string) => fs.readFile(file, 'utf8') } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const configPath = path.resolve(
    rootPath,
    '..',
    repoName,
    '.config',
    'repo',
    'socket-wheelhouse.json',
  )
  let body: string
  try {
    body = await readFile(configPath)
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  return napiPlatformsFromConfig(parsed)
}

/**
 * Plan (and with `drive`, perform + verify) one package's trusted-publisher
 * update. Never throws — every outcome is an ApplyResult so the batch keeps
 * moving. `resolveNapiPlatforms` (when supplied) reads the derived repo's
 * `napi.platforms` so a napi platform package targets the napi workflow; its
 * absence keeps the js workflow.
 */
export async function applyOne(
  page: Page,
  pkg: string,
  config: {
    drive: boolean
    repoOverride?: string | undefined
    resolveNapiPlatforms?:
      | ((repoName: string) => Promise<readonly string[] | undefined>)
      | undefined
  },
): Promise<ApplyResult> {
  const cfg = { __proto__: null, ...config } as typeof config
  try {
    const { current, state } = await readTrustedPublisher(page, pkg)
    const provisional = desiredTrustedPublisher({
      current,
      pkg,
      repoOverride: cfg.repoOverride,
    })
    if (!provisional) {
      return {
        detail:
          `${state} and no repo derivable — pass --repo <owner/name> ` +
          'for a non-@socketregistry package with no configured repo.',
        pkg,
        status: 'skipped',
      }
    }
    const napiPlatforms = cfg.resolveNapiPlatforms
      ? await cfg.resolveNapiPlatforms(provisional.repositoryName)
      : undefined
    const desired = napiPlatforms?.length
      ? (desiredTrustedPublisher({
          current,
          napiPlatforms,
          pkg,
          repoOverride: cfg.repoOverride,
        }) ?? provisional)
      : provisional
    const edits = diffTrustedPublisher({ current, desired })
    if (edits.length === 0) {
      logger.substep(`${pkg}: conforms — no edits`)
      return { pkg, status: 'conforms' }
    }
    if (!cfg.drive) {
      logger.log(`[dry-run] ${renderPlannedEdits(pkg, edits)}`)
      return { pkg, status: 'planned' }
    }
    const saved = await driveVerifiedSave(page, pkg, desired)
    if (!saved.ok) {
      return {
        detail: formatPartialSaveFailure({
          mismatches: saved.mismatches,
          url: accessUrl(pkg),
        }),
        pkg,
        status: 'failed',
      }
    }
    logger.success(
      `${pkg}: applied + verified (${desired.repositoryOwner}/${desired.repositoryName} · ${desired.workflowFilename} · ${desired.environmentName}).`,
    )
    return { pkg, status: 'applied' }
  } catch (e) {
    return { detail: errorMessage(e), pkg, status: 'failed' }
  }
}

/**
 * Expand `--socket-registry` into every published @socketregistry/* package:
 * socket-registry's own `registry/manifest.json`, read from a sibling
 * checkout when one exists, else through `gh api`. Throws LOUD when neither
 * source yields a manifest — a silent empty expansion would no-op the sweep.
 */
export async function expandSocketRegistryWorklist(): Promise<string[]> {
  const localDir =
    process.env['SOCKET_REGISTRY_DIR'] ||
    path.resolve(rootPath, '..', 'socket-registry')
  const localManifest = path.join(localDir, 'registry', 'manifest.json')
  let body: string | undefined
  try {
    body = await fs.readFile(localManifest, 'utf8')
  } catch {
    const { code, stdout } = await runCapture(
      'gh',
      [
        'api',
        'repos/SocketDev/socket-registry/contents/registry/manifest.json',
        '-H',
        'Accept: application/vnd.github.raw',
      ],
      rootPath,
    )
    if (code === 0 && stdout.trim()) {
      body = stdout
    }
  }
  if (!body) {
    throw new Error(
      '--socket-registry expansion failed. Where: ' +
        `${localManifest}, then gh api SocketDev/socket-registry. ` +
        'Fix: check out socket-registry as a sibling, or authenticate gh.',
    )
  }
  const entries = parseSocketRegistryManifest(body)
  const names: string[] = []
  const skipped: string[] = []
  let deprecated = 0
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    // The manifest also lists the rare package socket-registry publishes
    // under its ORIGINAL unscoped name, for example shell-quote. This
    // expansion's contract is the @socketregistry/* scope only; unscoped rows
    // are named out loud so nobody thinks they were silently swept.
    if (!entry.name.startsWith(SOCKET_REGISTRY_SCOPE)) {
      skipped.push(entry.name)
      continue
    }
    names.push(entry.name)
    if (entry.deprecated) {
      deprecated += 1
    }
  }
  logger.log(
    `--socket-registry expanded to ${names.length} published @socketregistry/* package(s); ${deprecated} marked deprecated, kept — a stale publisher on a deprecated package still matters if it ever republishes.`,
  )
  if (skipped.length) {
    logger.substep(
      `excluded ${skipped.length} non-@socketregistry manifest row(s): ${skipped.join(', ')} — name them positionally to include them.`,
    )
  }
  return names
}

interface CliArgs {
  drive: boolean
  mode: 'apply' | 'read'
  packages: string[]
  profileDir?: string | undefined
  repo?: string | undefined
  socketRegistry: boolean
}

const USAGE =
  'Usage: trusted-publisher-browser.mts read|apply [<pkg>…] ' +
  '[--socket-registry] [--drive] [--repo <owner/name>] [--profile-dir <dir>]'

/**
 * Parse the CLI: a `read`/`apply` mode word, positional package names, and
 * the flags. Exits, usage error, on an unknown flag/mode or a value-taking
 * flag with no value. Exported for tests.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const mode = argv[0]
  if (mode !== 'apply' && mode !== 'read') {
    logger.fail(USAGE)
    process.exit(1)
  }
  let drive = false
  let profileDir: string | undefined
  let repo: string | undefined
  let socketRegistry = false
  const packages: string[] = []
  for (let i = 1, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--drive') {
      drive = true
      continue
    }
    if (arg === '--socket-registry') {
      socketRegistry = true
      continue
    }
    if (arg === '--profile-dir' || arg === '--repo') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('-')) {
        logger.fail(`Flag ${arg} needs a value.`)
        process.exit(1)
      }
      if (arg === '--repo') {
        repo = value
      } else {
        profileDir = value
      }
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      logger.fail(`Unknown flag: ${arg}`)
      logger.error(USAGE)
      process.exit(1)
    }
    packages.push(arg)
  }
  return { drive, mode, packages, profileDir, repo, socketRegistry }
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const packages = [...args.packages]
  if (args.socketRegistry) {
    packages.push(...(await expandSocketRegistryWorklist()))
  }
  if (packages.length === 0) {
    logger.fail('No packages named.')
    logger.error(USAGE)
    process.exitCode = 1
    return
  }
  const session = await openTrustedPublisherSession({
    profileDir: args.profileDir,
  })
  try {
    if (args.mode === 'read') {
      const rows: AccessReadRow[] = []
      for (let i = 0, { length } = packages; i < length; i += 1) {
        const pkg = packages[i]!
        try {
          // eslint-disable-next-line no-await-in-loop -- serial per-package reads share one page session.
          const { current, state } = await readTrustedPublisher(
            session.page,
            pkg,
          )
          rows.push({ current, pkg, state })
        } catch (e) {
          rows.push({ detail: errorMessage(e), pkg, state: 'error' })
          process.exitCode = 1
        }
      }
      logger.log(renderReadTable(rows))
      return
    }
    logger.log(
      `npm trusted publishing — ${packages.length} package(s)` +
        `${args.drive ? ' [drive]' : ' [dry-run]'}`,
    )
    const napiPlatformsCache = new Map<
      string,
      Promise<readonly string[] | undefined>
    >()
    const resolveNapiPlatforms = (repoName: string) => {
      let pending = napiPlatformsCache.get(repoName)
      if (!pending) {
        pending = readSiblingNapiPlatforms(repoName)
        napiPlatformsCache.set(repoName, pending)
      }
      return pending
    }
    const results: ApplyResult[] = []
    for (let i = 0, { length } = packages; i < length; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- serial per-package applies share one page session.
      const result = await applyOne(session.page, packages[i]!, {
        drive: args.drive,
        repoOverride: args.repo,
        resolveNapiPlatforms,
      })
      if (result.status === 'failed' || result.status === 'skipped') {
        logger.error(`${result.pkg}: ${result.status} — ${result.detail}`)
      }
      results.push(result)
    }
    logger.log('')
    logger.log(formatApplySummary(results, { drive: args.drive }))
    if (results.some(r => r.status === 'failed')) {
      process.exitCode = 1
    }
  } finally {
    await session.close()
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'reads and mass-applies the canonical npm trusted-publisher config by driving the access page in a signed-in browser',
  help: `${USAGE}

  --socket-registry   expand the worklist to every published @socketregistry package
  --drive             fill and save the form (apply is dry-run by default)
  --repo <owner/name> override the repository the config binds to
  --profile-dir <dir> use another browser profile directory`,
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not launch a browser.
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
