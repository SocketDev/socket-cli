import path from 'node:path'
import process from 'node:process'

/**
 * Select Windows' native bsdtar; use the PATH-provided tar on POSIX.
 */
export function tarExecutable(
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = process.env['SystemRoot'],
): string {
  return platform === 'win32'
    ? path.join(systemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
}
