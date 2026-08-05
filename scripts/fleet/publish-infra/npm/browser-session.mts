/*
 * @file THE sanctioned npm browser session for every fleet tool that drives
 *   npmjs.com — one durable profile, one launch shape, one sign-in contract.
 *   Ported from socket-registry's proven configurator
 *   (`scripts/npm/configure-staged-publishing-browser.mts`), which
 *   mass-configured npm package settings across that registry.
 *   Every rule below exists because of the 2026-07-29 sign-in-loop incident:
 *   an npm sign-in inside a freshly invented per-tool profile looped forever —
 *   credentials and OTP succeeded, then npmjs bounced straight back to
 *   signed-out — and the debugging thrash added a per-tool profile, a sandbox
 *   toggle, and a challenge retry ladder, each of which made things worse.
 *
 *   - NO scripted login, ever. The operator signs in ONCE in the headed window;
 *     the profile persists, so it is a per-machine step. No password, OTP, or
 *     cookie passes through this process.
 *   - ONE durable profile ({@link DEFAULT_PROFILE_DIR}) shared by every npm
 *     browser tool, so an operator signed in for the publish gate is signed in
 *     everywhere. A second per-tool profile means a second sign-in.
 *   - ONE launch shape: `launchPersistentContext(profileDir, { channel,
 *     chromiumSandbox: true, headless, ignoreDefaultArgs:
 *     ['--enable-automation', '--use-mock-keychain'] })` and NOTHING else. No
 *     `args` array, and exactly those two ignored Playwright defaults:
 *     `--enable-automation` sets `navigator.webdriver = true` — the standard
 *     bot signal — and with it a fresh-profile npmjs.com login + OTP was
 *     observed (2026-07-30) bouncing straight back to the signed-out landing
 *     page, the session dropped live by the site (keychain corruption ruled
 *     out by profile wipes). `--use-mock-keychain` writes a cookie store a
 *     bare Chrome launch of the same profile can neither read nor add to, so
 *     one stray manual launch would poison the session for every tool run.
 *     `chromiumSandbox: true` is REQUIRED, not optional: Playwright defaults
 *     the sandbox OFF and injects `--no-sandbox` itself, and current Chrome
 *     refuses that flag outright (observed 2026-07-30 — the window opens and
 *     the session is unusable). Sandbox ON is the only launch real Chrome
 *     accepts.
 *   - SINGLE instance. A second Chrome on the same profile forces an ephemeral
 *     session, so a held profile is refused by name rather than silently
 *     producing a session that cannot persist.
 *   - The only auth signal is npm's own `/-/whoami` on the WEBSITE origin,
 *     and the BODY decides — never the HTTP status. www.npmjs.com removed
 *     the route (observed 2026-07-30): it answers 404 whose spiferack
 *     envelope still carries the session — `user.name` a string when signed
 *     in, `user: null` when signed out. Requiring a 200 reads every live
 *     session as signed out until the sign-in timeout, which presents as
 *     "login does not persist". The only auth failure reported is "signed
 *     out".
 *   - A human-verification challenge is PAUSED for the operator, never
 *     retried on a ladder; {@link runChallengeAware} owns that rhythm for
 *     every consumer. See `docs/agents.md/fleet/npm-anti-bot-rhythm.md`.
 *     `scripts/fleet/check/playwright-launches-are-sanctioned.mts` enforces the
 *     launch rules across the tree, so a new tool cannot re-derive its own.
 */

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { chromium } from 'playwright-core'
import type { BrowserContext, Page } from 'playwright-core'

import { clearChallengeGate, tickChallengeGate } from './challenge-gate.mts'
import type { ChallengePauseUx } from './challenge-gate.mts'
import { logger } from '../shared.mts'

export {
  formatChallengeTimeout,
  formatChallengeWait,
  NPM_CHALLENGE_GATE_EVENT_PATH,
} from './challenge-gate.mts'
export type { ChallengePauseUx } from './challenge-gate.mts'

export const NPM_ORIGIN = 'https://www.npmjs.com'

/**
 * The ONE durable Chrome profile every npm browser tool shares. It lives in
 * the OS config dir, never in the repo tree. Historical directory name kept
 * so profiles already signed in keep working.
 */
export const DEFAULT_PROFILE_DIR = path.join(
  os.homedir(),
  '.config',
  'socket-wheelhouse',
  'staged-browser-profile',
)

// npm OAuth / 2FA is human-paced.
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const SIGN_IN_POLL_MS = 2000

/**
 * A human-verification challenge is solved by a PERSON, so the budget is
 * generous and the poll is slow. This is a pause, not a retry ladder.
 */
export const CHALLENGE_BUDGET_MS = 10 * 60_000
export const CHALLENGE_POLL_MS = 5000

/**
 * The npm challenge page's per-IP cooldown opt-in. Ticking it lets a BATCH of
 * publish/trust operations ride one approval instead of re-challenging per
 * operation. Fail-soft by design — never load-bearing.
 */
export const COOLDOWN_OPTIN_SELECTOR = 'input[name="didOptForCooldown"]'

// Chrome's profile lock. Present while an instance holds the profile; a
// crashed instance can leave it behind, which is why the guard reports it as
// "possibly stale" rather than asserting a live holder.
const SINGLETON_LOCK = 'SingletonLock'

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Run a same-origin fetch in the page's MAIN world and return status + raw
 * body. The page's own cookies authenticate it, so no credential is read,
 * copied, or logged by this process. A destroyed execution context from a
 * mid-navigation race yields status 0, which callers treat as retryable
 * rather than fatal.
 */
export async function fetchInPage(
  page: Page,
  url: string,
  accept: string,
): Promise<{ body: string; status: number }> {
  try {
    return await page.evaluate(
      async ({ acceptHeader, fetchUrl }) => {
        // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- runs in the npm page's MAIN world via page.evaluate; the lib httpRequest is unavailable there and only the page's cookies authenticate this request.
        const r = await fetch(fetchUrl, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: acceptHeader, 'x-spiferack': '1' },
          method: 'GET',
        })
        return { body: await r.text(), status: r.status }
      },
      { acceptHeader: accept, fetchUrl: url },
    )
  } catch {
    return { body: '', status: 0 }
  }
}

/**
 * The signed-in npm username via the website origin's `/-/whoami`, or ''
 * when the session is signed out. The ONLY auth signal any consumer reads.
 * The BODY decides, never the status: www.npmjs.com removed the route
 * (observed 2026-07-30) and answers HTTP 404 whose spiferack envelope still
 * carries the session — `{"message":"Route not found!","user":{"name":…}}`
 * signed in, `"user":null` signed out. The registry-style
 * `{"username":…}` shape is still accepted in case the route ever serves
 * again, with no status requirement either. A destroyed execution context
 * (status 0) has an empty body and reads as signed out, which callers
 * already treat as retryable.
 */
export async function resolveNpmUser(page: Page): Promise<string> {
  const { body } = await fetchInPage(
    page,
    `${NPM_ORIGIN}/-/whoami`,
    'application/json',
  )
  try {
    const parsed = JSON.parse(body) as {
      user?: { name?: unknown | undefined } | null | undefined
      username?: unknown | undefined
    }
    if (typeof parsed.user?.name === 'string') {
      return parsed.user.name
    }
    return typeof parsed.username === 'string' ? parsed.username : ''
  } catch {
    return ''
  }
}

/**
 * Tick npm's challenge-cooldown opt-in when the challenge page offers it, so
 * a batch of operations rides ONE approval. Fail-soft: any error is swallowed
 * and the flow proceeds exactly as before.
 */
export async function optIntoChallengeCooldown(page: Page): Promise<void> {
  try {
    const box = page.locator(COOLDOWN_OPTIN_SELECTOR).first()
    if ((await box.count()) > 0 && !(await box.isChecked())) {
      await box.check({ timeout: 2000 })
      logger.log(
        'Ticked the npm challenge-cooldown opt-in — publish/trust operations skip re-challenge for 5 minutes.',
      )
    }
  } catch {}
}

/**
 * One tick of the challenge PAUSE, shared by every consumer's read loop. The
 * operator UX lives in `challenge-gate.mts` and is tracked per page + URL, so
 * it survives re-entry from a fresh {@link runChallengeAware} call: ONE 🖐
 * HUMAN GATE block and one desktop ping when a pause starts, a progress line
 * at most every 30s while it holds, the gate event file kept current, and an
 * elapsed counter anchored to the pause itself — never to the call that
 * happens to observe it. On a pause's first tick the challenge page is
 * brought to the front; every tick keeps the cooldown opt-in ticked and
 * sleeps. Throws the challenge-timeout block once the budget is spent — the
 * caller therefore never needs a retry ladder. `announced` reports what the
 * CALLING loop has printed; the cross-call tracker is authoritative, which is
 * what stops a re-entered loop from re-announcing the same pause.
 */
export async function pauseForChallenge(
  page: Page,
  config: {
    announced: boolean
    budgetMs?: number | undefined
    elapsedMs: number
    label: string
    pollMs?: number | undefined
    rerunHint?: string | undefined
    url: string
    ux?: ChallengePauseUx | undefined
  },
): Promise<{ announced: true }> {
  const cfg = { __proto__: null, ...config } as typeof config
  const tick = await tickChallengeGate(page, {
    budgetMs: cfg.budgetMs ?? CHALLENGE_BUDGET_MS,
    fallbackElapsedMs: cfg.elapsedMs,
    pkg: cfg.label,
    rerunHint: cfg.rerunHint,
    url: cfg.url,
    ux: cfg.ux,
  })
  if (tick.expiredMessage !== undefined) {
    throw new Error(tick.expiredMessage)
  }
  if (tick.freshPause) {
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.bringToFront().catch(() => {})
  }
  await optIntoChallengeCooldown(page)
  await sleep(cfg.pollMs ?? CHALLENGE_POLL_MS)
  return { announced: true }
}

/**
 * One attempt's outcome inside {@link runChallengeAware}: a finished value, a
 * human-verification challenge to pause on, or an immediate re-attempt for a
 * transient race the operation already slept through. `runChallengeAware`
 * returns on `done`, pauses then re-attempts on `challenge`, and re-attempts
 * without pausing on `retry`.
 */
export type ChallengeAwareStep<T> =
  | { kind: 'challenge' }
  | { kind: 'done'; value: T }
  | { kind: 'retry' }

/**
 * The shared npm anti-bot rhythm: run `operation`, and each time it reports a
 * human-verification challenge, PAUSE for the operator (visible countdown,
 * cooldown opt-in ticked, budget enforced) through {@link pauseForChallenge},
 * then re-attempt — bounded by the budget, NEVER a blind retry ladder, which
 * against a live challenge earns a rate limit that masquerades as a broken
 * session. The `operation` owns what it does and how it classifies its own
 * result; this helper owns only the pause-then-retry orchestration. A `done`
 * step returns its value; a `retry` step (a transient race the operation
 * already slept through) loops without pausing; a `challenge` step pauses.
 * The operation throws for its own terminal failures, which propagate out. The
 * timings are injectable so tests run in milliseconds. See
 * `docs/agents.md/fleet/npm-anti-bot-rhythm.md`.
 */
export async function runChallengeAware<T>(
  page: Page,
  operation: () => Promise<ChallengeAwareStep<T>>,
  config: {
    budgetMs?: number | undefined
    label: string
    pollMs?: number | undefined
    rerunHint?: string | undefined
    url: string
    ux?: ChallengePauseUx | undefined
  },
): Promise<T> {
  const cfg = { __proto__: null, ...config } as typeof config
  const started = Date.now()
  let announced = false
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- serial: one live page solves one challenge at a time, each attempt awaiting the last.
    const step = await operation()
    if (step.kind === 'done') {
      // eslint-disable-next-line no-await-in-loop -- one await on the way out: a live pause is marked cleared before the value returns.
      await clearChallengeGate(page, {
        pkg: cfg.label,
        url: cfg.url,
        ux: cfg.ux,
      })
      return step.value
    }
    if (step.kind === 'retry') {
      continue
    }
    // eslint-disable-next-line no-await-in-loop -- serial pause while the operator solves the challenge.
    const pause = await pauseForChallenge(page, {
      announced,
      budgetMs: cfg.budgetMs,
      elapsedMs: Date.now() - started,
      label: cfg.label,
      pollMs: cfg.pollMs,
      rerunHint: cfg.rerunHint,
      url: cfg.url,
      ux: cfg.ux,
    })
    announced = pause.announced
  }
}

/**
 * Hand the window to the operator until npm reports a signed-in session. No
 * credential is typed by this process and the profile persists, so this is a
 * once-per-machine step.
 */
export async function waitForNpmSignIn(
  page: Page,
  profileDir: string,
): Promise<string> {
  await page.goto(NPM_ORIGIN, { waitUntil: 'domcontentloaded' }).catch(() => {})
  const deadline = Date.now() + SIGN_IN_TIMEOUT_MS
  let announced = false
  for (;;) {
    // The challenge page with the cooldown box can appear at any poll tick
    // while the operator works through sign-in/2FA; keep it ticked.
    // eslint-disable-next-line no-await-in-loop -- serial poll while the operator signs in.
    await optIntoChallengeCooldown(page)
    // eslint-disable-next-line no-await-in-loop -- serial poll while the operator signs in.
    const user = await resolveNpmUser(page)
    if (user) {
      return user
    }
    if (!announced) {
      logger.log('Sign in to npm in the Chrome window; waiting…')
      announced = true
    }
    if (Date.now() >= deadline) {
      throw new Error(
        [
          'What: the run needs a signed-in npm session and never got one.',
          `Where: the Chrome profile at ${profileDir}`,
          `Saw: /-/whoami reported no user after ${SIGN_IN_TIMEOUT_MS / 1000}s.`,
          'Wanted: a signed-in npmjs.com session in that profile.',
          'Fix: re-run and complete sign-in, including 2FA, in the Chrome window. The profile persists, so this is a one-time step.',
        ].join('\n'),
      )
    }
    // eslint-disable-next-line no-await-in-loop -- serial poll interval.
    await sleep(SIGN_IN_POLL_MS)
  }
}

/**
 * The pid a Chrome SingletonLock symlink encodes, or undefined when the
 * target has no readable `<host>-<pid>` shape. Pure; exported for tests.
 */
export function parseSingletonLockPid(target: string): number | undefined {
  const match = /-(\d+)$/.exec(target)
  if (!match) {
    return undefined
  }
  const pid = Number(match[1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

// Chrome's three per-profile singleton artifacts. A SIGTERM'd or crashed
// Chrome leaves them behind, and the next launch then prints "Opening in
// existing browser session" and exits — a phantom holder that burned ~30
// minutes of launch bounces (2026-07-31). When the lock's pid is dead, the
// files are trash, not a tenant.
const SINGLETON_ARTIFACTS = [
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
]

/**
 * Remove stale singleton artifacts when NO live process holds the lock:
 * reads the SingletonLock symlink's `<host>-<pid>` target, probes the pid,
 * and clears all three artifacts if it is dead or unparseable. A live pid
 * leaves everything in place for {@link profileInUseRefusal} to refuse
 * honestly. Returns true when a stale set was cleared.
 */
export async function clearStaleSingletons(
  profileDir: string,
): Promise<boolean> {
  const lockPath = path.join(profileDir, SINGLETON_LOCK)
  let target: string
  try {
    target = await fs.readlink(lockPath)
  } catch {
    return false
  }
  const pid = parseSingletonLockPid(target)
  if (pid !== undefined) {
    try {
      process.kill(pid, 0)
      return false
    } catch {
      // Dead pid — the lock is stale; fall through to the cleanup.
    }
  }
  for (let i = 0, { length } = SINGLETON_ARTIFACTS; i < length; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- three tiny unlinks, sequential by choice.
    await safeDelete(path.join(profileDir, SINGLETON_ARTIFACTS[i]!))
  }
  return true
}

/**
 * The refusal for a profile another Chrome already holds, or undefined when
 * the profile is free to use. A second instance on one profile forces an
 * EPHEMERAL session — the sign-in appears to succeed and then evaporates — so
 * this refuses by name instead. The caller answers the lock-existence
 * question, which keeps this pure and testable.
 */
export function profileInUseRefusal(config: {
  lockHeld: boolean
  profileDir: string
}): string | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!cfg.lockHeld) {
    return undefined
  }
  return [
    'What: another Chrome instance is holding the npm browser profile, so this run stopped before launching a second one.',
    `Where: ${path.join(cfg.profileDir, SINGLETON_LOCK)}`,
    'Saw: the profile lock present.',
    'Wanted: sole use of the profile — a second instance forces an ephemeral session whose sign-in cannot persist.',
    `Fix: quit the Chrome window using this profile, then re-run. If no window is open, the lock is stale from a crash: delete ${SINGLETON_LOCK} in that directory and re-run.`,
  ].join('\n')
}

/**
 * The injectable options every npm browser session opener shares. `launch`
 * lets tests hand in a fake BrowserContext so no real Chrome ever starts;
 * `scope` skips the sign-in wait when the caller already knows the user.
 */
export interface NpmBrowserSessionOptions {
  headless?: boolean | undefined
  launch?:
    | ((config: {
        headless: boolean
        profileDir: string
      }) => Promise<BrowserContext>)
    | undefined
  profileDir?: string | undefined
  scope?: string | undefined
}

/**
 * A live signed-in npm browser session. The caller MUST call `close()`.
 */
export interface NpmBrowserSession {
  close: () => Promise<void>
  page: Page
  user: string
}

/**
 * Launch headed system Chrome on the shared durable profile and wait for a
 * signed-in session. Headed by design: the operator signs in here and solves
 * any human verification here, neither of which a headless run can do. THE
 * only sanctioned `launchPersistentContext` call in the fleet's npm tooling —
 * see the file header for why each rule exists.
 */
export async function openNpmBrowserSession(
  options?: NpmBrowserSessionOptions | undefined,
): Promise<NpmBrowserSession> {
  const {
    headless = false,
    launch,
    profileDir = DEFAULT_PROFILE_DIR,
    scope,
  } = { __proto__: null, ...options } as NonNullable<typeof options>
  await fs.mkdir(profileDir, { recursive: true })
  // Single-instance guard. Skipped when a fake `launch` is injected: a test
  // never touches a real profile, and the operator's own Chrome must not make
  // the suite fail.
  if (!launch) {
    // Heal a crashed holder first: a SIGTERM'd Chrome leaves its Singleton
    // artifacts behind, and launching against them prints "Opening in
    // existing browser session" and exits. Only a DEAD lock pid is cleaned;
    // a live one falls through to the refusal below.
    if (await clearStaleSingletons(profileDir)) {
      logger.log(
        'cleared stale Chrome singleton artifacts (their holder is dead) — proceeding.',
      )
    }
    const refusal = profileInUseRefusal({
      lockHeld: existsSync(path.join(profileDir, SINGLETON_LOCK)),
      profileDir,
    })
    if (refusal !== undefined) {
      throw new Error(refusal)
    }
  }
  // The browser channel defaults to system Chrome but is overridable
  // (SOCKET_BROWSER_CHANNEL=msedge / chromium / …) for a machine without
  // Chrome installed — playwright-core can't conjure a channel it has no
  // binary for, so the operator points it at one they do have.
  const channel = process.env['SOCKET_BROWSER_CHANNEL'] || 'chrome'
  const doLaunch =
    launch ??
    // The sanctioned shape: channel + sandbox ON + headedness + the two
    // ignored defaults below, nothing else. No args array. See the file
    // header.
    (cfg =>
      chromium.launchPersistentContext(cfg.profileDir, {
        channel,
        // REQUIRED. Playwright defaults the sandbox OFF and injects
        // --no-sandbox itself; current Chrome refuses that flag outright
        // (observed 2026-07-30), leaving the window open but the session
        // unusable. Sandbox ON is the only launch real Chrome accepts.
        chromiumSandbox: true,
        headless: cfg.headless,
        // Drop two Playwright defaults that break a REAL npm session.
        // --enable-automation sets navigator.webdriver = true, the standard
        // bot signal; with it, a fresh-profile npmjs.com login + OTP bounced
        // straight back to the signed-out landing page — the session dropped
        // live by the site (observed 2026-07-30; keychain corruption ruled
        // out by profile wipes). --use-mock-keychain writes a cookie store a
        // bare Chrome launch of the same profile can neither read nor add
        // to, so one stray manual launch would poison the session for every
        // tool run.
        ignoreDefaultArgs: ['--enable-automation', '--use-mock-keychain'],
      }))
  const context = await doLaunch({ headless, profileDir })
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    const user = scope || (await waitForNpmSignIn(page, profileDir))
    if (!user) {
      throw new Error('Could not resolve the signed-in npm user.')
    }
    return { close: () => context.close(), page, user }
  } catch (e) {
    await context.close()
    throw e
  }
}
