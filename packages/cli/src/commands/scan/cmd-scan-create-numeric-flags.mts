import { InputError } from '../../util/error/errors.mts'

export interface ScanCreateNumericFlagsInput {
  pullRequest: number
  reachAnalysisMemoryLimit: number
  reachAnalysisTimeout: number
  reachConcurrency: number
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
