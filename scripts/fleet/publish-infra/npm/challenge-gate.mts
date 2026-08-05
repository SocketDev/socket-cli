/**
 * @file Operator-facing UX for the npm human-verification challenge PAUSE:
 *   ONE fleet-shaped 🖐 HUMAN GATE block when a pause starts, a throttled
 *   progress line while it holds, a fail-soft macOS desktop ping, and an
 *   atomically written gate event file any watcher polls instead of scraping
 *   logs. Pause identity is tracked PER PAGE + URL and survives re-entry
 *   from a fresh `runChallengeAware` call: the trusted-publisher verify loop
 *   re-enters `runChallengeAware` every few seconds while a challenge is
 *   live, and per-call state announced the same pause dozens of times with
 *   the elapsed counter re-anchored to "0s" on every entry (observed
 *   2026-08-04 during a trusted-publisher drive — the operator read it as
 *   "the human-verification challenge is looping" and could not tell what to
 *   do or when). The tracker here keeps one anchor for the whole episode, so
 *   the budget, the elapsed counter, and the single gate block all describe
 *   the pause the operator actually experiences. Everything human-pinging is
 *   local and fail-soft: no network, and no error here may ever kill a pause.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  browserSessionGate,
  formatHumanGate,
} from '../../_shared/human-gate.mts'
import { logger } from '../shared.mts'

/**
 * The ONE gate event file for npm challenge pauses. A session or watcher
 * polls this file instead of scraping a background task log; it always holds
 * the latest {@link ChallengeGateEvent} as pretty JSON. Lives in the runtime
 * state dir, never in a repo tree.
 */
export const NPM_CHALLENGE_GATE_EVENT_PATH = path.join(
  os.homedir(),
  '.socket',
  'npm-challenge-gate.json',
)

/**
 * How often a HELD pause prints its one-line progress update. The full gate
 * block renders once per pause; between progress lines the pause is silent.
 */
export const CHALLENGE_PROGRESS_INTERVAL_MS = 30_000

/**
 * How long a cleared pause can be re-challenged and still count as the SAME
 * pause. npm's challenge flaps against a polling read loop — a fetch slips
 * through, the verify re-read draws the challenge again seconds later — and
 * each flap must not re-announce the gate or re-anchor the elapsed counter.
 */
export const CHALLENGE_RESUME_WINDOW_MS = 60_000

/**
 * The gate event file's payload: `paused` when a challenge pause starts (or
 * resumes inside the resume window), `cleared` when the operation gets
 * through, `expired` when the pause outlived its budget and the run stopped.
 */
export type ChallengeGateEvent =
  | {
      budgetMs: number
      pkg: string
      sinceIso: string
      state: 'expired' | 'paused'
      url: string
    }
  | { clearedIso: string; pkg: string; state: 'cleared' }

/**
 * Injectable seams for the pause UX so tests control the clock and observe
 * output without a desktop, a home-dir write, or real time. Every field is
 * optional; {@link resolveChallengeUx} fills the production defaults.
 */
export interface ChallengePauseUx {
  emit?: ((text: string) => void) | undefined
  eventPath?: string | undefined
  notify?: ((config: { pkg: string; url: string }) => void) | undefined
  now?: (() => number) | undefined
}

/**
 * The fully resolved seams a pause tick runs with.
 */
export interface ResolvedChallengeUx {
  emit: (text: string) => void
  eventPath: string
  notify: (config: { pkg: string; url: string }) => void
  now: () => number
  writeEvent: (event: ChallengeGateEvent) => Promise<void>
}

/**
 * Resolve the injectable UX seams to production defaults. The default side
 * effects (desktop ping, the real gate event file) stay inert under vitest:
 * existing unit suites drive the pause paths through the real module without
 * injecting seams, and a test run must never ping the operator's desktop or
 * flap the real gate file a live watcher may be polling. An injected seam
 * always runs — that is how the UX itself is tested.
 */
export function resolveChallengeUx(
  ux?: ChallengePauseUx | undefined,
): ResolvedChallengeUx {
  const cfg = { __proto__: null, ...ux } as NonNullable<typeof ux>
  const inertDefaults = process.env['VITEST'] !== undefined
  const eventPath = cfg.eventPath ?? NPM_CHALLENGE_GATE_EVENT_PATH
  return {
    emit: cfg.emit ?? (text => logger.log(text)),
    eventPath,
    notify:
      cfg.notify ??
      (config => {
        if (!inertDefaults) {
          notifyChallengeDesktop(config)
        }
      }),
    now: cfg.now ?? Date.now,
    writeEvent: async event => {
      if (cfg.eventPath === undefined && inertDefaults) {
        return
      }
      await writeChallengeGateEvent(event, eventPath)
    },
  }
}

/**
 * Write one gate event ATOMICALLY (tmp sibling + rename) so a watcher polling
 * the file never reads a half-written document. Fail-soft: the gate file is a
 * courtesy signal for orchestrators, never load-bearing, so any filesystem
 * error is swallowed and the pause carries on.
 */
export async function writeChallengeGateEvent(
  event: ChallengeGateEvent,
  eventPath: string,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(eventPath), { recursive: true })
    const tmpPath = `${eventPath}.tmp-${process.pid}`
    await fs.writeFile(tmpPath, `${JSON.stringify(event, undefined, 2)}\n`)
    await fs.rename(tmpPath, eventPath)
  } catch {}
}

/**
 * Quote text as an AppleScript string literal (backslashes and double quotes
 * escaped) so a package name or URL can never break out of the notification
 * script. Pure; exported for tests.
 */
export function appleScriptQuote(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * The spawn seam {@link notifyChallengeDesktop} uses, narrowed to what the
 * ping needs (the lib spawn's promise + running-process handle) so a test
 * double stays a three-line object.
 */
export type ChallengeNotifySpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: 'ignore' },
) => {
  catch: (onRejected: () => void) => unknown
  process?: { unref: () => void } | undefined
}

/**
 * Ping the operator's DESKTOP that a challenge needs them. The pause usually
 * lives in a background task log nobody watches, so a log line alone never
 * reaches a human — this is the signal that does. macOS only (an `osascript`
 * notification: local, no network, no telemetry) and fail-soft everywhere: a
 * non-darwin platform, a missing binary, or a spawn error all no-op and the
 * pause carries on.
 */
export function notifyChallengeDesktop(config: {
  pkg: string
  platform?: string | undefined
  spawnProcess?: ChallengeNotifySpawn | undefined
  url: string
}): void {
  const cfg = { __proto__: null, ...config } as typeof config
  if ((cfg.platform ?? process.platform) !== 'darwin') {
    return
  }
  try {
    const spawnProcess: ChallengeNotifySpawn = cfg.spawnProcess ?? spawn
    const script =
      `display notification ${appleScriptQuote(`${cfg.pkg}: solve the check at ${cfg.url}`)} ` +
      `with title ${appleScriptQuote('npm challenge — solve in Chrome')} ` +
      `sound name ${appleScriptQuote('Ping')}`
    const result = spawnProcess('osascript', ['-e', script], {
      stdio: 'ignore',
    })
    result.catch(() => {})
    result.process?.unref()
  } catch {}
}

/**
 * The fleet-shaped 🖐 HUMAN GATE block for one challenge pause, composed from
 * the shared human-gate catalog so it reads like every other gate the
 * operator meets. Names the package, the exact URL, the remaining budget, and
 * where watchers see the clear. Rendered ONCE per pause, never per tick.
 * Pure; exported for tests.
 */
export function formatChallengeGateBlock(config: {
  eventPath: string
  pkg: string
  remainingMs: number
  url: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const remaining = Math.max(0, Math.round(cfg.remainingMs / 1000))
  return formatHumanGate(
    browserSessionGate(
      `npm interjected a human-verification challenge on ${cfg.pkg} — the run is PAUSED until a person solves it (${remaining}s left in the budget).`,
      `solve the "Verify you are human" check in the fronted Chrome window — ${cfg.url}`,
      'say "front the challenge window" and I bring the Chrome page back to the front — only you can solve the check itself.',
      `the paused ${cfg.pkg} operation resumes on its own the moment the check clears; watchers can poll ${cfg.eventPath} for state "cleared".`,
    ),
  ).join('\n')
}

/**
 * Human-readable progress line for a PAUSED challenge — elapsed and remaining
 * seconds, so the wait is visible rather than a silent hang. Pure — exported
 * for tests.
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
 * Saw vs wanted / Fix order. `rerunHint` (when the caller has one) names the
 * exact command to run again; `eventPath` names where watchers see the
 * expiry. Pure — exported for tests.
 */
export function formatChallengeTimeout(config: {
  budgetMs: number
  eventPath?: string | undefined
  rerunHint?: string | undefined
  url: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const rerun = cfg.rerunHint ? ` with \`${cfg.rerunHint}\`` : ''
  const watchers = cfg.eventPath
    ? ` The gate event file at ${cfg.eventPath} now reads state "expired".`
    : ''
  return [
    'What: npm kept serving a human-verification challenge, so the run stopped rather than retrying into a rate limit.',
    `Where: ${cfg.url}`,
    `Saw: the challenge was still unsolved after ${Math.round(cfg.budgetMs / 1000)}s of waiting.`,
    'Wanted: the challenge cleared in the Chrome window so the signed-in session can read the page.',
    `Fix: solve the "Just a moment…" check in the Chrome window, then re-run${rerun}. Nothing was changed, so a re-run is safe.${watchers}`,
  ].join('\n')
}

/**
 * Per-pause bookkeeping: the episode's one elapsed anchor, the progress-line
 * throttle, and the clear/resume state that lets a flapping challenge stay
 * ONE pause.
 */
export interface ChallengePauseRecord {
  clearedAtMs: number | undefined
  clearedLineEmitted: boolean
  lastProgressAtMs: number
  startedAtMs: number
}

// Pause records keyed by the live page object, then by URL. The WeakMap
// bounds the state to the page's lifetime, and page identity keeps concurrent
// sessions (and unit tests sharing a URL string) out of each other's pauses.
const pausesByPage = new WeakMap<object, Map<string, ChallengePauseRecord>>()

/**
 * One PAUSE tick's operator UX, tracked per page + URL so it survives
 * re-entry from a fresh `runChallengeAware` call. First tick of a new pause:
 * render the gate block, fire the desktop ping, write the `paused` event.
 * Later ticks: at most one progress line every
 * {@link CHALLENGE_PROGRESS_INTERVAL_MS}, elapsed measured from the pause's
 * own anchor — never from `fallbackElapsedMs`, which is the calling loop's
 * per-call measurement and is only trusted when no pause is tracked yet.
 * Returns `expiredMessage` once the budget is spent (the caller throws it —
 * the `expired` event is already written) and `freshPause` on the first tick
 * of a new pause (the caller fronts the Chrome window exactly then).
 */
export async function tickChallengeGate(
  pageKey: object,
  config: {
    budgetMs: number
    fallbackElapsedMs: number
    pkg: string
    rerunHint?: string | undefined
    url: string
    ux?: ChallengePauseUx | undefined
  },
): Promise<{ expiredMessage: string | undefined; freshPause: boolean }> {
  const cfg = { __proto__: null, ...config } as typeof config
  const ux = resolveChallengeUx(cfg.ux)
  const now = ux.now()
  let records = pausesByPage.get(pageKey)
  if (!records) {
    records = new Map()
    pausesByPage.set(pageKey, records)
  }
  let record = records.get(cfg.url)
  // A pause cleared longer ago than the resume window is a finished episode;
  // the challenge on screen now is a NEW pause with its own gate block.
  if (
    record?.clearedAtMs !== undefined &&
    now - record.clearedAtMs > CHALLENGE_RESUME_WINDOW_MS
  ) {
    records.delete(cfg.url)
    record = undefined
  }
  const elapsedMs =
    record === undefined ? cfg.fallbackElapsedMs : now - record.startedAtMs
  if (elapsedMs >= cfg.budgetMs) {
    const sinceMs = record === undefined ? now - elapsedMs : record.startedAtMs
    await ux.writeEvent({
      budgetMs: cfg.budgetMs,
      pkg: cfg.pkg,
      sinceIso: new Date(sinceMs).toISOString(),
      state: 'expired',
      url: cfg.url,
    })
    records.delete(cfg.url)
    return {
      expiredMessage: formatChallengeTimeout({
        budgetMs: cfg.budgetMs,
        eventPath: ux.eventPath,
        rerunHint: cfg.rerunHint,
        url: cfg.url,
      }),
      freshPause: false,
    }
  }
  if (record === undefined) {
    records.set(cfg.url, {
      clearedAtMs: undefined,
      clearedLineEmitted: false,
      lastProgressAtMs: now,
      startedAtMs: now,
    })
    ux.emit(
      formatChallengeGateBlock({
        eventPath: ux.eventPath,
        pkg: cfg.pkg,
        remainingMs: cfg.budgetMs,
        url: cfg.url,
      }),
    )
    ux.notify({ pkg: cfg.pkg, url: cfg.url })
    await ux.writeEvent({
      budgetMs: cfg.budgetMs,
      pkg: cfg.pkg,
      sinceIso: new Date(now).toISOString(),
      state: 'paused',
      url: cfg.url,
    })
    return { expiredMessage: undefined, freshPause: true }
  }
  if (record.clearedAtMs !== undefined) {
    // Re-challenged inside the resume window: the SAME pause continues on its
    // original anchor — no second gate block, no second ping.
    record.clearedAtMs = undefined
    await ux.writeEvent({
      budgetMs: cfg.budgetMs,
      pkg: cfg.pkg,
      sinceIso: new Date(record.startedAtMs).toISOString(),
      state: 'paused',
      url: cfg.url,
    })
  }
  if (now - record.lastProgressAtMs >= CHALLENGE_PROGRESS_INTERVAL_MS) {
    record.lastProgressAtMs = now
    ux.emit(
      formatChallengeWait({ budgetMs: cfg.budgetMs, elapsedMs, url: cfg.url }),
    )
  }
  return { expiredMessage: undefined, freshPause: false }
}

/**
 * Mark a live pause CLEARED — called by `runChallengeAware` when its
 * operation finally reports done. The record survives for
 * {@link CHALLENGE_RESUME_WINDOW_MS} so a re-challenge moments later resumes
 * the same pause instead of announcing a new one. Writes the `cleared` event;
 * emits at most one human-facing "cleared" line per pause, and only for a
 * pause the operator actually waited through — the flapping challenge/clear
 * cycle a verify loop produces stays quiet. No-op when no pause is live.
 */
export async function clearChallengeGate(
  pageKey: object,
  config: { pkg: string; url: string; ux?: ChallengePauseUx | undefined },
): Promise<void> {
  const cfg = { __proto__: null, ...config } as typeof config
  const record = pausesByPage.get(pageKey)?.get(cfg.url)
  if (record === undefined || record.clearedAtMs !== undefined) {
    return
  }
  const ux = resolveChallengeUx(cfg.ux)
  const now = ux.now()
  record.clearedAtMs = now
  if (
    !record.clearedLineEmitted &&
    now - record.startedAtMs >= CHALLENGE_PROGRESS_INTERVAL_MS
  ) {
    record.clearedLineEmitted = true
    ux.emit(
      `Human verification cleared on ${cfg.pkg} after ${Math.round((now - record.startedAtMs) / 1000)}s — resuming.`,
    )
  }
  await ux.writeEvent({
    clearedIso: new Date(now).toISOString(),
    pkg: cfg.pkg,
    state: 'cleared',
  })
}
