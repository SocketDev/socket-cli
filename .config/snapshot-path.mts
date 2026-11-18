import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

export function resolveSnapshotPath(
  testPath: string,
  extension: string,
): string {
  return path.join(
    root,
    'test/snapshots/vite',
    path.relative(root, testPath) + extension,
  )
}
