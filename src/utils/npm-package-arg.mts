/** @fileoverview Safe wrapper for npm-package-arg parsing. */

import npmPackageArg from 'npm-package-arg'

export type {
  AliasResult,
  FileResult,
  HostedGit,
  HostedGitResult,
  RegistryResult,
  Result,
  URLResult,
} from 'npm-package-arg'

/**
 * Safe wrapper for npm-package-arg that doesn't throw.
 * Returns undefined if parsing fails.
 */
export function safeNpa(
  ...args: Parameters<typeof npmPackageArg>
): ReturnType<typeof npmPackageArg> | undefined {
  try {
    return Reflect.apply(npmPackageArg, undefined, args)
  } catch {}
  return undefined
}
