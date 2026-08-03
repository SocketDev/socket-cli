/**
 * @file Npm auth for the approve flow. The staging endpoints 401 without a
 *   token, and `pnpm stage list`'s failure output parses as an EMPTY stage
 *   list, so a missing login must be repaired BEFORE anything reads the stage
 *   list. On a real terminal `npm login` owns the flow; without a TTY the
 *   registry's web-login protocol runs by hand (npm login's non-TTY path
 *   bails to the legacy `Username:` prompt, which EOFs and dies in
 *   agent-driven runs — the runs `--yes` exists for).
 */

import process from 'node:process'

import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { sleep } from '@socketsecurity/lib-stable/promises/timers'

import { NPM_REGISTRY_URL } from '../../constants/npm-registry.mts'
import { npmScratchCwd } from './shared.mts'
import { logger, runCapture, runInherit } from '../shared.mts'

// Best-effort: pop the default browser at `url`. Non-fatal when it can't
// (headless / CI) — the caller prints the URL either way.
async function openBrowser(url: string, cwd: string): Promise<void> {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  try {
    await runCapture(opener, [url], cwd)
  } catch {
    // Printing the URL is the fallback; nothing to do.
  }
}

/**
 * The registry's web-login protocol, done by hand: create a session
 * (POST /-/v1/login), hand the human the login URL (opening the browser
 * best-effort), poll `doneUrl` until the token arrives, persist it with
 * `npm config set`. `npm login` isn't spawnable here: without a TTY its web
 * flow bails to the legacy `Username:` prompt, which EOFs and dies in
 * agent-driven runs — and those runs are the reason `--yes` exists.
 */
async function webLogin(scratchCwd: string): Promise<boolean> {
  // `npm-auth-type: web` is load-bearing: without it the registry 401s the
  // session create, it gates the endpoint on the client declaring web auth.
  const created = await httpRequest(`${NPM_REGISTRY_URL}/-/v1/login`, {
    body: '{}',
    headers: {
      'content-type': 'application/json',
      'npm-auth-type': 'web',
      'npm-command': 'login',
    },
    method: 'POST',
  })
  if (!created.ok) {
    logger.fail(`Web-login session create failed (${created.status}).`)
    return false
  }
  const session = created.json<{
    doneUrl?: string | undefined
    loginUrl?: string | undefined
  }>()
  if (!session.loginUrl || !session.doneUrl) {
    logger.fail('Web-login session response missing loginUrl/doneUrl.')
    return false
  }
  logger.log(`Authenticate in the browser: ${session.loginUrl}`)
  await openBrowser(session.loginUrl, scratchCwd)
  // Poll until authenticated: 202 (+ retry-after) while pending, 200 + token
  // once the human completes the browser challenge. Cap at ~10 minutes.
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const done = await httpRequest(session.doneUrl, {
      headers: { 'npm-auth-type': 'web', 'npm-command': 'login' },
    })
    if (done.status === 200) {
      const { token } = done.json<{ token?: string | undefined }>()
      if (!token) {
        logger.fail('Web-login done response carried no token.')
        return false
      }
      // `--location=user` anchors the write to the user npmrc no matter the
      // cwd, so the scratch cwd never redirects where the token lands.
      const { code } = await runCapture(
        'npm',
        [
          'config',
          'set',
          `//registry.npmjs.org/:_authToken=${token}`,
          '--location=user',
        ],
        npmScratchCwd(),
      )
      if (code !== 0) {
        logger.fail(
          `Persisting the npm token failed (npm config set → ${code}).`,
        )
        return false
      }
      logger.success('npm web login complete; token saved to the user npmrc.')
      return true
    }
    if (done.status !== 202) {
      logger.fail(`Web-login poll failed (${done.status}).`)
      return false
    }
    const retryAfterHeader = done.headers['retry-after']
    const retryAfter = Number(
      Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader,
    )
    // eslint-disable-next-line no-await-in-loop
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000,
    )
  }
  logger.fail('Web-login timed out after 10 minutes.')
  return false
}

/**
 * Ensure local npm auth before touching the staging endpoints — they 401
 * without a token, and `pnpm stage list`'s failure output parses as an EMPTY
 * stage list, which would silently no-op the whole approve. When logged out:
 * on a real terminal, defer to `npm login` (its web-first flow is the nicest
 * UX there); without a TTY, run the web-login protocol directly. npm
 * commands run from npmScratchCwd() — see its doc for why the temp dir is
 * the only cwd that dodges both the repo's devEngines veto and lib spawn's
 * untrusted-root PATH sanitization.
 */
export async function ensureNpmLogin(): Promise<boolean> {
  const scratchCwd = npmScratchCwd()
  const { code } = await runCapture('npm', ['whoami'], scratchCwd)
  if (code === 0) {
    return true
  }
  logger.log('Not logged in to npm — starting browser login…')
  if (process.stdin.isTTY) {
    const login = await runInherit('npm', ['login'], scratchCwd)
    if (login !== 0) {
      logger.fail(`npm login exited ${login}.`)
      return false
    }
    return true
  }
  return await webLogin(scratchCwd)
}
