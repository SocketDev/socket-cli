/**
 * @file Page-level playwright I/O for the npm Trusted Publisher settings
 *   driver: the signed-in access-page read, which PAUSES visibly for the
 *   operator on a human-verification challenge rather than retrying into a
 *   rate limit; the form-driving that fills the
 *   Trusted Publisher fields and clicks Save; and the post-save verify loop
 *   that RE-READS the form until the page itself reports the desired state —
 *   success is the page's answer, never the click. The pure classification /
 *   parsing / diffing live in `trusted-publisher-parse.mts` +
 *   `trusted-publisher-plan.mts`; the session + CLI live in
 *   `trusted-publisher-browser.mts`.
 */

import type { Page } from 'playwright-core'

import {
  NPM_ORIGIN,
  optIntoChallengeCooldown,
  pauseForChallenge,
  sleep,
} from './browser-session.mts'
import {
  classifyAccessPage,
  parseTrustedPublisherForm,
} from './trusted-publisher-parse.mts'
import type {
  AccessPageState,
  TrustedPublisherCurrent,
} from './trusted-publisher-parse.mts'
import { verifySavedState } from './trusted-publisher-plan.mts'
import type { TrustedPublisherDesired } from './trusted-publisher-plan.mts'

// A status-0 result is a mid-navigation race from a destroyed execution
// context, not a challenge; it clears almost immediately, so it gets a small
// bounded number of fast retries and nothing more.
const RACE_RETRY_MS = 2000
const RACE_MAX_ATTEMPTS = 3

// Post-save verify: the operator may be mid-2FA in the window, so poll the
// re-read patiently. The challenge-cooldown opt-in means only the FIRST
// package in a 5-minute window should ever take this long.
const SAVE_VERIFY_POLL_MS = 3000
const SAVE_VERIFY_TIMEOUT_MS = 3 * 60_000

/**
 * The access-settings URL for `pkg` — the page carrying the Trusted
 * Publisher form. Exported for tests.
 */
export function accessUrl(pkg: string): string {
  return `${NPM_ORIGIN}/package/${encodeURIComponent(pkg)}/access`
}

// Fetch the access page's HTML in the page's MAIN world (the page's cookies
// authenticate it; cache no-store so a post-save re-read never sees stale
// pre-mutation HTML). A destroyed execution context yields status 0 —
// retryable, never fatal.
async function fetchAccessPage(
  page: Page,
  pkg: string,
): Promise<{ body: string; status: number }> {
  try {
    return await page.evaluate(async fetchUrl => {
      // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- runs in the npm page's MAIN world via page.evaluate; only the page's cookies authenticate this request.
      const r = await fetch(fetchUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'text/html' },
        method: 'GET',
      })
      return { body: await r.text(), status: r.status }
    }, accessUrl(pkg))
  } catch {
    return { body: '', status: 0 }
  }
}

/**
 * Read one package's Trusted Publisher form state. A human-verification
 * challenge PAUSES the run for the operator — the page is brought to the
 * front, the cooldown opt-in is ticked, and each poll prints elapsed and
 * remaining time — never a retry ladder, which against a bot challenge earns
 * a rate limit. Throws on auth (a signed-out session), on a real HTTP error,
 * and when a challenge outlasts its budget; the batch loops catch per
 * package. The timings are injectable so tests run in milliseconds.
 */
export async function readTrustedPublisher(
  page: Page,
  pkg: string,
  options?:
    | {
        challengeBudgetMs?: number | undefined
        challengePollMs?: number | undefined
        raceRetryMs?: number | undefined
      }
    | undefined,
): Promise<{
  current: TrustedPublisherCurrent | undefined
  state: AccessPageState
}> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const { challengeBudgetMs, challengePollMs } = opts
  const raceRetryMs = opts.raceRetryMs ?? RACE_RETRY_MS
  const url = accessUrl(pkg)
  const started = Date.now()
  let raceAttempts = 0
  let announced = false
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- serial poll: one live page, one challenge at a time.
    const last = await fetchAccessPage(page, pkg)
    const state = classifyAccessPage({ body: last.body, status: last.status })
    if (state === 'configured' || state === 'unconfigured') {
      return {
        current:
          state === 'configured'
            ? parseTrustedPublisherForm(last.body)
            : undefined,
        state,
      }
    }
    if (state === 'auth') {
      throw new Error(
        [
          `What: ${pkg}'s access page could not be read, so its trusted-publisher state is unknown.`,
          `Where: ${url}`,
          `Saw: npm answered HTTP ${last.status} — the session is signed out or lacks access to this package.`,
          'Wanted: the signed-in access page carrying the trusted-publisher block.',
          'Fix: sign in to npm in the Chrome window, then re-run.',
        ].join('\n'),
      )
    }
    if (state === 'error') {
      // A status-0 result is the documented mid-navigation race, not a server
      // error: retry it a couple of times, fast, then report honestly.
      if (last.status === 0 && raceAttempts < RACE_MAX_ATTEMPTS) {
        raceAttempts += 1
        // eslint-disable-next-line no-await-in-loop -- serial short retry for a navigation race.
        await sleep(raceRetryMs)
        continue
      }
      throw new Error(
        [
          `What: ${pkg}'s access page could not be read.`,
          `Where: ${url}`,
          `Saw: npm answered HTTP ${last.status}.`,
          'Wanted: the access page HTML.',
          'Fix: open the URL above in the signed-in Chrome window and confirm it loads, then re-run.',
        ].join('\n'),
      )
    }
    // A challenge: PAUSE for the operator, visibly, through the sanctioned
    // helper — it owns the countdown and the budget refusal.
    // eslint-disable-next-line no-await-in-loop -- serial pause while the operator solves the challenge.
    const pause = await pauseForChallenge(page, {
      announced,
      budgetMs: challengeBudgetMs,
      elapsedMs: Date.now() - started,
      label: pkg,
      pollMs: challengePollMs,
      url,
    })
    announced = pause.announced
  }
}

// Fill one form field, preferring the wire-contract input name and falling
// back to the visible label — names survive a DOM reshuffle better than
// structure, labels survive a rename of the name attribute.
async function fillField(
  page: Page,
  config: { label: RegExp; name: string; value: string },
): Promise<void> {
  const cfg = { __proto__: null, ...config } as typeof config
  const byName = page.locator(`input[name="${cfg.name}"]`).first()
  if ((await byName.count()) > 0) {
    await byName.fill(cfg.value, { timeout: 10_000 })
    return
  }
  await page.getByLabel(cfg.label).first().fill(cfg.value, { timeout: 10_000 })
}

// Set one allowed-action checkbox the same way: name first, label fallback.
async function setCheckbox(
  page: Page,
  config: { checked: boolean; label: RegExp; name: string },
): Promise<void> {
  const cfg = { __proto__: null, ...config } as typeof config
  const byName = page.locator(`input[name="${cfg.name}"]`).first()
  const box =
    (await byName.count()) > 0 ? byName : page.getByLabel(cfg.label).first()
  await box.setChecked(cfg.checked, { timeout: 10_000 })
}

// Bring the GitHub Actions trusted-publisher form on screen: already-open
// form wins; a configured summary needs its Edit affordance clicked; an
// unconfigured page needs the GitHub Actions publisher selected.
async function ensureFormOpen(page: Page): Promise<void> {
  const workflowInput = page.locator('input[name="workflowName"]').first()
  if ((await workflowInput.count()) > 0) {
    return
  }
  const edit = page.getByRole('button', { name: /edit/i }).first()
  if (await edit.isVisible().catch(() => false)) {
    await edit.click({ timeout: 10_000 })
  } else {
    const gha = page.getByText(/GitHub Actions/i).first()
    if (await gha.isVisible().catch(() => false)) {
      await gha.click({ timeout: 10_000 })
    }
  }
  await workflowInput
    .or(page.getByLabel(/workflow filename/i))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
}

/**
 * Drive the form to `desired` and click Save. Selector failures throw; the
 * caller renders the What/Where/Saw/Fix and fails soft for the package.
 */
export async function driveFormEdits(
  page: Page,
  pkg: string,
  desired: TrustedPublisherDesired,
): Promise<void> {
  await page.goto(accessUrl(pkg), { waitUntil: 'domcontentloaded' })
  await optIntoChallengeCooldown(page)
  await ensureFormOpen(page)
  await fillField(page, {
    label: /organization|user|owner/i,
    name: 'repositoryOwner',
    value: desired.repositoryOwner,
  })
  await fillField(page, {
    label: /^repository/i,
    name: 'repositoryName',
    value: desired.repositoryName,
  })
  await fillField(page, {
    label: /workflow filename/i,
    name: 'workflowName',
    value: desired.workflowFilename,
  })
  await fillField(page, {
    label: /environment name/i,
    name: 'githubEnvironmentName',
    value: desired.environmentName,
  })
  await setCheckbox(page, {
    checked: desired.allowNpmPublish,
    label: /allow npm publish/i,
    name: 'allowPublish',
  })
  await setCheckbox(page, {
    checked: desired.allowNpmStagePublish,
    label: /allow npm stage publish/i,
    name: 'allowStagePublish',
  })
  const save = page
    .getByRole('button', { name: /save changes|save|update|set up/i })
    .first()
  await save.click({ timeout: 10_000 })
}

/**
 * Poll the RE-READ until the saved state matches desired or the budget
 * elapses — the operator may be answering a 2FA challenge in the window, so
 * the cooldown opt-in keeps getting ticked between polls.
 */
export async function awaitVerifiedSave(
  page: Page,
  pkg: string,
  desired: TrustedPublisherDesired,
): Promise<{ mismatches: string[]; ok: boolean }> {
  const deadline = Date.now() + SAVE_VERIFY_TIMEOUT_MS
  let verify: { mismatches: string[]; ok: boolean } = {
    mismatches: ['not yet re-read'],
    ok: false,
  }
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- serial poll while npm settles/2FA completes.
    await optIntoChallengeCooldown(page)
    let reread: TrustedPublisherCurrent | undefined
    try {
      // eslint-disable-next-line no-await-in-loop -- serial poll while npm settles/2FA completes.
      reread = (await readTrustedPublisher(page, pkg)).current
    } catch {
      reread = undefined
    }
    verify = verifySavedState({ desired, reread })
    if (verify.ok || Date.now() >= deadline) {
      return verify
    }
    // eslint-disable-next-line no-await-in-loop -- serial poll interval.
    await sleep(SAVE_VERIFY_POLL_MS)
  }
}
