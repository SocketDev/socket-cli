/**
 * @file Browser-read staged-tarball passback for the publish gate. Drives
 *   system Chrome via playwright-core in a durable profile: the operator signs
 *   in to npmjs.com once (OAuth / 2FA in the window), then the SAME signed-in
 *   session reads `/settings/<scope>/staged-packages?format=json` — the staged
 *   view is session-only, invisible to the registry API — and downloads each
 *   staged tarball's bytes THROUGH that session. Those bytes + identities feed
 *   the Socket scan gate (`scan.mts`) so it scans exactly what npm has staged,
 *   without a registry token. The session, the launch shape, the sign-in wait,
 *   and the human-verification PAUSE all come from the sanctioned
 *   `browser-session.mts` — this file adds no launch logic of its own. A
 *   Cloudflare interstitial pauses for the operator with a visible countdown
 *   and is never mis-parsed as JSON nor retried on a ladder. The playwright
 *   I/O is isolated here; the pure parsers live in `staged-browser-parse.mts`
 *   and are unit-tested there.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import type { Page } from 'playwright-core'

import { logger } from '../shared.mts'
import {
  fetchInPage,
  NPM_ORIGIN,
  openNpmBrowserSession,
  runChallengeAware,
  sleep,
} from './browser-session.mts'
import type {
  ChallengeAwareStep,
  NpmBrowserSessionOptions,
} from './browser-session.mts'
import {
  classifyStagedFetch,
  parseStagedPayload,
} from './staged-browser-parse.mts'
import type { StagedPayload, StagedTarball } from './staged-browser-parse.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

// Browser-read tarball size ceiling: the in-page base64 round-trip peaks at
// several times the tarball size and would OOM the renderer or exceed V8's max
// string length on a huge artifact. 256 MB is generous for a package tarball
// and well under that ceiling; a larger staged artifact falls back to the
// registry/local pack path.
const MAX_STAGED_TARBALL_BYTES = 256 * 1024 * 1024

// A status-0 result is a mid-navigation race from a destroyed execution
// context, not a challenge; it clears almost immediately, so it gets a small
// bounded number of fast retries and nothing more.
const RACE_RETRY_MS = 2000
const RACE_MAX_ATTEMPTS = 3

// Read the staged-packages payload. A human-verification challenge PAUSES for
// the operator through the sanctioned helper — never a retry ladder, which
// against a bot challenge earns a rate limit.
async function readStagedPayload(
  page: Page,
  scope: string,
  packageFilter: string | undefined,
  options?:
    | {
        challengeBudgetMs?: number | undefined
        challengePollMs?: number | undefined
        raceRetryMs?: number | undefined
      }
    | undefined,
): Promise<StagedPayload> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const url = `${NPM_ORIGIN}/settings/${encodeURIComponent(scope)}/staged-packages?format=json`
  let raceAttempts = 0
  // The challenge PAUSE + retry rhythm lives in runChallengeAware; this
  // operation only classifies one fetch into done / challenge / a race retry.
  const attempt = async (): Promise<ChallengeAwareStep<StagedPayload>> => {
    const last = await fetchInPage(page, url, 'application/json')
    const state = classifyStagedFetch({ body: last.body, status: last.status })
    if (state === 'ok') {
      return {
        kind: 'done',
        value: parseStagedPayload(last.body, packageFilter),
      }
    }
    if (state === 'auth') {
      throw new Error(
        `Staged-packages read needs sign-in (HTTP ${last.status}). Re-run and sign in.`,
      )
    }
    if (state === 'error') {
      // A status-0 result is fetchInPage's documented mid-navigation race from
      // a destroyed execution context — retry it a couple of times, fast.
      if (last.status === 0 && raceAttempts < RACE_MAX_ATTEMPTS) {
        raceAttempts += 1
        await sleep(opts.raceRetryMs ?? RACE_RETRY_MS)
        return { kind: 'retry' }
      }
      throw new Error(
        `Staged-packages read failed (HTTP ${last.status}). Re-run and sign in.`,
      )
    }
    return { kind: 'challenge' }
  }
  return runChallengeAware(page, attempt, {
    budgetMs: opts.challengeBudgetMs,
    label: 'the staged-packages read',
    pollMs: opts.challengePollMs,
    url,
  })
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
  const label = `${tarball.packageName}@${tarball.version}`
  let result:
    | { base64: string; kind: 'ok' }
    | { bytes: number; kind: 'too-large' }
    | { kind: 'error' }
  try {
    result = await page.evaluate(
      async ({ fetchUrl, maxBytes }) => {
        // oxlint-disable-next-line socket/no-fetch-prefer-http-request -- runs in the npm page's MAIN world; only the page session can read the staged tarball.
        const r = await fetch(fetchUrl, {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (!r.ok) {
          return { kind: 'error' as const }
        }
        // Reject before buffering when the server declares an oversize body,
        // and again after reading in case it was chunked with no length. The
        // base64 round-trip below peaks at several times the tarball size and
        // would OOM the renderer or blow V8's max string length on a huge
        // artifact; a too-large result falls back to the registry/local pack.
        const declared = Number(r.headers.get('content-length') || '0')
        if (declared > maxBytes) {
          return { bytes: declared, kind: 'too-large' as const }
        }
        const buf = new Uint8Array(await r.arrayBuffer())
        if (buf.byteLength > maxBytes) {
          return { bytes: buf.byteLength, kind: 'too-large' as const }
        }
        let binary = ''
        for (let i = 0, { length } = buf; i < length; i += 1) {
          binary += String.fromCharCode(buf[i]!)
        }
        return { base64: btoa(binary), kind: 'ok' as const }
      },
      { fetchUrl: url, maxBytes: MAX_STAGED_TARBALL_BYTES },
    )
  } catch (e) {
    logger.warn(
      `Could not read staged tarball for ${label} in the browser (${errorMessage(e)}).`,
    )
    return undefined
  }
  if (result.kind === 'too-large') {
    logger.warn(
      `Staged tarball for ${label} is ${result.bytes} bytes, over the ${MAX_STAGED_TARBALL_BYTES}-byte browser-read cap; falling back to the registry/local pack.`,
    )
    return undefined
  }
  if (result.kind === 'error' || !result.base64) {
    return undefined
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-staged-tar-'))
  const file = path.join(dir, 'staged.tgz')
  await fs.writeFile(file, Buffer.from(result.base64, 'base64'))
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
    | (NpmBrowserSessionOptions & { packageFilter?: string | undefined })
    | undefined,
): Promise<StagedBrowserSession> {
  const { packageFilter, ...sessionOptions } = {
    __proto__: null,
    ...options,
  } as NonNullable<typeof options>
  const session = await openNpmBrowserSession(sessionOptions)
  const { page, user } = session
  try {
    const payload = await readStagedPayload(page, user, packageFilter)
    logger.log(
      `Browser-read staged: ${payload.tarballs.length} of ${payload.total} staged package(s) for ${user}.`,
    )
    return {
      close: session.close,
      page,
      scope: user,
      tarballs: payload.tarballs,
    }
  } catch (e) {
    await session.close()
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
