import { Arborist } from '../../shadow/npm/arborist/index.mts'
import { SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES } from '../../shadow/npm/arborist/lib/arborist/index.mts'

import type { ActualTreeResult } from './agent-fix.mts'

export async function getActualTree(
  cwd = process.cwd(),
): Promise<ActualTreeResult> {
  try {
    // @npmcli/arborist DOES have partial support for pnpm structured node_modules
    // folders. However, support is iffy resulting in unhappy paths of errors and hangs.
    // So, to avoid unhappy paths, we restrict our usage to --dry-run loading of the
    // node_modules folder.
    const arb = new Arborist({
      path: cwd,
      ...SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
    })
    return { actualTree: await arb.loadActual() }
  } catch (e) {
    return { error: e }
  }
}
