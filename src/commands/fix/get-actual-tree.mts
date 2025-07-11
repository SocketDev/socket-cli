import { Arborist } from '../../shadow/npm/arborist/index.mts'
import { SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES } from '../../shadow/npm/arborist/lib/arborist/index.mts'

import type { NodeClass } from '../../shadow/npm/arborist/types.mts'

export async function getActualTree(
  cwd: string = process.cwd(),
): Promise<NodeClass> {
  // @npmcli/arborist DOES have partial support for pnpm structured node_modules
  // folders. However, support is iffy resulting in unhappy path errors and hangs.
  // So, to avoid the unhappy path, we restrict our usage to --dry-run loading
  // of the node_modules folder.
  const arb = new Arborist({
    path: cwd,
    ...SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  })
  return await arb.loadActual()
}
