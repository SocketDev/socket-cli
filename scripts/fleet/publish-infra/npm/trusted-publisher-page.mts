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

import { logger } from '../shared.mts'
import {
  NPM_ORIGIN,
  optIntoChallengeCooldown,
  runChallengeAware,
  sleep,
} from './browser-session.mts'
import type { ChallengeAwareStep } from './browser-session.mts'
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

// Whether a fresh in-page read of the access page classifies as a
// human-verification challenge — the write path's gate: while this is true,
// nothing is filled and nothing is saved.
async function liveChallengePresent(page: Page, pkg: string): Promise<boolean> {
  const res = await fetchAccessPage(page, pkg)
  return (
    classifyAccessPage({ body: res.body, status: res.status }) === 'challenge'
  )
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
 * Drive the form to `desired` and click Save — atomically with respect to
 * human-verification challenges. The whole navigate → classify → open →
 * fill → save sequence is ONE attempt inside {@link runChallengeAware}:
 * the page is classified BEFORE any form interaction and the run pauses on a
 * challenge instead of writing through it; a challenge surfacing mid-fill
 * abandons that half-done pass, and the next attempt re-navigates, re-reads
 * the form fresh, and re-fills from scratch — a half-filled interaction is
 * never resumed; and the save click is gated by a final classification, so
 * nothing is written while a challenge is outstanding (see
 * `docs/agents.md/fleet/npm-anti-bot-rhythm.md`). Selector failures without
 * a challenge on screen throw; the caller renders the What/Where/Saw/Fix and
 * fails soft for the package. The timings are injectable so tests run in
 * milliseconds.
 */
export async function driveFormEdits(
  page: Page,
  pkg: string,
  desired: TrustedPublisherDesired,
  options?: DriveTimingOptions | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const url = accessUrl(pkg)
  const attempt = async (): Promise<ChallengeAwareStep<undefined>> => {
    // Fresh navigation on every attempt: after a challenge clears, the page
    // reloads and any earlier fills are gone, so the only safe resume point
    // is the top of the sequence.
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await optIntoChallengeCooldown(page)
    const before = await fetchAccessPage(page, pkg)
    const state = classifyAccessPage({
      body: before.body,
      status: before.status,
    })
    if (state === 'challenge') {
      return { kind: 'challenge' }
    }
    if (state === 'auth' || state === 'error') {
      throw new Error(
        [
          `What: ${pkg}'s access page could not be read, so the form was not touched.`,
          `Where: ${url}`,
          `Saw: the page classified as ${state} (HTTP ${before.status}).`,
          'Wanted: the signed-in access page carrying the trusted-publisher block.',
          state === 'auth'
            ? 'Fix: sign in to npm in the Chrome window, then re-run.'
            : 'Fix: open the URL above in the signed-in Chrome window and confirm it loads, then re-run.',
        ].join('\n'),
      )
    }
    try {
      const revealPath = await ensureFormOpen(page)
      logger.substep(`${pkg}: trusted-publisher form opened via ${revealPath}`)
      await fillWholeForm(page, desired)
    } catch (e) {
      // A selector failure with a challenge now on screen is the challenge's
      // doing, not the form's: abandon this pass, pause, restart from
      // navigation.
      if (await liveChallengePresent(page, pkg)) {
        return { kind: 'challenge' }
      }
      throw e
    }
    // The last gate before the only write: a challenge that interjected
    // during the fill means this pass must not save.
    if (await liveChallengePresent(page, pkg)) {
      return { kind: 'challenge' }
    }
    const save = page
      .getByRole('button', { name: /save changes|save|update|set up/i })
      .first()
    await save.click({ timeout: 10_000 })
    return { kind: 'done', value: undefined }
  }
  await runChallengeAware(page, attempt, {
    budgetMs: opts.challengeBudgetMs,
    label: pkg,
    pollMs: opts.challengePollMs,
    url,
  })
}

/**
 * Poll the RE-READ until the saved state matches desired or the budget
 * elapses — the operator may be answering a 2FA challenge in the window, so
 * the cooldown opt-in keeps getting ticked between polls. The timings are
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
      reread = (
        await readTrustedPublisher(page, pkg, {
          challengeBudgetMs: opts.challengeBudgetMs,
          challengePollMs: opts.challengePollMs,
        })
      ).current
    } catch {
      reread = undefined
    }
    verify = verifySavedState({ desired, reread })
    if (verify.ok || Date.now() >= deadline) {
      return verify
    }
    // eslint-disable-next-line no-await-in-loop -- serial poll interval.
    await sleep(verifyPollMs)
  }
}

/**
 * The full save contract for one package: navigate → read → fill → save via
 * {@link driveFormEdits}, then the re-read verify as the arbiter. On a verify
 * failure the WHOLE sequence retries exactly once from a fresh page — the
 * observed partial-save shape (a challenge mid-fill leaving some fields
 * unwritten) is recoverable by one clean pass, while anything persistent
 * fails with the mismatched fields named. Never a loop: one retry, only
 * after a verify failure, and every challenge inside either pass pauses
 * through the shared rhythm.
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
        `${pkg}: saved state did not verify (${verify.mismatches.join('; ')}) — retrying the whole navigate/read/fill/save once from a fresh page.`,
      )
    }
  }
  return { attempts: maxAttempts, mismatches: verify.mismatches, ok: false }
}
