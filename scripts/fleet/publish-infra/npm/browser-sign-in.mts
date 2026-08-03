/**
 * @file Seed the shared npm browser profile with a PLAIN-Chrome sign-in —
 *   no Playwright, no CDP. npmjs.com sits behind bot management that drops a
 *   LOGIN transaction performed in a devtools-driven browser: sign-in + OTP
 *   complete and the site bounces straight back to the signed-out landing
 *   page (observed 2026-07-30 on a FRESH profile with the sanctioned launch —
 *   sandbox on, automation flags stripped — so no flag tuning fixes it; the
 *   CDP wire itself is the tell). An EXISTING session cookie is honored fine.
 *   So the lanes split: this script launches real Chrome (CDP-free) on the
 *   shared profile for the one human sign-in, and every automation launch
 *   only ever REUSES the session it seeded.
 *   Flow: refuse if the profile is held → open plain Chrome on the profile at
 *   the npm login page → the operator signs in (password + OTP) and QUITS
 *   Chrome (Cmd-Q; quitting releases the profile lock and flushes cookies) →
 *   the sanctioned driver opens the profile and proves the session with
 *   npm's own /-/whoami. Fail-loud on every arm: a signed-out verify names
 *   the next move instead of leaving the operator guessing.
 *   Usage: node scripts/fleet/publish-infra/npm/browser-sign-in.mts.
 */

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  DEFAULT_PROFILE_DIR,
  NPM_ORIGIN,
  openNpmBrowserSession,
  sleep,
} from './browser-session.mts'
import { isMainModule } from '../../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Chrome's per-profile single-instance marker; present while any Chrome has
// the profile open, gone once the operator quits.
const SINGLETON_LOCK = 'SingletonLock'

// How long the operator gets for the whole sign-in (password + OTP + quit).
const SIGN_IN_BUDGET_MS = 15 * 60_000
const POLL_MS = 2000

/**
 * Launch plain (CDP-free) system Chrome on the shared profile at the npm
 * login page, wait for the operator to sign in and QUIT Chrome, then verify
 * the seeded session through the sanctioned driver. Returns the signed-in
 * username; throws loud on refusal, timeout, or a signed-out verify.
 */
export async function seedNpmSignIn(
  options?: { profileDir?: string | undefined } | undefined,
): Promise<string> {
  const opts = { __proto__: null, ...options } as {
    profileDir?: string | undefined
  }
  const profileDir = opts.profileDir ?? DEFAULT_PROFILE_DIR
  await fs.mkdir(profileDir, { recursive: true })
  const lockPath = path.join(profileDir, SINGLETON_LOCK)
  if (existsSync(lockPath)) {
    throw new Error(
      `the profile is already held by a running Chrome (${lockPath}).\n` +
        `  Fix: quit that Chrome window (Cmd-Q), then re-run.`,
    )
  }
  // Exec the Chrome BINARY directly — real Chrome with NO devtools wire
  // attached, which is the whole point of this lane. Never `open -na`: when
  // Chrome is already running, LaunchServices routes the URL to the existing
  // instance and silently DROPS the --user-data-dir args, so the operator
  // signs in on their personal profile while this script waits forever for a
  // lock that can never appear (observed 2026-07-30).
  const chromeBinary =
    process.env['SOCKET_BROWSER_BINARY'] ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (!existsSync(chromeBinary)) {
    throw new Error(
      `no Chrome binary at ${chromeBinary}.\n` +
        '  Fix: install Google Chrome, or point SOCKET_BROWSER_BINARY at the ' +
        'browser binary to use.',
    )
  }
  const child = spawn(
    chromeBinary,
    [`--user-data-dir=${profileDir}`, `${NPM_ORIGIN}/login`],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  // Chrome's stderr is diagnostics-only noise on a good run — but on a
  // failed launch it is the ONLY evidence, and the first version of this
  // script swallowed it (`void child.catch(...)` + stdio ignore), which
  // turned a silent spawn failure into a 15-minute lock wait with nothing to
  // debug (2026-07-30). A rolling tail is kept for the failure message; the
  // exit promise is still swallowed because the operator quitting Chrome is
  // the SUCCESS path, whatever the exit code.
  let stderrTail = ''
  child.process.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000)
  })
  let childAlive = true
  child.process.on('exit', () => {
    childAlive = false
  })
  void child.catch(() => undefined)
  logger.log('Chrome is open on the shared profile at the npm login page.')
  logger.log('Sign in (password + OTP), then QUIT Chrome (Cmd-Q).')
  logger.log(
    'Quitting is load-bearing: it flushes cookies and frees the profile.',
  )
  // Launch signal: the PROCESS, not the lock — a fresh profile's first-run
  // initialization can delay SingletonLock well past any reasonable poll
  // window, and waiting on the lock alone reported "Chrome never opened"
  // against a Chrome that was busily initializing (2026-07-31 probe). The
  // lock remains the QUIT signal below. A child that dies before the lock
  // ever appears is the real launch failure, reported with its stderr.
  const deadline = Date.now() + SIGN_IN_BUDGET_MS
  while (!existsSync(lockPath)) {
    if (!childAlive) {
      throw new Error(
        'Chrome exited before opening the profile.\n' +
          `  Saw (stderr tail): ${stderrTail.trim().slice(-500) || '(nothing)'}\n` +
          '  Fix: run the binary by hand to reproduce: ' +
          `"${chromeBinary}" --user-data-dir=${profileDir} ${NPM_ORIGIN}/login`,
      )
    }
    if (Date.now() > deadline) {
      throw new Error(
        'Chrome is running but never adopted the profile (no lock appeared).',
      )
    }
    await sleep(POLL_MS)
  }
  while (existsSync(lockPath)) {
    if (Date.now() > deadline) {
      throw new Error(
        `still signed in after ${SIGN_IN_BUDGET_MS / 60_000} minutes without quitting Chrome.\n` +
          '  Fix: finish the sign-in, Cmd-Q Chrome, re-run — the profile keeps whatever you completed.',
      )
    }
    await sleep(POLL_MS)
  }
  logger.log('Chrome quit — verifying the seeded session through the driver…')
  const session = await openNpmBrowserSession({ profileDir })
  try {
    return session.user
  } finally {
    await session.close()
  }
}

async function main(): Promise<void> {
  const user = await seedNpmSignIn()
  logger.success(
    `signed in as ${user} — the shared profile now carries the session, ` +
      'and every driver launch reuses it (never re-logs-in).',
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
