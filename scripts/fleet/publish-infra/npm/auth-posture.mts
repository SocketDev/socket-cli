/*
 * @file The trusted-publishing auth posture gate, shared by every npm publish
 *   path so no member can drift.
 *
 *   THE POLICY, in three lines:
 *
 *   - From CI: trusted publishing (OIDC) only. A publish carrying
 *     `NODE_AUTH_TOKEN` / `NPM_AUTH_TOKEN` / `NPM_TOKEN` is REFUSED — no
 *     exceptions, no env opt-in, regardless of version or mode. No npm token
 *     ever reaches CI.
 *   - Locally: a `direct` publish is permitted only at exactly `0.0.0`, the name
 *     reservation. Any other direct publish is refused, anywhere.
 *   - Staged real releases are OIDC everywhere.
 *
 *   Why it is enforced in code. The fleet's npm-publish workflow declares
 *   `id-token: write` inside the `npm-publish` environment and lets pnpm trade
 *   that OIDC token for a short-lived registry token. When the exchange fails,
 *   pnpm does NOT stop — it logs `Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE …
 *   404` and continues with whatever other credential the environment carries.
 *   `actions/setup-node` writes `//registry.npmjs.org/:_authToken=
 *   ${NODE_AUTH_TOKEN}` into the runner `.npmrc`, so a member holding that
 *   secret published SUCCESSFULLY under a long-lived token while every log line
 *   said trusted publishing; a member without it died on `[E401]`. Identical
 *   workflow bytes, opposite outcomes, and the difference invisible until a
 *   release failed.
 *
 *   THE CARVE-OUT is gated on the publish SHAPE, never on an environment
 *   variable. npm can only configure a trusted publisher for a name that
 *   ALREADY EXISTS, so a brand-new package has a chicken-and-egg that only a
 *   token can break: `placeholder.mts` publishes a minimal `0.0.0` reservation
 *   to claim the name. That publish is `direct`, at exactly `0.0.0`, and runs
 *   OUTSIDE any CI runner — there is no workflow for it and there must never be
 *   one. The reservation carries no attestation either: its artifact is a
 *   `package.json` plus a one-line README behind `files: []`, so attesting it
 *   would protect nothing, and buying that attestation would mean holding a
 *   publish token in CI — the one thing this policy forbids.
 *
 *   Two phases:
 *
 *   - PREFLIGHT (`publishAuthPreflight`) — refuses before the upload. The token
 *     is what masks a failed exchange; removing the mask is what makes the
 *     failure visible. Also refuses a `0.0.0` reservation attempted from CI,
 *     token or not: that is a policy violation, not a valid path.
 *   - POSTFLIGHT (`publishAuthPostflight`) — scans the command's own output for
 *     the exchange failure whether it exited 0 or not. A publish that
 *     "succeeded" after `Skipped OIDC` is a failure with a green exit code.
 *
 *   There is NO environment opt-out. An env var that converts a refusal into a
 *   warning is exactly the per-member inconsistency this module exists to
 *   remove.
 *
 *   This module does not try to fix the 404. pnpm and the npm CLI request the
 *   SAME exchange path, so a 404 is npm refusing the exchange for the package —
 *   a trusted-publisher registration that does not match the presented claims.
 *   The job here is to stop a token-backed publish from wearing a
 *   trusted-publishing costume, and to point the reader at the registration.
 *
 *   Pure by design — every decision function takes its environment, its publish
 *   shape, and its captured output as arguments, so the whole matrix is
 *   unit-tested with no CI, no registry, and no spawn. Only
 *   `logPublishAuthPosture` touches the logger.
 */

import { logger } from '../shared.mts'

import type { NpmUploadMode } from './publish-command.mts'

/**
 * The reservation version. Deliberately the lowest possible semver so the real
 * first release always supersedes it as `latest`. This is the POLICY constant —
 * the carve-out is defined by it, and `placeholder.mts` publishes it.
 */
export const PLACEHOLDER_RESERVATION_VERSION = '0.0.0'

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

/**
 * Environment variables that mark a CI runner. `GITHUB_ACTIONS` is the fleet's
 * runner; bare `CI` catches every other one, because the reservation carve-out
 * is about "a human or agent ran this on a machine they control", not about
 * which CI provider is hosting it.
 */
export const RUNNER_CONTEXT_ENV_VARS: readonly string[] = [
  'CI',
  'GITHUB_ACTIONS',
]

// pnpm reports a failed OIDC token exchange two ways depending on version: the
// error code, and the human line it prints when it gives up and falls through
// to whatever other credential exists. Either one means the exchange did not
// produce a registry token.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const OIDC_EXCHANGE_FAILURE_RE = /ERR_PNPM_AUTH_TOKEN_EXCHANGE|Skipped OIDC/

// Named once so the refusals and the docs cannot drift from the command an
// operator is told to run.
const PLACEHOLDER_SCRIPT = 'scripts/fleet/publish-infra/npm/placeholder.mts'
const TRUST_SWEEP_SCRIPT = 'scripts/fleet/publish-infra/npm/trust-sweep.mts'

/**
 * The publish auth posture a phase resolved to.
 *
 * - `no-long-lived-token` — a staged publish with no long-lived credential in the
 *   environment, so the OIDC exchange is the only way it can authenticate. The
 *   normal case for every real release.
 * - `placeholder-reservation` — the one sanctioned direct publish: a LOCAL
 *   `direct` upload at exactly `0.0.0`. Allowed, and announced.
 * - `placeholder-in-ci` — a `0.0.0` reservation attempted from a runner. Refused,
 *   token or not.
 * - `direct-publish-is-not-a-reservation` — a `direct` upload at any other
 *   version. Refused, in CI or locally, token or not.
 * - `token-masks-trusted-publishing` — a long-lived token on a staged publish.
 *   Refused.
 * - `oidc-exchange-failed` — the command itself reported the exchange failing.
 *   Refused.
 */
export type PublishAuthVerdict =
  | 'direct-publish-is-not-a-reservation'
  | 'no-long-lived-token'
  | 'oidc-exchange-failed'
  | 'placeholder-in-ci'
  | 'placeholder-reservation'
  | 'token-masks-trusted-publishing'

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
 * The publish being judged. `version` comes from the manifest that is actually
 * being published, read from disk by the caller — never a caller-asserted
 * "this is a placeholder" flag, which would make the carve-out claimable by
 * anything.
 */
export interface PublishShape {
  env: NodeJS.ProcessEnv
  mode: NpmUploadMode
  version: string | undefined
}

/**
 * True when this process is running on a CI runner. The reservation carve-out
 * requires this to be FALSE.
 */
export function isRunnerContext(env: NodeJS.ProcessEnv): boolean {
  for (let i = 0, { length } = RUNNER_CONTEXT_ENV_VARS; i < length; i += 1) {
    if (env[RUNNER_CONTEXT_ENV_VARS[i]!]) {
      return true
    }
  }
  return false
}

/**
 * The runner variables actually set, for quoting in a refusal.
 */
function runnerVarsIn(env: NodeJS.ProcessEnv): string[] {
  return RUNNER_CONTEXT_ENV_VARS.filter(name => env[name])
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
 * True when this publish has the SHAPE of the sanctioned name reservation: a
 * `direct` upload, at exactly `0.0.0`, from outside any CI runner. All three
 * are required — a staged `0.0.0`, a `direct` at any other version, and a
 * reservation attempted in CI are each outside the carve-out.
 */
export function isPlaceholderReservation(shape: PublishShape): boolean {
  const { env, mode, version } = { __proto__: null, ...shape } as PublishShape
  return (
    mode === 'direct' &&
    version === PLACEHOLDER_RESERVATION_VERSION &&
    !isRunnerContext(env)
  )
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

// How a publish describes itself in a message: `staged 6.0.9`, `direct 0.0.0`.
function describeShape(
  mode: NpmUploadMode,
  version: string | undefined,
): string {
  return `${mode} publish at version ${version ?? '<unreadable>'}`
}

/**
 * The preflight posture, resolved BEFORE the upload command runs.
 *
 * `direct` is judged entirely on shape — it is legal only as the local `0.0.0`
 * reservation, so a token never enters the decision. `staged` is judged on the
 * credential: OIDC is the only path, and a long-lived token is what would let a
 * failed exchange pass for a success.
 */
export function publishAuthPreflight(shape: PublishShape): PublishAuthPosture {
  const resolved = { __proto__: null, ...shape } as PublishShape
  const { env, mode, version } = resolved
  if (mode === 'direct') {
    // Not a reservation at all — refused wherever it runs, credential
    // irrelevant. A real release is staged so a bad upload stays rejectable,
    // and staged is what the per-package trusted-publisher grants allow.
    if (version !== PLACEHOLDER_RESERVATION_VERSION) {
      return {
        lines: [
          `Refusing to publish: a direct publish is only ever a ${PLACEHOLDER_RESERVATION_VERSION} name reservation.`,
          `  Where: this run — ${describeShape(mode, version)}.`,
          `  Saw vs wanted: a direct upload of a real version; wanted a STAGED publish authenticated by the OIDC trusted-publisher exchange. Staged keeps a bad upload rejectable before anything is public, and stage-publish is what the per-package trusted-publisher grants actually allow.`,
          `  Fix: publish staged — dispatch npm-publish.yml, or run \`pnpm run npm:publish\`. The only sanctioned direct publish is the one-time ${PLACEHOLDER_RESERVATION_VERSION} placeholder name reservation, run LOCALLY via ${PLACEHOLDER_SCRIPT}.`,
        ],
        ok: false,
        verdict: 'direct-publish-is-not-a-reservation',
      }
    }
    // A reservation, but from a runner: refused whether or not a token is
    // present, because the objection is the workflow, not the credential.
    if (isRunnerContext(env)) {
      return {
        lines: [
          `Refusing to publish: a ${PLACEHOLDER_RESERVATION_VERSION} placeholder reservation must never run in CI.`,
          `  Where: this run has ${runnerVarsIn(env).join(', ')} set, with a ${describeShape(mode, version)}.`,
          `  Saw vs wanted: a name reservation attempted from a workflow; wanted it run locally by a human or an agent. Everything that publishes from CI publishes by trusted publishing, and a reservation cannot — the name does not exist on the registry yet, so no trusted publisher can be configured for it. No npm token ever reaches CI.`,
          `  Fix: run the reservation locally — \`node ${PLACEHOLDER_SCRIPT} <name> --apply\`. Do not add a workflow for it. Then configure the OIDC trusted publisher for the claimed name and release every real version through npm-publish.yml.`,
        ],
        ok: false,
        verdict: 'placeholder-in-ci',
      }
    }
    const reservationTokens = longLivedNpmTokensIn(env)
    return {
      lines: [
        `Placeholder name reservation: publishing ${PLACEHOLDER_RESERVATION_VERSION} with ${reservationTokens.length ? `the long-lived ${reservationTokens.join(', ')} credential` : 'the local npm session'}.`,
        `  Where: a local run — no CI runner context — with a ${describeShape(mode, version)}.`,
        `  Saw vs wanted: this is the ONE sanctioned direct publish. npm can only configure a trusted publisher for a name that already exists, so the name has to be claimed before OIDC can take over.`,
        `  Fix: nothing to fix. Once this lands, configure the OIDC trusted publisher for the name and release every real version through the npm-publish workflow; no later publish may carry a token.`,
      ],
      ok: true,
      verdict: 'placeholder-reservation',
    }
  }
  const tokens = longLivedNpmTokensIn(env)
  if (!tokens.length) {
    return { lines: [], ok: true, verdict: 'no-long-lived-token' }
  }
  return {
    lines: [
      `Refusing to publish: trusted publishing is the only path for a real release.`,
      `  Where: the publish environment, before the upload command runs — ${describeShape(mode, version)}${isRunnerContext(env) ? `, on a CI runner (${runnerVarsIn(env).join(', ')})` : ''}.`,
      `  Saw vs wanted: ${tokens.join(', ')} set; wanted no long-lived npm credential. With a token present pnpm falls through to it when the OIDC exchange fails, so this publish would silently NOT be using trusted publishing and the run would still go green.`,
      `  Fix: remove ${tokens.join(', ')} from the publish job and its environment secrets, and let the OIDC trusted-publisher exchange authenticate. No npm token ever reaches CI. The only publish allowed to carry one is the one-time ${PLACEHOLDER_RESERVATION_VERSION} placeholder name reservation, run LOCALLY via ${PLACEHOLDER_SCRIPT} — there is no workflow for it and there must never be one.`,
    ],
    ok: false,
    verdict: 'token-masks-trusted-publishing',
  }
}

/**
 * The postflight posture, resolved AFTER the upload command returns — on
 * success as well as on failure.
 *
 * A zero exit code is not proof the intended mechanism worked: pnpm logs the
 * exchange failure and carries on. When the captured output reports the
 * exchange failing, the run is a failure regardless of exit code — unless this
 * is the placeholder reservation, where no OIDC was ever possible.
 *
 * `commandSucceeded` only shapes the wording — the verdict is the same either
 * way, because the whole point is that the exit code cannot be trusted here.
 */
export function publishAuthPostflight(
  config: PublishShape & { commandSucceeded: boolean; output: string },
): PublishAuthPosture {
  const resolved = { __proto__: null, ...config } as typeof config
  const { commandSucceeded, env, mode, output, version } = resolved
  const shape: PublishShape = { env, mode, version }
  const reservation = isPlaceholderReservation(shape)
  const failureLine = oidcExchangeFailureIn(output)
  if (!failureLine) {
    return {
      lines: [],
      ok: true,
      verdict: reservation ? 'placeholder-reservation' : 'no-long-lived-token',
    }
  }
  if (reservation) {
    return {
      lines: [
        `The OIDC exchange was skipped for this ${PLACEHOLDER_RESERVATION_VERSION} placeholder reservation, as expected.`,
        `  Where: pnpm's own output from the upload command just above.`,
        `  Saw vs wanted: ${failureLine} — a name that does not exist yet cannot have a trusted publisher, so the reservation is the one publish that authenticates with a token.`,
        `  Fix: nothing to fix. Configure the OIDC trusted publisher for the claimed name next; every real release after this one goes through the npm-publish workflow.`,
      ],
      ok: true,
      verdict: 'placeholder-reservation',
    }
  }
  const tokens = longLivedNpmTokensIn(env)
  const credential = tokens.length
    ? `the long-lived ${tokens.join(', ')} credential`
    : 'no credential at all'
  return {
    lines: [
      commandSucceeded
        ? `The upload exited 0 but the OIDC trusted-publisher exchange FAILED — this run did NOT publish via trusted publishing.`
        : `The OIDC trusted-publisher exchange FAILED.`,
      `  Where: pnpm's own output from the upload command just above (${describeShape(mode, version)}).`,
      `  Saw vs wanted: ${failureLine} — wanted a successful exchange producing a short-lived registry token; the upload fell through to ${credential}. Trusted publishing is the only path for a real release, so this run does not count as one.`,
      `  Fix: this is not a pnpm problem — pnpm and the npm CLI request the SAME exchange path (\`-/npm/v1/oidc/token/exchange/package/<escapedName>\`), so a 404 means npm is refusing the exchange for this package. The trusted-publisher registration does not match the claims this run presents: repository, workflow filename, environment. Inspect and repair it with \`node ${TRUST_SWEEP_SCRIPT}\` (\`--drive\` re-registers; it needs a human with an OTP). A staged upload is still rejectable — reject it rather than approving bytes published under the wrong identity.`,
    ],
    ok: false,
    verdict: 'oidc-exchange-failed',
  }
}

/**
 * Print a posture through the publish logger and hand back its `ok`, so a
 * caller reads as `if (!logPublishAuthPosture(posture)) { … stop … }`.
 *
 * A blocking posture prints at `fail`; the allowed reservation prints at `warn`
 * — it is permitted, but it is never quiet. A clean posture carries no lines
 * and prints nothing.
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
