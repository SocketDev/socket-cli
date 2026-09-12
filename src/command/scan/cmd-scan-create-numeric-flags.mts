import { InputError } from '../../util/error/errors.mts'

// The meow layer types numeric flags as `number`, but at runtime a user who
// passes `--reach-analysis-timeout=abc` delivers the raw STRING — the honest
// boundary type is the union, and the `Number(...)` coercions below are what
// turn garbage into NaN so the validators can reject it.
export interface ScanCreateNumericFlagsInput {
  pullRequest: number | string
  reachAnalysisMemoryLimit: number | string
  reachAnalysisTimeout: number | string
  reachConcurrency: number | string
}

export interface ScanCreateNumericFlagsResult {
  validatedPullRequest: number
  validatedReachAnalysisMemoryLimit: number
  validatedReachAnalysisTimeout: number
  validatedReachConcurrency: number
}

/**
 * Coerce and validate the numeric `socket scan create` flags (pull request
 * number, reachability memory limit/timeout/concurrency).
 */
export function validateScanCreateNumericFlags(
  flags: ScanCreateNumericFlagsInput,
): ScanCreateNumericFlagsResult {
  const {
    pullRequest,
    reachAnalysisMemoryLimit,
    reachAnalysisTimeout,
    reachConcurrency,
  } = flags

  const validatedPullRequest = Number(pullRequest)
  if (
    pullRequest !== undefined &&
    (Number.isNaN(validatedPullRequest) ||
      !Number.isInteger(validatedPullRequest) ||
      validatedPullRequest < 0)
  ) {
    throw new InputError(
      `--pull-request must be a non-negative integer (saw: "${pullRequest}"); pass a number like --pull-request=42`,
    )
  }

  const validatedReachAnalysisMemoryLimit = Number(reachAnalysisMemoryLimit)
  if (
    reachAnalysisMemoryLimit !== undefined &&
    Number.isNaN(validatedReachAnalysisMemoryLimit)
  ) {
    throw new InputError(
      `--reach-analysis-memory-limit must be a number of megabytes (saw: "${reachAnalysisMemoryLimit}"); pass an integer like --reach-analysis-memory-limit=4096`,
    )
  }

  const validatedReachAnalysisTimeout = Number(reachAnalysisTimeout)
  if (
    reachAnalysisTimeout !== undefined &&
    Number.isNaN(validatedReachAnalysisTimeout)
  ) {
    throw new InputError(
      `--reach-analysis-timeout must be a number of seconds (saw: "${reachAnalysisTimeout}"); pass an integer like --reach-analysis-timeout=300`,
    )
  }

  const validatedReachConcurrency = Number(reachConcurrency)
  if (
    reachConcurrency !== undefined &&
    (Number.isNaN(validatedReachConcurrency) ||
      !Number.isInteger(validatedReachConcurrency) ||
      validatedReachConcurrency <= 0)
  ) {
    throw new InputError(
      `--reach-concurrency must be a positive integer (saw: "${reachConcurrency}"); pass a number like --reach-concurrency=4`,
    )
  }

  return {
    validatedPullRequest,
    validatedReachAnalysisMemoryLimit,
    validatedReachAnalysisTimeout,
    validatedReachConcurrency,
  }
}
