/**
 * @file Decides what a failed npm upload gets told.
 *   The stage/publish failure path carries two heuristics.
 *   `diagnoseStageConflict` infers a stale staged entry and
 *   `diagnoseStagedAuthFailure` infers a trusted-publisher mismatch. Both are
 *   drawn from the packument, not from what the command actually printed, and
 *   both open with "Probable cause:". When the registry already stated the
 *   cause outright, printing a guess UNDER it makes the guess the loudest
 *   thing in the log and buries the fact two lines up.
 *   That is not hypothetical. A run whose real failure was a
 *   `Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE … 404` followed by an
 *   `[E401] Unable to authenticate` printed a confident "Probable cause: a
 *   staged unpublished entry already exists" beneath it three times running,
 *   and sent two people after a stale stage that never existed.
 *   So: when the captured output contains a DEFINITIVE error — an explicit auth
 *   failure, an OIDC token-exchange failure, or a 403/404 from the registry —
 *   the speculation is suppressed and the definitive line is surfaced instead.
 *   When the output says nothing conclusive, the heuristics run exactly as
 *   before; a genuinely ambiguous failure is still worth a guess.
 */

import {
  diagnoseStageConflict,
  diagnoseStagedAuthFailure,
} from './registry.mts'

/**
 * A definitive failure the command already reported, as opposed to one the
 * heuristics would infer. `label` names the class for the report header,
 * `line` is the offending line lifted verbatim out of the output.
 */
export interface DefinitiveFailure {
  label: string
  line: string
  remedy: string
}

interface FailureSignature {
  label: string
  // Matched against a single output line. Anchored on the registry's own
  // error codes rather than prose, so a reworded npm/pnpm message still hits.
  pattern: RegExp
  remedy: string
}

// Order matters: the FIRST matching signature wins for a given line, and the
// list is scanned most-specific-cause first. A token-exchange 404 and an E401
// usually appear together in an OIDC run, and the exchange failure is the one
// that explains the other.
const FAILURE_SIGNATURES: readonly FailureSignature[] = [
  {
    label: 'OIDC token exchange failed',
    pattern: /ERR_PNPM_AUTH_TOKEN_EXCHANGE|Skipped OIDC/,
    remedy:
      "pnpm could not trade this run's OIDC token for a registry token, so the upload went out unauthenticated. Check that a trusted publisher is registered for this package AND that its repository / workflow / environment match this run.",
  },
  {
    label: 'registry authentication failed',
    pattern: /\bE401\b|\bEOTP\b|Unable to authenticate|need auth/i,
    remedy:
      'The registry rejected the credential this run presented. No local retry fixes it — the token or the trusted-publisher binding has to change.',
  },
  {
    label: 'registry refused the request',
    pattern: /\bE403\b|\bE404\b|\b40[34]\b\s+(?:Forbidden|Not Found)/,
    remedy:
      'The registry answered 403/404. For a scoped package that is usually a missing publish grant or a package name that does not exist yet, not a staging problem.',
  },
]

/**
 * The first definitive error in `output`, or undefined when nothing in it is
 * conclusive.
 *
 * Scans line by line so the returned `line` is quotable verbatim, and scans
 * signatures in cause order per line so the reported class is the most
 * explanatory one present.
 */
export function definitiveFailureIn(
  output: string,
): DefinitiveFailure | undefined {
  if (!output) {
    return undefined
  }
  const lines = output.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (
      let j = 0, { length: signatureCount } = FAILURE_SIGNATURES;
      j < signatureCount;
      j += 1
    ) {
      const signature = FAILURE_SIGNATURES[j]!
      if (signature.pattern.test(line)) {
        return {
          label: signature.label,
          line: line.trim(),
          remedy: signature.remedy,
        }
      }
    }
  }
  return undefined
}

/**
 * The report lines for a definitive failure: the class, the line the command
 * itself printed, and what to do. No "Probable cause" — nothing here is a
 * guess.
 */
export function formatDefinitiveFailure(failure: DefinitiveFailure): string[] {
  return [
    `Definitive cause: ${failure.label}.`,
    `  Saw: ${failure.line}`,
    `  Fix: ${failure.remedy}`,
    '  (Stale-stage and trusted-publisher guesses are suppressed — the',
    '  command already reported the cause above, so a guess would only',
    '  compete with it.)',
  ]
}

/**
 * Everything to log after `pnpm stage publish` / `pnpm publish` exits non-zero.
 *
 * A definitive error in the captured output short-circuits the heuristics.
 * Otherwise the packument-driven diagnoses run — an ambiguous failure is
 * exactly where a probable cause earns its place.
 *
 * `mode` defaults to `staged`. Pass `direct` from the `pnpm publish` path: a
 * direct publish never touches the stage endpoint, so "a staged unpublished
 * entry already exists" cannot be its cause, and printing that guess would send
 * the reader after a stage that by construction does not exist. The
 * trusted-publisher diagnosis still runs — a wrong publisher binding breaks
 * both modes identically.
 */
export async function diagnosePublishFailure(config: {
  mode?: 'direct' | 'staged' | undefined
  name: string
  output: string
  version: string
}): Promise<string[]> {
  const {
    mode = 'staged',
    name,
    output,
    version,
  } = {
    __proto__: null,
    ...config,
  } as typeof config
  const definitive = definitiveFailureIn(output)
  if (definitive) {
    return formatDefinitiveFailure(definitive)
  }
  return [
    ...(mode === 'staged' ? await diagnoseStageConflict(name, version) : []),
    ...(await diagnoseStagedAuthFailure(name)),
  ]
}
