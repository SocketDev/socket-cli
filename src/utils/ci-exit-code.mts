import constants from '../constants.mts'

export type CiExitCodePolicy = {
  disableBlocking: boolean
  exitCodeOnApiError?: number | undefined
}

export type CiExitCodeKind =
  | 'api'
  | 'blocking'
  | 'infrastructure'
  | 'interrupted'
  | 'usage'

export const ciExitCodeState: { policy?: CiExitCodePolicy | undefined } = {}

export function setCiExitCodePolicy(
  policy?: CiExitCodePolicy | undefined,
): void {
  ciExitCodeState.policy = policy
}

export function hasCiExitCodePolicy(): boolean {
  return ciExitCodeState.policy !== undefined
}

export function setCiExitCode(
  kind: CiExitCodeKind,
  fallback: number = 1,
): void {
  const { policy } = ciExitCodeState
  if (!policy) {
    process.exitCode = fallback
    return
  }

  if (kind !== 'usage' && constants.abortSignal.aborted) {
    kind = 'interrupted'
  }

  if (kind === 'usage') {
    process.exitCode = 2
    return
  }

  if (policy.disableBlocking) {
    process.exitCode = 0
    return
  }

  switch (kind) {
    case 'api':
      process.exitCode = policy.exitCodeOnApiError ?? 3
      return
    case 'blocking':
      process.exitCode = 1
      return
    case 'infrastructure':
      process.exitCode = 3
      return
    case 'interrupted':
      process.exitCode = 130
      return
  }
}
