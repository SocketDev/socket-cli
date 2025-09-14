import { logger } from '@socketsecurity/registry/lib/logger'

import { findBinPathDetailsSync } from './path-resolve.mts'

function exitWithBinPathError(binName: string): never {
  logger.fail(
    `Socket unable to locate ${binName}; ensure it is available in the PATH environment variable`,
  )
  // The exit code 127 indicates that the command or binary being executed
  // could not be found.
  // eslint-disable-next-line n/no-process-exit
  process.exit(127)
}

let _pnpmBinPath: string | undefined
export function getPnpmBinPath(): string {
  if (_pnpmBinPath === undefined) {
    _pnpmBinPath = getPnpmBinPathDetails().path
    if (!_pnpmBinPath) {
      exitWithBinPathError('pnpm')
    }
  }
  return _pnpmBinPath
}

let _pnpmBinPathDetails: ReturnType<typeof findBinPathDetailsSync> | undefined
export function getPnpmBinPathDetails(): ReturnType<
  typeof findBinPathDetailsSync
> {
  if (_pnpmBinPathDetails === undefined) {
    _pnpmBinPathDetails = findBinPathDetailsSync('pnpm')
  }
  return _pnpmBinPathDetails
}

export function isPnpmBinPathShadowed(): boolean {
  return getPnpmBinPathDetails().shadowed
}
