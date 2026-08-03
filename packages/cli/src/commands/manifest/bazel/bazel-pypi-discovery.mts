/**
 * PyPI hub discovery for `socket manifest bazel --ecosystem pypi`: probe
 * validation of parsed candidates plus the two-step compose (parse, then
 * validate). Candidate parsing lives in `bazel-pypi-candidates.mts`.
 */
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  dedupCapped,
  parsePypiHubCandidates,
} from './bazel-pypi-candidates.mts'

import type { PypiHubCandidate, PypiHubInfo } from './bazel-pypi-candidates.mts'
import type { RepoProbe } from './bazel-repo-discovery.mts'

export type { PypiHubCandidate, PypiHubInfo } from './bazel-pypi-candidates.mts'

const logger = getDefaultLogger()

// Result shape returned by `validatePypiHub`. Kept local to the PyPI module
// since validation here is hub-alias-marker based (different from the
// Maven-side tri-state classifier).
export type ValidationResult = {
  valid: boolean
  // Probe stdout — populated whenever the probe was reachable, even when
  // validation rejects the hub. Empty string when the probe itself threw.
  stdout: string
}

// Hub validation: accept alias rules or `:pkg` targets in probe stdout.
// Does NOT require `pypi_name=` — that marker lives on spoke repos.
const PYPI_HUB_MARKER_RE = /:pkg\b|alias\s*\(/

// The default pip hub name when no explicit hub_name/name is given.
// Included as a seed so repos whose pip.parse is in a sub-module (not
// found by static scanning) can still be discovered via probe validation.
const DEFAULT_PYPI_HUB_SEED = 'pypi'

// Composition: parse, then validate each candidate; return validated subset
// as a Map keyed by hub name with the validated PypiHubInfo.
// Always seeds with the default 'pypi' hub name first.
export async function discoverPypiHubs(
  cwd: string,
  probe: RepoProbe,
  options?:
    | {
        // Candidates already enumerated via `bazel mod show_extension`; when
        // present they take precedence over the static parse.
        bazelCommandCandidates?: PypiHubCandidate[] | undefined
        // Bzlmod visible-repo names; corroborating data only — many non-PyPI
        // repositories expose alias or :pkg targets, so bare visible repos
        // are too broad to probe as PyPI hubs.
        nativeCandidates?: string[] | undefined
        verbose?: boolean | undefined
      }
    | undefined,
): Promise<Map<string, PypiHubInfo>> {
  const { bazelCommandCandidates, nativeCandidates, verbose } = {
    __proto__: null,
    ...options,
  } as {
    bazelCommandCandidates?: PypiHubCandidate[] | undefined
    nativeCandidates?: string[] | undefined
    verbose?: boolean | undefined
  }
  // Always run the static parse so MODULE.bazel pip.parse metadata
  // (requirements_lock, python_version) is available for downstream
  // lockfile resolution.
  const parsed: PypiHubCandidate[] = bazelCommandCandidates?.length
    ? dedupCapped(bazelCommandCandidates, { verbose })
    : parsePypiHubCandidates(cwd, { verbose })
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: candidate source:',
      bazelCommandCandidates?.length
        ? `bazel mod show_extension (${parsed.length})`
        : nativeCandidates?.length
          ? `static parse (${parsed.length}) with bzlmod visible-repos (${nativeCandidates.length}) as corroboration`
          : `static parse (${parsed.length})`,
    )
  }
  // Prepend the default hub seed unless parsed metadata already covers it.
  const candidates: PypiHubCandidate[] = parsed.some(
    c => c.hubName === DEFAULT_PYPI_HUB_SEED,
  )
    ? parsed
    : [
        {
          hubName: DEFAULT_PYPI_HUB_SEED,
          source: 'default-seed',
          workspaceMode: 'unknown',
        },
        ...parsed,
      ]
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: candidate set to probe (seed-first, deduped):',
      candidates.map(c => c.hubName),
    )
  }
  const validated = new Map<string, PypiHubInfo>()
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const c = candidates[i]!
    const result = await validatePypiHub(c.hubName, probe, { verbose })
    if (result.valid) {
      validated.set(c.hubName, {
        ...c,
        probeStdout: result.stdout,
      })
    }
  }
  if (verbose) {
    logger.log(
      '[VERBOSE] discovery: validated pip hubs:',
      Array.from(validated.keys()),
    )
  }
  return validated
}

// Validate a candidate by running the probe and confirming `:pkg` labels or
// alias rules appear in stdout. Does NOT require `pypi_name=` (that marker
// lives on spoke repos).
export async function validatePypiHub(
  hubName: string,
  probe: RepoProbe,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<ValidationResult> {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  try {
    const result = await probe(hubName)
    if (result.code !== 0) {
      if (verbose) {
        logger.log(
          `[VERBOSE] discovery: probe @${hubName}: REJECT (code=${result.code})`,
        )
      }
      return { stdout: result.stdout, valid: false }
    }
    const valid = PYPI_HUB_MARKER_RE.test(result.stdout)
    if (verbose) {
      logger.log(
        `[VERBOSE] discovery: probe @${hubName}:`,
        valid
          ? 'ACCEPT (hub alias/pkg marker found)'
          : 'REJECT (no hub alias/pkg marker in probe stdout)',
      )
    }
    return { stdout: result.stdout, valid }
  } catch (e) {
    if (verbose) {
      logger.log(
        `[VERBOSE] discovery: probe @${hubName}: REJECT (probe threw):`,
        errorMessage(e),
      )
    }
    return { stdout: '', valid: false }
  }
}
