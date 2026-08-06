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
 *   The WRITE path is driven IN PLACE, and that is a bug fix rather than a
 *   preference. It used to re-navigate on every attempt, and the challenge
 *   pause it reached used to reload the URL on a fresh pause. On a live run
 *   the two together looped: access page → the form opens → a reload CLOSES
 *   it → a challenge appears → pause → reload, with "form opened via
 *   edit-button" printing once per lap. The reloads were not only discarding
 *   the work, they were causing it — a rapid reload loop is the traffic shape
 *   npm's bot management answers with an interstitial, so each lap earned the
 *   next. So after the ONE navigation that opens the access page, nothing here
 *   navigates: the form opens once, fills, and saves with no readiness
 *   question in between, and a genuine challenge mid-form is waited out where
 *   the page is, then the form is reopened exactly once.
 */

import type { Page } from 'playwright-core'

import { logger } from '../shared.mts'
import {
  NPM_ORIGIN,
  optIntoChallengeCooldown,
  pauseForChallenge,
  runChallengeAware,
  sleep,
} from './browser-session.mts'
import type { ChallengeAwareStep } from './browser-session.mts'
import { clearChallengeGate } from './challenge-gate.mts'
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
 * The injectable timings the drive/verify path shares — production defaults
 * apply when absent; tests hand in milliseconds.
 */
export interface DriveTimingOptions {
  challengeBudgetMs?: number | undefined
  challengePollMs?: number | undefined
  verifyPollMs?: number | undefined
  verifyTimeoutMs?: number | undefined
}

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
  let raceAttempts = 0
  // The challenge PAUSE + retry rhythm lives in runChallengeAware; this
  // operation only classifies one fetch into done / challenge / a race retry.
  const attempt = async (): Promise<
    ChallengeAwareStep<{
      current: TrustedPublisherCurrent | undefined
      state: AccessPageState
    }>
  > => {
    const last = await fetchAccessPage(page, pkg)
    const state = classifyAccessPage({ body: last.body, status: last.status })
    if (state === 'configured' || state === 'unconfigured') {
      return {
        kind: 'done',
        value: {
          current:
            state === 'configured'
              ? parseTrustedPublisherForm(last.body)
              : undefined,
          state,
        },
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
    if (state === 'step-up') {
      // The session IS signed in; npm wants a fresh authenticator code before
      // it will serve this page. Reported loudly because before this state
      // existed the escalate wall read as "unconfigured" and a caller would
      // plan a create over a live row.
      throw new Error(
        [
          `What: ${pkg}'s access page is behind npm's 2FA step-up, so its trusted-publisher state is unknown.`,
          `Where: ${url}`,
          "Saw: npm's /escalate payload (escalateType + originalUrl) instead of the access page.",
          'Wanted: the access page carrying the trusted-publisher block.',
          'Fix: open the URL above in the signed-in Chrome window, enter the authenticator code, then re-run.',
        ].join('\n'),
      )
    }
    if (state === 'error') {
      // A status-0 result is the documented mid-navigation race, not a server
      // error: retry it a couple of times, fast, then report honestly.
      if (last.status === 0 && raceAttempts < RACE_MAX_ATTEMPTS) {
        raceAttempts += 1
        await sleep(raceRetryMs)
        return { kind: 'retry' }
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
    return { kind: 'challenge' }
  }
  return runChallengeAware(page, attempt, {
    budgetMs: challengeBudgetMs,
    label: pkg,
    pollMs: challengePollMs,
    url,
  })
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

// Set one allowed-action checkbox: the real checkbox by name first, label
// fallback. The name-only locator is NOT enough — npm renders some packages'
// state as a HIDDEN input (`type="hidden" value="on"`) with the same name,
// and setChecked on that throws "Not a checkbox or radio button" (failed
// @socketregistry/array.prototype.flatmap mid-sweep, 2026-07-31). A hidden
// input that already encodes the desired state is a no-op, not an error.
async function setCheckbox(
  page: Page,
  config: { checked: boolean; label: RegExp; name: string },
): Promise<void> {
  const cfg = { __proto__: null, ...config } as typeof config
  const realBox = page
    .locator(`input[type="checkbox"][name="${cfg.name}"]`)
    .first()
  if ((await realBox.count()) > 0) {
    await realBox.setChecked(cfg.checked, { timeout: 10_000 })
    return
  }
  const hidden = page
    .locator(`input[type="hidden"][name="${cfg.name}"]`)
    .first()
  if ((await hidden.count()) > 0) {
    const value = (await hidden.getAttribute('value')) ?? ''
    const encodesChecked = value === 'on' || value === 'true'
    if (encodesChecked === cfg.checked) {
      return
    }
    throw new Error(
      `the ${cfg.name} control is a hidden input encoding ${JSON.stringify(value)} ` +
        `and no checkbox is rendered to flip it to ${cfg.checked} — the page ` +
        'shape changed; re-derive the form contract before writing.',
    )
  }
  await page
    .getByLabel(cfg.label)
    .first()
    .setChecked(cfg.checked, { timeout: 10_000 })
}

/**
 * Which page shape {@link ensureFormOpen} met — logged per package so a live
 * run says how the form was reached, add state included.
 */
export type FormRevealPath =
  | 'edit-button'
  | 'form-already-open'
  | 'github-actions-option'
  | 'reveal-button'

/**
 * Bring the GitHub Actions trusted-publisher form on screen and report which
 * path did it: already-open form wins; a configured summary needs its Edit
 * affordance clicked; an unconfigured page (the ADD state — no publisher
 * exists yet) renders the form behind either a reveal button/link (matched by
 * role + an add/connect/set up/configure name) or a bare GitHub Actions
 * publisher option, so both shapes are tried. Throws a classified block —
 * never a raw locator timeout — when no known affordance reveals the form.
 */
export async function ensureFormOpen(page: Page): Promise<FormRevealPath> {
  const workflowInput = page.locator('input[name="workflowName"]').first()
  if ((await workflowInput.count()) > 0) {
    return 'form-already-open'
  }
  let revealPath: FormRevealPath | undefined
  const edit = page.getByRole('button', { name: /edit/i }).first()
  if (await edit.isVisible().catch(() => false)) {
    await edit.click({ timeout: 10_000 })
    revealPath = 'edit-button'
  }
  if (!revealPath) {
    // The add state's reveal affordance, as a button or a link.
    const revealName = /add|connect|set ?up|configure/i
    const revealButton = page.getByRole('button', { name: revealName }).first()
    const revealLink = page.getByRole('link', { name: revealName }).first()
    if (await revealButton.isVisible().catch(() => false)) {
      await revealButton.click({ timeout: 10_000 })
      revealPath = 'reveal-button'
    } else if (await revealLink.isVisible().catch(() => false)) {
      await revealLink.click({ timeout: 10_000 })
      revealPath = 'reveal-button'
    }
  }
  if (!revealPath) {
    const gha = page.getByText(/GitHub Actions/i).first()
    if (await gha.isVisible().catch(() => false)) {
      await gha.click({ timeout: 10_000 })
      revealPath = 'github-actions-option'
    }
  }
  // A reveal click may land on a publisher CHOICE, not the form itself: give
  // a rendered GitHub Actions option one follow-up click before waiting.
  if (revealPath === 'reveal-button' && (await workflowInput.count()) === 0) {
    const gha = page.getByText(/GitHub Actions/i).first()
    if (await gha.isVisible().catch(() => false)) {
      await gha.click({ timeout: 10_000 })
    }
  }
  try {
    await workflowInput
      .or(page.getByLabel(/workflow filename/i))
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
  } catch (e) {
    if (revealPath) {
      throw e
    }
    throw new Error(
      [
        'What: the trusted-publisher form could not be opened, so nothing was filled or saved.',
        'Where: the package access page in the Chrome window.',
        'Saw: no workflowName input, no Edit button, no add/connect/set up/configure affordance, and no GitHub Actions option.',
        'Wanted: the GitHub Actions trusted-publisher form on screen.',
        'Fix: open the access page by hand, note what its Trusted Publisher block renders, and extend ensureFormOpen for that shape.',
      ].join('\n'),
    )
  }
  return revealPath ?? 'form-already-open'
}

// One classification of the access page from a fetch in the page's OWN world.
// Every readiness question the write path asks goes through here, so no caller
// can reach for a navigation to answer one.
async function currentAccessState(
  page: Page,
  pkg: string,
): Promise<{ state: AccessPageState; status: number }> {
  const res = await fetchAccessPage(page, pkg)
  return {
    state: classifyAccessPage({ body: res.body, status: res.status }),
    status: res.status,
  }
}

// Whether a fresh in-page read of the access page classifies as a
// human-verification challenge — the write path's gate: while this is true,
// nothing is filled and nothing is saved.
async function liveChallengePresent(page: Page, pkg: string): Promise<boolean> {
  return (await currentAccessState(page, pkg)).state === 'challenge'
}

// Wait a live challenge out WHERE THE PAGE IS and answer with the state that
// ended it. The shared `pauseForChallenge` is the whole operator UX (one 🖐
// gate block, one desktop ping, one elapsed anchor, the budget) and it waits
// in place, so the wait composes it instead of re-deriving one — what this
// loop adds is only the re-classification that ends the wait, which is a page
// READ and never a navigation. Bounded by the pause budget, which throws its
// own timeout block once spent: a pause, never a retry ladder.
async function waitOutChallengeInPlace(
  page: Page,
  pkg: string,
  config: {
    budgetMs: number | undefined
    pollMs: number | undefined
    startedMs: number
    url: string
  },
): Promise<{ state: AccessPageState; status: number }> {
  const cfg = { __proto__: null, ...config } as typeof config
  let announced = false
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- serial pause while the operator solves the challenge.
    const pause = await pauseForChallenge(page, {
      announced,
      budgetMs: cfg.budgetMs,
      elapsedMs: Date.now() - cfg.startedMs,
      label: pkg,
      pollMs: cfg.pollMs,
      url: cfg.url,
    })
    announced = pause.announced
    // eslint-disable-next-line no-await-in-loop -- serial: one classification per pause tick.
    const current = await currentAccessState(page, pkg)
    if (current.state !== 'challenge') {
      return current
    }
  }
}

// One complete fill of the open form from `desired` — always the FULL field
// set, so every save writes a whole row and never a residue of a previous
// half-done pass.
async function fillWholeForm(
  page: Page,
  desired: TrustedPublisherDesired,
): Promise<void> {
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
}

/**
 * Drive the form to `desired` and click Save, IN PLACE: open once → fill →
 * save, with no navigation and no readiness question between opening the form
 * and clicking Save.
 *
 * The page is navigated exactly once, at the top, and classified exactly once,
 * before the form is opened — a challenge there is waited out where the page
 * is, so nothing is filled or saved through one (see
 * `docs/agents.md/fleet/npm-anti-bot-rhythm.md`). From `ensureFormOpen`
 * onwards the page is asked nothing: every question is a chance to hand
 * control to a pause that reloads, and a reload closes the form this pass just
 * opened. If the open, the fill, or the save throws while a genuine challenge
 * is on screen, that challenge is waited out in place and the form is reopened
 * exactly once. Any other failure — and a second interrupted pass — throws;
 * the caller renders the What/Where/Saw/Fix and fails soft for the package.
 * The timings are injectable so tests run in milliseconds.
 */
export async function driveFormEdits(
  page: Page,
  pkg: string,
  desired: TrustedPublisherDesired,
  options?: DriveTimingOptions | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const url = accessUrl(pkg)
  const startedMs = Date.now()
  const waitConfig = {
    budgetMs: opts.challengeBudgetMs,
    pollMs: opts.challengePollMs,
    startedMs,
    url,
  }
  // THE one navigation of the whole save. Everything below happens where the
  // page already is.
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await optIntoChallengeCooldown(page)
  // The only readiness classification of the write path, and it happens before
  // the form exists on screen.
  let current = await currentAccessState(page, pkg)
  if (current.state === 'challenge') {
    current = await waitOutChallengeInPlace(page, pkg, waitConfig)
  }
  if (current.state === 'auth' || current.state === 'error') {
    throw new Error(
      [
        `What: ${pkg}'s access page could not be read, so the form was not touched.`,
        `Where: ${url}`,
        `Saw: the page classified as ${current.state} (HTTP ${current.status}).`,
        'Wanted: the signed-in access page carrying the trusted-publisher block.',
        current.state === 'auth'
          ? 'Fix: sign in to npm in the Chrome window, then re-run.'
          : 'Fix: open the URL above in the signed-in Chrome window and confirm it loads, then re-run.',
      ].join('\n'),
    )
  }
  const maxFormAttempts = 2
  for (let attempt = 1; attempt <= maxFormAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- at most two serial passes: the form and its single reopen.
      const revealPath = await ensureFormOpen(page)
      logger.substep(`${pkg}: trusted-publisher form opened via ${revealPath}`)
      // Nothing between here and the click asks the page a question. A
      // challenge that lands mid-fill surfaces as a locator failure below,
      // which is where it is handled.
      // eslint-disable-next-line no-await-in-loop -- serial: one live form at a time.
      await fillWholeForm(page, desired)
      // eslint-disable-next-line no-await-in-loop -- serial: one live form at a time.
      await page
        .getByRole('button', { name: /save changes|save|update|set up/i })
        .first()
        .click({ timeout: 10_000 })
      // eslint-disable-next-line no-await-in-loop -- one await on the way out: a live pause is marked cleared before the save returns.
      await clearChallengeGate(page, { pkg, url })
      return
    } catch (e) {
      // A failure with no challenge on screen is the form's own, and a second
      // interrupted pass is out of reopens: both are the caller's to report.
      if (
        attempt >= maxFormAttempts ||
        // eslint-disable-next-line no-await-in-loop -- serial: the page is asked once, only on failure.
        !(await liveChallengePresent(page, pkg))
      ) {
        throw e
      }
      logger.warn(
        `${pkg}: a human-verification challenge interrupted the form. Waiting it out in place, then reopening the form once.`,
      )
      // eslint-disable-next-line no-await-in-loop -- serial pause while the operator solves the challenge.
      await waitOutChallengeInPlace(page, pkg, waitConfig)
    }
  }
}

/**
 * Poll the RE-READ until the saved state matches desired or the budget
 * elapses. The re-read is the same in-page fetch the classification uses, so
 * the verify NEVER navigates and never re-enters the challenge pause — the
 * form the save just wrote stays exactly where it is. A page that reads as
 * anything but configured (a challenge, an auth bounce, an unreadable
 * response) counts as not-yet-verified, never as verified, and the poll keeps
 * asking; a challenge is announced once so the operator knows to clear it. The
 * cooldown opt-in keeps getting ticked between polls. The timings are
 * injectable so tests run in milliseconds.
 */
export async function awaitVerifiedSave(
  page: Page,
  pkg: string,
  desired: TrustedPublisherDesired,
  options?: DriveTimingOptions | undefined,
): Promise<{ mismatches: string[]; ok: boolean }> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const verifyPollMs = opts.verifyPollMs ?? SAVE_VERIFY_POLL_MS
  const deadline = Date.now() + (opts.verifyTimeoutMs ?? SAVE_VERIFY_TIMEOUT_MS)
  let announcedChallenge = false
  let verify: { mismatches: string[]; ok: boolean } = {
    mismatches: ['not yet re-read'],
    ok: false,
  }
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- serial poll while npm settles/2FA completes.
    await optIntoChallengeCooldown(page)
    // eslint-disable-next-line no-await-in-loop -- serial poll while npm settles/2FA completes.
    const res = await fetchAccessPage(page, pkg)
    const state = classifyAccessPage({ body: res.body, status: res.status })
    if (state === 'challenge' && !announcedChallenge) {
      announcedChallenge = true
      logger.warn(
        `${pkg}: human verification is on screen while the save is being verified. Solve it in the Chrome window — the re-read keeps polling in place.`,
      )
    }
    const reread: TrustedPublisherCurrent | undefined =
      state === 'configured' ? parseTrustedPublisherForm(res.body) : undefined
    verify = verifySavedState({ desired, reread })
    if (verify.ok || Date.now() >= deadline) {
      return verify
    }
    // eslint-disable-next-line no-await-in-loop -- serial poll interval.
    await sleep(verifyPollMs)
  }
}

/**
 * The full save contract for one package: {@link driveFormEdits} drives the
 * form in place, then the in-place re-read verify arbitrates it. On a verify
 * failure the WHOLE sequence retries exactly once — the observed partial-save
 * shape (a challenge mid-fill leaving some fields unwritten) is recoverable by
 * one clean pass, while anything persistent fails with the mismatched fields
 * named. The retry's navigation is the only one either pass makes, and it
 * happens at the TOP of the pass, before any form is open: between opening the
 * form and verifying the save, neither pass navigates.
 */
export async function driveVerifiedSave(
  page: Page,
  pkg: string,
  desired: TrustedPublisherDesired,
  options?: DriveTimingOptions | undefined,
): Promise<{ attempts: number; mismatches: string[]; ok: boolean }> {
  const maxAttempts = 2
  let verify: { mismatches: string[]; ok: boolean } = {
    mismatches: ['not yet attempted'],
    ok: false,
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- at most two serial passes: the save and its single fresh retry.
    await driveFormEdits(page, pkg, desired, options)
    // eslint-disable-next-line no-await-in-loop -- the verify arbitrates each pass before any retry.
    verify = await awaitVerifiedSave(page, pkg, desired, options)
    if (verify.ok) {
      return { attempts: attempt, mismatches: [], ok: true }
    }
    if (attempt < maxAttempts) {
      logger.warn(
        `${pkg}: saved state did not verify (${verify.mismatches.join('; ')}) — retrying the whole open/fill/save/verify once from a fresh page load.`,
      )
    }
  }
  return { attempts: maxAttempts, mismatches: verify.mismatches, ok: false }
}
