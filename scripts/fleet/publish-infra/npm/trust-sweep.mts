/**
 * @file Bulk trusted-publisher sweep over `npm trust` — the registry API
 *   lane. The browser driver cannot WRITE these settings anymore: npm's bot
 *   management blocks state-changing transactions from a CDP-driven browser
 *   (saves silently never land; observed 2026-07-31, 132/132 failed), and
 *   the access-page challenges carry no cooldown opt-in. `npm trust` wraps
 *   the documented registry endpoints, is designed for bulk loops, and its
 *   web-2FA flow DOES carry the cooldown checkbox — so the sweep runs
 *   unchallenged inside the operator's approval window and the PTY wrapper
 *   re-opens the browser when the window lapses.
 *   The law per @socketregistry package matches the shape the browser plan
 *   derived: github · file npm-publish.yml · repo SocketDev/socket-registry ·
 *   environment npm-publish · permissions createPackage +
 *   createStagedPackage. The create endpoint 409s on an existing config, so
 *   a stale config (the dead `_local-not-for-reuse-provenance.yml` one-off)
 *   is REVOKED first — delete-and-recreate is the API's own contract, and
 *   deleting the stale reference is the point.
 *   Dry-run by default; `--drive` performs revoke + create. Fail-soft per
 *   package, 2s spacing (the npm-trust docs' rate-limit guidance), summary
 *   at the end, non-zero exit if anything failed. Verification is the
 *   registry's own answer: a post-create `npm trust list` must echo the law.
 *   Usage: node scripts/fleet/publish-infra/npm/trust-sweep.mts
 *   [<pkg>…] [--socket-registry] [--drive]
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { extractNpmAuthUrl } from '../../npm-web-auth.mts'
import { expectedRepositoryFor } from '../../check/trusted-publishers-match-source.mts'
import { logger, runCapture } from '../shared.mts'
import { npmScratchCwd } from './shared.mts'
import { sleep } from './browser-session.mts'
import { expandSocketRegistryWorklist } from './trusted-publisher-browser.mts'

// The fleet law for @socketregistry packages, stated once.
const LAW = {
  environment: 'npm-publish',
  file: 'npm-publish.yml',
  permissions: ['createPackage', 'createStagedPackage'],
  repository: 'SocketDev/socket-registry',
  type: 'github',
} as const

const PACE_MS = 2000

interface TrustConfig {
  environment?: string | undefined
  file?: string | undefined
  id?: string | undefined
  permissions?: string[] | undefined
  repository?: string | undefined
  type?: string | undefined
}

type SweepStatus = 'applied' | 'conforms' | 'failed' | 'planned'

interface SweepResult {
  detail?: string | undefined
  pkg: string
  status: SweepStatus
}

/**
 * Whether an existing config already IS the law — the conforming no-op that
 * makes the sweep idempotent and re-runnable after partial failures.
 */
export function conformsToLaw(
  config: TrustConfig,
  repository: string,
): boolean {
  const perms = [...(config.permissions ?? [])].toSorted()
  const wanted = [...LAW.permissions].toSorted()
  return (
    config.type === LAW.type &&
    config.file === LAW.file &&
    config.repository === repository &&
    config.environment === LAW.environment &&
    perms.length === wanted.length &&
    perms.every((p, i) => p === wanted[i])
  )
}

// The PTY auth wrapper: `npm trust` create/revoke are 2FA-gated, and the
// wrapper opens the browser when the cooldown window lapses. Resolved
// relative to THIS file so the sweep works from any cwd.
const AUTH_WRAPPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../npm-web-auth.mts',
)

async function npmTrust(
  args: string[],
): Promise<{ code: number; stdout: string }> {
  // Through the wrapper for the 2FA-gated writes; scratch cwd dodges the
  // repo's devEngines pnpm veto.
  return await runCapture(
    process.execPath,
    [AUTH_WRAPPER, 'trust', ...args],
    npmScratchCwd(),
  )
}

/**
 * Raised when the trust API refuses AUTH — `npm trust` demands a 2FA-fresh
 * session even for reads, and outside the cooldown window every call 401s.
 * Fail CLOSED and stop the sweep: classifying a 401 as "(no config)" is the
 * unauthenticated-reads-as-empty trap (it made a whole audit report
 * "132 planned / no config" against a registry that was fully configured).
 */
export class TrustAuthDiedError extends Error {}

async function trustList(pkg: string): Promise<TrustConfig | undefined> {
  const { code, stdout } = await runCapture(
    'npm',
    ['trust', 'list', pkg, '--json'],
    npmScratchCwd(),
  )
  // FAIL CLOSED on ANY error envelope. The auth failures keep changing
  // costume — E401 "must be logged in" when the token dies, EOTP "requires a
  // one-time password" when only the 2FA-fresh window lapses — and each new
  // phrasing that slips through reads as "(no config)", producing an audit
  // that says 132 unconfigured against a fully configured registry (happened
  // TWICE, 2026-07-31). Only a clean exit parses; a genuinely unconfigured
  // package is the clean-exit-without-config shape, never an error.
  const jsonStart = stdout.indexOf('{')
  const parsed =
    jsonStart === -1
      ? undefined
      : (() => {
          try {
            return JSON.parse(stdout.slice(jsonStart)) as TrustConfig & {
              error?: { authUrl?: string | undefined } | undefined
            }
          } catch {
            return undefined
          }
        })()
  if (code !== 0 || parsed?.error) {
    const authUrl = parsed?.error?.authUrl
    throw new TrustAuthDiedError(
      `npm trust list ${pkg} refused (exit ${code}) — auth or 2FA window is stale.\n` +
        (authUrl ? `  Approve here (expires in minutes): ${authUrl}\n` : '') +
        '  Fix: re-approve auth, then re-run — the sweep is idempotent.',
    )
  }
  return parsed
}

/**
 * Reopen the 2FA-fresh window MID-RUN: hold a live PTY-wrapped write (the
 * one shape npm's cooldown actually honors — approving a dead URL grants
 * nothing; a waiting command completing through the approval does), surface
 * its auth URL loudly for the operator, and block until they approve. The
 * windows are short and each one used to cost an abort + a full re-walk;
 * in-flow reopening turns N aborted runs into one run with N approvals.
 * Returns true when the window reopened (the wrapped write exited — an E409
 * on an already-configured anchor package is the expected success shape).
 */
async function reopenAuthWindow(
  anchorPkg: string,
  repository: string,
): Promise<boolean> {
  logger.log('')
  logger.log(
    `2FA window lapsed — reopening with a live waiting write on ${anchorPkg}.`,
  )
  return await new Promise<boolean>(resolve => {
    const child = spawn(
      process.execPath,
      [
        AUTH_WRAPPER,
        'trust',
        'github',
        anchorPkg,
        '--file',
        LAW.file,
        '--repo',
        repository,
        '--env',
        LAW.environment,
        '--allow-publish',
        '--allow-stage-publish',
        '--yes',
      ],
      { cwd: npmScratchCwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    void child.catch(() => undefined)
    let buffer = ''
    let announced = false
    const watch = (chunk: Buffer) => {
      if (announced) {
        return
      }
      buffer += chunk.toString('utf8')
      const url = extractNpmAuthUrl(buffer)
      if (url) {
        announced = true
        logger.log(`APPROVE HERE (expires in minutes): ${url}`)
        logger.log('Tick the cooldown box — the sweep resumes on approval.')
      }
    }
    child.process.stdout?.on('data', watch)
    child.process.stderr?.on('data', watch)
    child.process.on('error', () => resolve(false))
    // A reopen only happened if npm actually OFFERED the web-auth flow — a
    // dead token E401s immediately with no URL, and counting that exit as
    // success spun the reopen budget 12 times against a wall (2026-07-31).
    // No URL means no window: the fix is a LOGIN (the wrapper's pnpm lane +
    // token bridge), not another write.
    child.process.on('exit', () => resolve(announced))
  })
}

/**
 * Sweep one package to the law: conforming configs no-op; a stale config is
 * revoked by id, the law created, and the registry re-read must echo it —
 * success is the registry's answer, never the exit code alone.
 */
export async function sweepOne(
  pkg: string,
  config: { drive: boolean; repository?: string | undefined },
): Promise<SweepResult> {
  const cfg = { __proto__: null, ...config } as typeof config
  // The file/env/permission law is fleet-constant; only the repository varies
  // by where the package lives. DERIVE it from the package's own packument
  // rather than assuming the monorepo: most `@socketregistry/*` packages ship
  // from socket-registry, but not all — packageurl-js has its own repo, and
  // assuming otherwise writes a binding whose repository claim never matches,
  // which is the silent-404 shape this tooling exists to repair. An explicit
  // --repo still wins; LAW is the last resort, for a name with no usable
  // GitHub url in its packument because it is not published yet.
  const repository =
    cfg.repository ?? (await expectedRepositoryFor(pkg)) ?? LAW.repository
  try {
    const current = await trustList(pkg)
    if (current && conformsToLaw(current, repository)) {
      return { pkg, status: 'conforms' }
    }
    if (!cfg.drive) {
      const from = current
        ? `${current.file ?? '(none)'} / env ${current.environment ?? '(empty)'}`
        : '(no config)'
      return {
        detail: `[dry-run] ${from} -> ${LAW.file} @ ${repository} / env ${LAW.environment}`,
        pkg,
        status: 'planned',
      }
    }
    if (current?.id) {
      const revoke = await npmTrust(['revoke', pkg, `--id=${current.id}`])
      if (revoke.code !== 0) {
        return { detail: `revoke exited ${revoke.code}`, pkg, status: 'failed' }
      }
    }
    const create = await npmTrust([
      'github',
      pkg,
      '--file',
      LAW.file,
      '--repo',
      repository,
      '--env',
      LAW.environment,
      '--allow-publish',
      '--allow-stage-publish',
      '--yes',
    ])
    if (create.code !== 0) {
      return { detail: `create exited ${create.code}`, pkg, status: 'failed' }
    }
    const echoed = await trustList(pkg)
    if (!echoed || !conformsToLaw(echoed, repository)) {
      return {
        detail: 'registry re-read does not echo the law after create',
        pkg,
        status: 'failed',
      }
    }
    return { pkg, status: 'applied' }
  } catch (e) {
    if (e instanceof TrustAuthDiedError) {
      // Auth death is a SWEEP-level stop, never a per-package failure — 89
      // cascading "failed" rows from one lapsed window is noise that buries
      // the one actionable fact.
      throw e
    }
    return { detail: errorMessage(e), pkg, status: 'failed' }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const drive = argv.includes('--drive')
  const socketRegistry = argv.includes('--socket-registry')
  const repoFlagAt = argv.indexOf('--repo')
  const repoOverride = repoFlagAt !== -1 ? argv[repoFlagAt + 1] : undefined
  const packages = argv.filter(
    (a, i) => !a.startsWith('--') && i !== repoFlagAt + 1,
  )
  if (socketRegistry) {
    packages.push(...(await expandSocketRegistryWorklist()))
  }
  if (packages.length === 0) {
    logger.fail('no packages: pass names or --socket-registry.')
    process.exitCode = 1
    return
  }
  logger.log(
    `npm trust sweep — ${packages.length} package(s)${drive ? ' [drive]' : ' [dry-run]'}`,
  )
  const counts: Record<SweepStatus, number> = {
    applied: 0,
    conforms: 0,
    failed: 0,
    planned: 0,
  }
  // In-flow window reopens are bounded: each costs the operator one browser
  // approval, and past this many something else is wrong.
  const MAX_WINDOW_REOPENS = 12
  let reopens = 0
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    let result: SweepResult
    try {
      // eslint-disable-next-line no-await-in-loop -- serial by design: the npm-trust docs' rate-limit guidance.
      result = await sweepOne(pkg, { drive, repository: repoOverride })
    } catch (e) {
      if (e instanceof TrustAuthDiedError) {
        reopens += 1
        if (reopens > MAX_WINDOW_REOPENS) {
          logger.fail(e.message)
          logger.log(
            `Stopped at ${pkg} (${i}/${length} done) after ${MAX_WINDOW_REOPENS} ` +
              'window reopens — something beyond window expiry is wrong.',
          )
          process.exitCode = 1
          return
        }
        // eslint-disable-next-line no-await-in-loop -- the reopen must complete before the walk resumes.
        const reopened = await reopenAuthWindow(
          pkg,
          repoOverride ?? LAW.repository,
        )
        if (!reopened) {
          logger.fail(e.message)
          logger.log(
            'No web-auth flow was offered — the token itself is dead, not ' +
              'just the 2FA window. Fix: node scripts/fleet/npm-web-auth.mts ' +
              'login (the pnpm lane bridges the token to npm), then re-run.',
          )
          process.exitCode = 1
          return
        }
        i -= 1
        continue
      }
      throw e
    }
    counts[result.status] += 1
    const line = `${result.pkg}: ${result.status}${result.detail ? ` — ${result.detail}` : ''}`
    if (result.status === 'failed') {
      logger.fail(line)
    } else {
      logger.log(line)
    }
    if (i < length - 1) {
      // eslint-disable-next-line no-await-in-loop -- pacing between registry writes.
      await sleep(PACE_MS)
    }
  }
  logger.log('')
  logger.log(
    `Trust-sweep ${drive ? 'drive' : 'dry-run'} summary: ${counts.applied} applied, ` +
      `${counts.planned} planned, ${counts.conforms} conforming, ${counts.failed} failed.`,
  )
  if (counts.failed > 0) {
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
