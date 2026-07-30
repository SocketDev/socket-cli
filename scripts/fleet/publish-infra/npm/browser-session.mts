/**
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
 *   - ONE launch shape: `launchPersistentContext(profileDir, { channel, headless:
 *     false })` and NOTHING else. No `args` array, no `chromiumSandbox` toggle,
 *     no automation flags. Playwright adds `--no-sandbox` by default; that
 *     banner is cosmetic and is NOT a sign-in blocker, so forcing the sandbox
 *     only diverges from the shape known to work.
 *   - SINGLE instance. A second Chrome on the same profile forces an ephemeral
 *     session, so a held profile is refused by name rather than silently
 *     producing a session that cannot persist.
 *   - The only auth signal is npm's own `/-/whoami`; the only auth failure
 *     reported is "signed out".
 *   - A human-verification challenge is PAUSED for the operator with a visible
 *     elapsed/remaining countdown, NEVER retried on a backoff ladder: a blind
 *     retry against a bot challenge earns a rate limit, which then masquerades
 *     as a broken session. Nothing is written while a challenge is outstanding.
 *     `scripts/fleet/check/playwright-launches-are-sanctioned.mts` enforces the
 *     launch rules across the tree, so a new tool cannot re-derive its own.
 */

import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { chromium } from 'playwright-core'
import type { BrowserContext, Page } from 'playwright-core'

import { logger } from '../shared.mts'

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
 * The signed-in npm username via `/-/whoami`, or '' when the session is
 * signed out. The ONLY auth signal any consumer reads.
 */
export async function resolveNpmUser(page: Page): Promise<string> {
  const { body, status } = await fetchInPage(
    page,
    `${NPM_ORIGIN}/-/whoami`,
    'application/json',
  )
  if (status !== 200) {
    return ''
  }
  try {
    const parsed = JSON.parse(body) as { username?: unknown | undefined }
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
 * Human-readable progress line for a PAUSED challenge — elapsed and
 * remaining seconds, so the wait is visible rather than a silent hang. Pure —
 * exported for tests.
 */
export function formatChallengeWait(config: {
  budgetMs: number
  elapsedMs: number
  url: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const elapsed = Math.round(cfg.elapsedMs / 1000)
  const remaining = Math.max(
    0,
    Math.round((cfg.budgetMs - cfg.elapsedMs) / 1000),
  )
  return (
    `Waiting on human verification at ${cfg.url} — ${elapsed}s elapsed, ` +
    `${remaining}s before this run gives up. Solve the challenge in the ` +
    'Chrome window; the run resumes on its own.'
  )
}

/**
 * Failure block for a challenge that outlasted its budget, in What / Where /
 * Saw vs wanted / Fix order. Pure — exported for tests.
 */
export function formatChallengeTimeout(config: {
  budgetMs: number
  url: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  return [
    'What: npm kept serving a human-verification challenge, so the run stopped rather than retrying into a rate limit.',
    `Where: ${cfg.url}`,
    `Saw: the challenge was still unsolved after ${Math.round(cfg.budgetMs / 1000)}s of waiting.`,
    'Wanted: the challenge cleared in the Chrome window so the signed-in session can read the page.',
    'Fix: solve the "Just a moment…" check in the Chrome window, then re-run. Nothing was changed, so a re-run is safe.',
  ].join('\n')
}

/**
 * One tick of the challenge PAUSE, shared by every consumer's read loop: on
 * the first tick bring the challenge page to the front for the operator, then
 * keep the cooldown opt-in ticked, print the countdown, and sleep. Throws the
 * challenge-timeout block once the budget is spent — the caller therefore
 * never needs a retry ladder.
 */
export async function pauseForChallenge(
  page: Page,
  config: {
    announced: boolean
    budgetMs?: number | undefined
    elapsedMs: number
    label: string
    pollMs?: number | undefined
    url: string
  },
): Promise<{ announced: true }> {
  const cfg = { __proto__: null, ...config } as typeof config
  const budgetMs = cfg.budgetMs ?? CHALLENGE_BUDGET_MS
  if (cfg.elapsedMs >= budgetMs) {
    throw new Error(formatChallengeTimeout({ budgetMs, url: cfg.url }))
  }
  if (!cfg.announced) {
    logger.warn(
      `Human verification interjected on ${cfg.label}. This run is PAUSED — solve it in the Chrome window.`,
    )
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.bringToFront().catch(() => {})
  }
  await optIntoChallengeCooldown(page)
  logger.log(
    formatChallengeWait({ budgetMs, elapsedMs: cfg.elapsedMs, url: cfg.url }),
  )
  await sleep(cfg.pollMs ?? CHALLENGE_POLL_MS)
  return { announced: true }
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
    // The sanctioned shape: channel + headedness, nothing else. No args
    // array, no sandbox toggle. See the file header.
    (cfg =>
      chromium.launchPersistentContext(cfg.profileDir, {
        channel,
        headless: cfg.headless,
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
