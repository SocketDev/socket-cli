import path from 'node:path'
import { PACKAGE_ROOT } from '../paths.mts'

export * from '../paths.mts'

export const SEA_OUTPUT_DIR = path.join(PACKAGE_ROOT, 'dist', 'sea')
export const SEA_BUILD_DIR = path.join(PACKAGE_ROOT, 'build', 'sea')
export const SEA_ENTRY_PATH = path.join(SEA_BUILD_DIR, 'entry.generated.cjs')
export const SEA_PAYLOAD_PATH = path.join(PACKAGE_ROOT, 'build', 'cli.js')
export const SEA_RECEIPT_PATH = path.join(
  SEA_OUTPUT_DIR,
  'manifest.generated.json',
)

export function seaBinaryPath(target: string): string {
  return path.join(
    SEA_OUTPUT_DIR,
    `socket-${target}${target.startsWith('win32-') ? '.exe' : ''}`,
  )
}

export const SEA_ENTRYPOINT_PATHS = Object.fromEntries(
  ['socket', 'socket-npm', 'socket-npx', 'socket-pnpm', 'socket-yarn'].map(
    name => [`${name}.js`, path.join(PACKAGE_ROOT, 'dist', `${name}.js`)],
  ),
)

export const SEA_LAUNCHER_PATH = SEA_ENTRYPOINT_PATHS['socket.js']!
