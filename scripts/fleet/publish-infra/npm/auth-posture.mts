/**
 * @file The trusted-publishing auth posture gate, shared by every npm publish
 *   path so no member can drift.
 *   The fleet's npm-publish workflow declares `id-token: write` inside the
 *   `npm-publish` environment and lets pnpm trade that OIDC token for a
 *   short-lived registry token. When the exchange fails, pnpm does NOT stop —
 *   it logs `Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE … 404` and continues
 *   with whatever other credential the environment happens to carry.
 *   That is where two members diverged with identical workflow bytes. A repo
 *   whose `npm-publish` environment holds a long-lived `NODE_AUTH_TOKEN`
 *   published SUCCESSFULLY — `actions/setup-node` writes
 *   `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into the runner's
 *   `.npmrc`, so the token silently covered the failed exchange. A repo with no
 *   such secret died on `[E401] Unable to authenticate`. Same intended
 *   mechanism, one green run and one red run, and the green one was publishing
 *   with a long-lived credential while every log line said trusted publishing.
 *   So the posture is asserted in code, in both directions:
 *
 *   - PREFLIGHT (`publishAuthPreflight`) — inside GitHub Actions, a long-lived
 *     npm token in the environment is refused BEFORE the upload. The token is
 *     the thing that masks a failed exchange; removing the mask is what makes
 *     the failure visible.
 *   - POSTFLIGHT (`publishAuthPostflight`) — the command's own output is scanned
 *     for the exchange failure whether it exited 0 or not. A publish that
 *     "succeeded" after `Skipped OIDC` is a failure with a green exit code, and
 *     it is reported as one. Both phases honor ONE explicitly-declared opt-out,
 *     `SOCKET_PUBLISH_ALLOW_TOKEN_FALLBACK=1`, which does not silence anything:
 *     it converts the refusal into a loud log line that names the token being
 *     used. There is no configuration under which a token publish looks like a
 *     trusted-publisher publish. This module does NOT try to fix the 404
 *     itself. Whether a given package's trusted publisher is registered against
 *     the right repository / workflow / environment is a registry-side
 *     question; the job here is to stop a token-backed publish from wearing a
 *     trusted-publishing costume. Pure by design — every decision function
 *     takes its environment and its captured output as arguments, so the whole
 *     matrix is unit-tested with no CI, no registry, and no spawn. Only
 *     `logPublishAuthPosture` touches the logger.
 */

import { logger } from '../shared.mts'

/**
 * The one sanctioned opt-out. Set it to a non-empty value to allow a
 * long-lived-token publish; the run then SAYS it is one, loudly, in both
 * phases. This is a break-glass declaration, not a mute switch.
 */
export const PUBLISH_TOKEN_FALLBACK_ENV = 'SOCKET_PUBLISH_ALLOW_TOKEN_FALLBACK'

/**
 * Environment variables that carry a long-lived npm credential into a publish.
 * `NODE_AUTH_TOKEN` is the one `actions/setup-node` bakes into the runner
 * `.npmrc`; the other two are the names CI templates most often reach for.
 */
export const LONG_LIVED_NPM_TOKEN_ENV_VARS: readonly string[] = [
  'NODE_AUTH_TOKEN',
  'NPM_AUTH_TOKEN',
  'NPM_TOKEN',
]

// pnpm reports a failed OIDC token exchange two ways depending on version: the
// error code, and the human line it prints when it gives up and falls through
// to whatever other credential exists. Either one means the exchange did not
// produce a registry token.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const OIDC_EXCHANGE_FAILURE_RE = /ERR_PNPM_AUTH_TOKEN_EXCHANGE|Skipped OIDC/

/**
 * The publish auth posture a phase resolved to.
 *
 * - `no-trusted-publishing` — not a GitHub Actions run; OIDC was never on the
 *   table, so there is nothing to mask. Local publishes land here.
 * - `trusted-publishing` — OIDC is the mechanism and nothing contradicts it.
 * - `declared-token-fallback` — a long-lived token is in play AND the operator
 *   declared it via the opt-out. Allowed, and announced.
 * - `masked-token-fallback` — a long-lived token is in play and nobody declared
 *   it. Refused.
 * - `oidc-exchange-failed` — the command itself reported the exchange failing.
 *   Refused.
 */
export type PublishAuthVerdict =
  | 'declared-token-fallback'
  | 'masked-token-fallback'
  | 'no-trusted-publishing'
  | 'oidc-exchange-failed'
  | 'trusted-publishing'

export interface PublishAuthPosture {
  /**
   * False when the caller must stop: log `lines` and exit non-zero.
   */
  ok: boolean
  /**
   * Ready-to-log lines. Empty when there is nothing worth saying.
   */
  lines: readonly string[]
  verdict: PublishAuthVerdict
}

/**
 * True when this process is running inside GitHub Actions, where the fleet's
 * intended npm credential is the OIDC trusted-publisher exchange.
 */
export function isGithubActionsRun(env: NodeJS.ProcessEnv): boolean {
  return env['GITHUB_ACTIONS'] === 'true'
}

/**
 * True when the operator declared the long-lived-token fallback.
 */
export function isTokenFallbackDeclared(env: NodeJS.ProcessEnv): boolean {
  return !!env[PUBLISH_TOKEN_FALLBACK_ENV]
}

/**
 * The long-lived npm token variables actually populated in `env`, in the
 * declaration order of `LONG_LIVED_NPM_TOKEN_ENV_VARS`. Names only — a value is
 * never returned, logged, or compared, so a token cannot leak through this
 * module into CI output.
 */
export function longLivedNpmTokensIn(env: NodeJS.ProcessEnv): string[] {
  const found: string[] = []
  for (
    let i = 0, { length } = LONG_LIVED_NPM_TOKEN_ENV_VARS;
    i < length;
    i += 1
  ) {
    const name = LONG_LIVED_NPM_TOKEN_ENV_VARS[i]!
    if (env[name]) {
      found.push(name)
    }
  }
  return found
}

/**
 * The verbatim line on which pnpm reported the OIDC token exchange failing, or
 * undefined when the output carries no such report. Returns the line rather
 * than a boolean so the caller can quote what the tool actually said instead of
 * paraphrasing it.
 */
export function oidcExchangeFailureIn(output: string): string | undefined {
  if (!output) {
    return undefined
  }
  const lines = output.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (OIDC_EXCHANGE_FAILURE_RE.test(line)) {
      return line.trim()
    }
  }
  return undefined
}

/**
 * The preflight posture, resolved BEFORE the upload command runs.
 *
 * Refuses a GitHub Actions publish that carries a long-lived npm token, because
 * that token is exactly what turns a failed OIDC exchange into a green run. Off
 * GitHub Actions this is a no-op: a laptop publish has no OIDC to impersonate.
 */
export function publishAuthPreflight(
  env: NodeJS.ProcessEnv,
): PublishAuthPosture {
  if (!isGithubActionsRun(env)) {
    return { lines: [], ok: true, verdict: 'no-trusted-publishing' }
  }
  const tokens = longLivedNpmTokensIn(env)
  if (!tokens.length) {
    return { lines: [], ok: true, verdict: 'trusted-publishing' }
  }
  if (isTokenFallbackDeclared(env)) {
    return {
      lines: [
        `Publishing with a LONG-LIVED npm token, not trusted publishing.`,
        `  Where: this GitHub Actions job, with ${PUBLISH_TOKEN_FALLBACK_ENV} set.`,
        `  Saw vs wanted: ${tokens.join(', ')} present in the environment; the fleet default is an OIDC trusted-publisher exchange with no long-lived credential.`,
        `  Fix: nothing is blocked — the fallback was declared. To return to trusted publishing, unset ${PUBLISH_TOKEN_FALLBACK_ENV} and remove ${tokens.join(', ')} from the publish environment.`,
      ],
      ok: true,
      verdict: 'declared-token-fallback',
    }
  }
  return {
    lines: [
      `Refusing to publish: a long-lived npm token would mask trusted publishing.`,
      `  Where: this GitHub Actions job's environment, before the upload command runs.`,
      `  Saw vs wanted: ${tokens.join(', ')} set; wanted no long-lived npm credential, so the OIDC trusted-publisher exchange is the only way this run can authenticate. With the token present, a failed exchange still publishes and the run goes green under the wrong identity.`,
      `  Fix: remove ${tokens.join(', ')} from the publish job / environment secrets and let the OIDC exchange authenticate. If a token publish is genuinely intended, declare it with ${PUBLISH_TOKEN_FALLBACK_ENV}=1 — the run then says so in the log instead of impersonating trusted publishing.`,
    ],
    ok: false,
    verdict: 'masked-token-fallback',
  }
}

/**
 * The postflight posture, resolved AFTER the upload command returns — on
 * success as well as on failure.
 *
 * A zero exit code is not proof the intended mechanism worked: pnpm logs the
 * exchange failure and carries on. When the captured output reports the
 * exchange failing, the run is a failure regardless of exit code, unless the
 * fallback was declared, in which case it is a loud, named token publish.
 *
 * `commandSucceeded` only shapes the wording — the verdict is the same either
 * way, because the whole point is that the exit code cannot be trusted here.
 */
export function publishAuthPostflight(config: {
  commandSucceeded: boolean
  env: NodeJS.ProcessEnv
  output: string
}): PublishAuthPosture {
  const { commandSucceeded, env, output } = {
    __proto__: null,
    ...config,
  } as typeof config
  const failureLine = oidcExchangeFailureIn(output)
  if (!failureLine) {
    return {
      lines: [],
      ok: true,
      verdict: isGithubActionsRun(env)
        ? 'trusted-publishing'
        : 'no-trusted-publishing',
    }
  }
  const tokens = longLivedNpmTokensIn(env)
  const credential = tokens.length
    ? `the long-lived ${tokens.join(', ')} credential`
    : 'no credential at all'
  if (isTokenFallbackDeclared(env)) {
    return {
      lines: [
        `The OIDC trusted-publisher exchange FAILED; this upload used ${credential}.`,
        `  Where: pnpm's own output from the upload command just above.`,
        `  Saw vs wanted: ${failureLine} — wanted a successful token exchange.`,
        `  Fix: allowed only because ${PUBLISH_TOKEN_FALLBACK_ENV} is set. Register / repair the package's trusted publisher (its repository, workflow filename, and environment must all match this run), then unset ${PUBLISH_TOKEN_FALLBACK_ENV}.`,
      ],
      ok: true,
      verdict: 'declared-token-fallback',
    }
  }
  return {
    lines: [
      commandSucceeded
        ? `The upload exited 0 but the OIDC trusted-publisher exchange FAILED — this run did NOT publish via trusted publishing.`
        : `The OIDC trusted-publisher exchange FAILED.`,
      `  Where: pnpm's own output from the upload command just above.`,
      `  Saw vs wanted: ${failureLine} — wanted a successful exchange producing a short-lived registry token; the upload fell through to ${credential}.`,
      `  Fix: check that a trusted publisher is registered for this package AND that its repository, workflow filename, and environment match this run — \`node scripts/fleet/publish-infra/npm/trust-sweep.mts\` prints the expected binding and re-registers it with --drive. A staged upload is still rejectable — reject it rather than approving bytes published under the wrong identity.`,
    ],
    ok: false,
    verdict: 'oidc-exchange-failed',
  }
}

/**
 * Print a posture through the publish logger and hand back its `ok`, so a
 * caller reads as `if (!logPublishAuthPosture(posture)) { … stop … }`.
 *
 * A blocking posture prints at `fail`; a declared fallback prints at `warn` —
 * it is allowed, but it is never quiet. A clean posture carries no lines and
 * prints nothing.
 */
export function logPublishAuthPosture(posture: PublishAuthPosture): boolean {
  const { lines, ok } = posture
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (ok) {
      logger.warn(lines[i]!)
    } else {
      logger.fail(lines[i]!)
    }
  }
  return ok
}
