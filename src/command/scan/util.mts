import path from 'node:path'

export function resolveScanCwd(
  processCwd: string,
  cwdOverride: string,
): string {
  return cwdOverride && cwdOverride !== '.' && cwdOverride !== processCwd
    ? path.resolve(processCwd, cwdOverride)
    : processCwd
}
