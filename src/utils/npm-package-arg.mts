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

export function npa(
  ...args: Parameters<typeof npmPackageArg>
): ReturnType<typeof npmPackageArg> | null {
  try {
    return Reflect.apply(npmPackageArg, undefined, args)
  } catch {}
  return null
}
