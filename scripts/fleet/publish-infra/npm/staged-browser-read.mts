/**
 * @file Browser-read staged-tarball passback for the publish gate. Drives
 *   system Chrome via playwright-core in a durable profile: the operator signs
 *   in to npmjs.com once (OAuth / 2FA in the window), then the SAME signed-in
 *   session reads `/settings/<scope>/staged-packages?format=json` — the staged
 *   view is session-only, invisible to the registry API — and downloads each
 *   staged tarball's bytes THROUGH that session. Those bytes + identities feed
 *   the Socket scan gate (`scan.mts`) so it scans exactly what npm has staged,
 *   without a registry token. Cloudflare interstitials are ridden out with the
 *   shared classifier + an exponential cooldown (never mis-parsed as JSON). The
 *   playwright I/O is isolated here; the pure parsers live in
 *   `staged-browser-parse.mts` and are unit-tested there.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { chromium } from 'playwright-core'
import type { BrowserContext, Page } from 'playwright-core'

import { logger } from '../shared.mts'
import {
  classifyStagedFetch,
  parseStagedPayload,
} from './staged-browser-parse.mts'
import type { StagedPayload, StagedTarball } from './staged-browser-parse.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

const NPM_ORIGIN = 'https://www.npmjs.com'

// Durable Chrome profile so the OAuth sign-in persists across gate runs — a
// separate profile from any other fleet browser tool.
const DEFAULT_PROFILE_DIR = path.join(
  os.homedir(),
  '.config',
  'socket-wheelhouse',
  'staged-browser-profile',
)

// Sign-in poll: npm OAuth / 2FA is human-paced, so poll up to this long.
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const SIGN_IN_POLL_MS = 2000

// Challenge backoff: 15s → 30s → 60s, matching the fleet cooldown ladder.
const CHALLENGE_MAX_ATTEMPTS = 4
const CHALLENGE_BASE_MS = 15_000
const CHALLENGE_MAX_MS = 60_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Run a same-origin fetch in the page's MAIN world (the page's cookies
// authenticate it) and return status + raw body text. Tolerant of a
// mid-navigation race: a destroyed execution context yields status 0, which
// the caller treats as not-ready / retryable, never fatal.
async function fetchInPage(
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

// Resolve the signed-in npm username via /-/whoami; '' when not signed in yet.
async function resolveNpmUser(page: Page): Promise<string> {
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
 * Npm's per-IP challenge cooldown opt-in: 2FA challenge pages carry a
 * "Do not challenge npm publish, npm trust operations from IP … for the next
 * 5 minutes" checkbox, input name `didOptForCooldown`. Ticking it before the
 * operator approves means a BATCH of publish/trust operations rides one
 * approval instead of re-challenging per operation. Fail-soft by design: the
 * box is a convenience, never load-bearing — any error is swallowed and the
 * flow proceeds exactly as before.
 */
export const COOLDOWN_OPTIN_SELECTOR = 'input[name="didOptForCooldown"]'

async function optIntoChallengeCooldown(page: Page): Promise<void> {
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

// Poll until the operator has signed in, or the budget elapses.
async function waitForSignIn(page: Page): Promise<string> {
  await page.goto(NPM_ORIGIN, { waitUntil: 'domcontentloaded' }).catch(() => {})
  const deadline = Date.now() + SIGN_IN_TIMEOUT_MS
  let logged = false
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
    if (!logged) {
      logger.log('Sign in to npm in the Chrome window; waiting…')
      logged = true
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Not signed in to npm within ${SIGN_IN_TIMEOUT_MS / 1000}s. Re-run and complete sign-in in the window.`,
      )
    }
    // eslint-disable-next-line no-await-in-loop -- serial poll interval.
    await sleep(SIGN_IN_POLL_MS)
  }
}

// Read the staged-packages payload with bounded Cloudflare-challenge backoff.
async function readStagedPayload(
  page: Page,
  scope: string,
  packageFilter: string | undefined,
): Promise<StagedPayload> {
  const url = `${NPM_ORIGIN}/settings/${encodeURIComponent(scope)}/staged-packages?format=json`
  let last = { body: '', status: 0 }
  for (let attempt = 1; attempt <= CHALLENGE_MAX_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- serial retry attempts by design.
    last = await fetchInPage(page, url, 'application/json')
    const state = classifyStagedFetch({ body: last.body, status: last.status })
    if (state === 'ok') {
      return parseStagedPayload(last.body, packageFilter)
    }
    // A status-0 result is fetchInPage's documented mid-navigation race from a
    // destroyed execution context, retryable exactly like a challenge. A
    // Cloudflare interstitial often surfaces this way because it navigates the
    // page before the challenge body is even readable. Retry both; only auth
    // and a real non-zero HTTP error are terminal.
    const isRace = last.status === 0
    const retryable = state === 'challenge' || isRace
    if (!retryable || attempt === CHALLENGE_MAX_ATTEMPTS) {
      if (state === 'auth') {
        throw new Error(
          `Staged-packages read needs sign-in (HTTP ${last.status}). Re-run and sign in.`,
        )
      }
      if (retryable) {
        throw new Error(
          'npm kept returning a Cloudflare challenge (or a mid-navigation ' +
            'race) for the staged-packages read after backoff. Clear the ' +
            '"Just a moment…" check in the Chrome window, then retry.',
        )
      }
      throw new Error(
        `Staged-packages read failed (HTTP ${last.status}). Re-run and sign in.`,
      )
    }
    // A pure navigation race clears almost immediately, so retry it fast; a
    // real challenge needs the full rate-limit cooldown ladder.
    const cooldown = isRace
      ? SIGN_IN_POLL_MS
      : Math.min(CHALLENGE_BASE_MS * 2 ** (attempt - 1), CHALLENGE_MAX_MS)
    logger.warn(
      `${isRace ? 'Navigation race' : 'Cloudflare challenge'} on the staged-packages read; retrying in ${cooldown / 1000}s (attempt ${attempt}/${CHALLENGE_MAX_ATTEMPTS}).`,
    )
    // eslint-disable-next-line no-await-in-loop -- serial cooldown between attempts.
    await sleep(cooldown)
  }
  // Unreachable: the loop returns or throws on every path.
  throw new Error('Staged-packages read exhausted its attempts.')
}

/**
 * Download one staged tarball's bytes through the signed-in page session (the
 * staged tarball URL is not publicly resolvable) and write them to a temp
 * file, returning its path. Returns undefined when the entry has no URL or the
 * fetch fails, so the gate can fall back to the registry-API download.
 */
export async function downloadStagedTarballInPage(
  page: Page,
  tarball: StagedTarball,
): Promise<string | undefined> {
  const url = tarball.tarballUrl
  if (!url) {
    return undefined
  }
  let base64: string
  try {
    base64 = await page.evaluate(async fetchUrl => {
      // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- runs in the npm page's MAIN world; only the page session can read the staged tarball.
      const r = await fetch(fetchUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!r.ok) {
        return ''
      }
      const buf = new Uint8Array(await r.arrayBuffer())
      let binary = ''
      for (let i = 0, { length } = buf; i < length; i += 1) {
        binary += String.fromCharCode(buf[i]!)
      }
      return btoa(binary)
    }, url)
  } catch (e) {
    logger.warn(
      `Could not read staged tarball for ${tarball.packageName}@${tarball.version} in the browser (${errorMessage(e)}).`,
    )
    return undefined
  }
  if (!base64) {
    return undefined
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-staged-tar-'))
  const file = path.join(dir, 'staged.tgz')
  await fs.writeFile(file, Buffer.from(base64, 'base64'))
  return file
}

/**
 * A live browser-read session: the staged tarballs plus the page + context.
 */
export interface StagedBrowserSession {
  close: () => Promise<void>
  page: Page
  scope: string
  tarballs: StagedTarball[]
}

/**
 * Open a signed-in npm browser session and enumerate the staged tarballs. The
 * caller uses the returned `page` with `downloadStagedTarballInPage` to pull
 * each artifact's bytes, then MUST call `close()`. `scope` defaults to the
 * signed-in user; `packageFilter` narrows the list. Seams (`launch`) are
 * injectable so tests never launch a browser.
 */
export async function openStagedBrowserSession(
  options?:
    | {
        headless?: boolean | undefined
        launch?:
          | ((config: {
              headless: boolean
              profileDir: string
            }) => Promise<BrowserContext>)
          | undefined
        packageFilter?: string | undefined
        profileDir?: string | undefined
        scope?: string | undefined
      }
    | undefined,
): Promise<StagedBrowserSession> {
  const {
    headless = false,
    launch,
    packageFilter,
    profileDir = DEFAULT_PROFILE_DIR,
    scope,
  } = { __proto__: null, ...options } as NonNullable<typeof options>

  await fs.mkdir(profileDir, { recursive: true })
  // The browser channel defaults to system Chrome but is overridable
  // (SOCKET_BROWSER_CHANNEL=msedge / chromium / …) for a machine without
  // Chrome installed — playwright-core can't conjure a channel it has no
  // binary for, so the operator points it at one they do have.
  const channel = process.env['SOCKET_BROWSER_CHANNEL'] || 'chrome'
  const doLaunch =
    launch ??
    (cfg =>
      chromium.launchPersistentContext(cfg.profileDir, {
        channel,
        headless: cfg.headless,
      }))
  const context = await doLaunch({ headless, profileDir })
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    const user = scope || (await waitForSignIn(page))
    if (!user) {
      throw new Error('Could not resolve the signed-in npm user.')
    }
    const payload = await readStagedPayload(page, user, packageFilter)
    logger.log(
      `Browser-read staged: ${payload.tarballs.length} of ${payload.total} staged package(s) for ${user}.`,
    )
    return {
      close: () => context.close(),
      page,
      scope: user,
      tarballs: payload.tarballs,
    }
  } catch (e) {
    await context.close()
    throw e
  }
}

/**
 * Whether the caller asked for the browser-read passback via argv/env.
 */
export function browserStagedRequested(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    argv.includes('--staged-browser') || env['SOCKET_STAGED_BROWSER'] === '1'
  )
}
