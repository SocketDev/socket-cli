#!/usr/bin/env node
/*
 * @file Npm Trusted Publisher settings driver — reads and mass-applies the
 *   fleet's canonical GitHub Actions trusted-publisher config across packages
 *   by driving `https://www.npmjs.com/package/<pkg>/access` in a signed-in
 *   Chrome — playwright-core against the SAME durable profile and launch
 *   shape as `staged-browser-read.mts`, so the operator's staged-publish
 *   sign-in is reused. Modes: `read <pkg…>` prints each package's
 *   CURRENT form values as a table (read-only); `apply <pkg…>` prints the
 *   current-to-desired diff per package and is DRY-RUN BY DEFAULT — `--live`
 *   fills the form (workflow filename, environment name, allowed-action
 *   checkboxes) and clicks Save, then RE-READS the form and only counts the
 *   package done when the saved state matches desired: success is the page's
 *   answer, never the click. `--socket-registry` expands the worklist to
 *   every published @socketregistry/* package from socket-registry's own
 *   `registry/manifest.json` (local sibling checkout, else `gh api`).
 *   Fail-soft per package: one failure never aborts the batch; a summary
 *   prints at the end. The pure planners live in
 *   `trusted-publisher-parse.mts` + `trusted-publisher-plan.mts`; the
 *   page-level form I/O in `trusted-publisher-page.mts`.
 *   THE SIGN-IN AND CHALLENGE CONTRACT, taken from socket-registry's proven
 *   configurator (`scripts/npm/configure-staged-publishing-browser.mts`,
 *   which mass-configured npm package settings across that registry):
 *
 *   - NO login is ever scripted. The operator signs in ONCE in the headed window;
 *     the profile persists, so it is a per-machine step. No password, OTP, or
 *     cookie passes through this process.
 *   - The ONLY auth signal is npm's own `/-/whoami`, and the only auth failure
 *     reported is "signed out".
 *   - The launch shape is exactly that module's:
 *     `launchPersistentContext(profileDir, { channel, headless: false })` — no
 *     args array, no sandbox toggle. Playwright adds `--no-sandbox` by default;
 *     that flag banner is cosmetic and is NOT a sign-in blocker.
 *   - A human-verification challenge PAUSES the run for the operator with a
 *     visible elapsed/remaining countdown and is NEVER retried blindly: a retry
 *     ladder against a bot challenge earns a rate limit, which then masquerades
 *     as a broken session. Nothing is written while a challenge is outstanding.
 *     Usage: node scripts/fleet/publish-infra/npm/trusted-publisher-browser.mts
 *     read|apply [<pkg>…] [--socket-registry] [--live] [--repo <owner/name>]
 *     [--profile-dir <dir>]
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import type { Page } from 'playwright-core'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { logger, rootPath, runCapture } from '../shared.mts'
import { openNpmBrowserSession } from './browser-session.mts'
import type {
  NpmBrowserSession,
  NpmBrowserSessionOptions,
} from './browser-session.mts'
import {
  awaitVerifiedSave,
  driveFormEdits,
  readTrustedPublisher,
} from './trusted-publisher-page.mts'
import {
  desiredTrustedPublisher,
  diffTrustedPublisher,
  formatApplySummary,
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
 * Plan (and with `live`, perform + verify) one package's trusted-publisher
 * update. Never throws — every outcome is an ApplyResult so the batch keeps
 * moving.
 */
export async function applyOne(
  page: Page,
  pkg: string,
  config: { live: boolean; repoOverride?: string | undefined },
): Promise<ApplyResult> {
  const cfg = { __proto__: null, ...config } as typeof config
  try {
    const { current, state } = await readTrustedPublisher(page, pkg)
    const desired = desiredTrustedPublisher({
      current,
      pkg,
      repoOverride: cfg.repoOverride,
    })
    if (!desired) {
      return {
        detail:
          `${state} and no repo derivable — pass --repo <owner/name> ` +
          'for a non-@socketregistry package with no configured repo.',
        pkg,
        status: 'skipped',
      }
    }
    const edits = diffTrustedPublisher({ current, desired })
    if (edits.length === 0) {
      logger.substep(`${pkg}: conforms — no edits`)
      return { pkg, status: 'conforms' }
    }
    if (!cfg.live) {
      logger.log(`[dry-run] ${renderPlannedEdits(pkg, edits)}`)
      return { pkg, status: 'planned' }
    }
    await driveFormEdits(page, pkg, desired)
    const verify = await awaitVerifiedSave(page, pkg, desired)
    if (!verify.ok) {
      return {
        detail: `saved state did not verify: ${verify.mismatches.join('; ')}`,
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
  live: boolean
  mode: 'apply' | 'read'
  packages: string[]
  profileDir?: string | undefined
  repo?: string | undefined
  socketRegistry: boolean
}

const USAGE =
  'Usage: trusted-publisher-browser.mts read|apply [<pkg>…] ' +
  '[--socket-registry] [--live] [--repo <owner/name>] [--profile-dir <dir>]'

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
  let live = false
  let profileDir: string | undefined
  let repo: string | undefined
  let socketRegistry = false
  const packages: string[] = []
  for (let i = 1, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--live') {
      live = true
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
  return { live, mode, packages, profileDir, repo, socketRegistry }
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
        `${args.live ? ' [live]' : ' [dry-run]'}`,
    )
    const results: ApplyResult[] = []
    for (let i = 0, { length } = packages; i < length; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- serial per-package applies share one page session.
      const result = await applyOne(session.page, packages[i]!, {
        live: args.live,
        repoOverride: args.repo,
      })
      if (result.status === 'failed' || result.status === 'skipped') {
        logger.error(`${result.pkg}: ${result.status} — ${result.detail}`)
      }
      results.push(result)
    }
    logger.log('')
    logger.log(formatApplySummary(results, { live: args.live }))
    if (results.some(r => r.status === 'failed')) {
      process.exitCode = 1
    }
  } finally {
    await session.close()
  }
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not launch a browser.
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
