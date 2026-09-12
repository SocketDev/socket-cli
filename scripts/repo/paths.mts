import path from 'node:path'

import { REPO_ROOT } from '../fleet/paths.mts'

export * from '../fleet/paths.mts'

export const rootPath = REPO_ROOT

export function resolveRepoSourceIndexPath(root: string): string {
  return path.join(root, 'src', 'index.mts')
}
