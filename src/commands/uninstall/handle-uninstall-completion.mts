/** @fileoverview Tab completion uninstall handler for Socket CLI. Orchestrates tab completion removal and delegates to output formatter with results. */

import { outputUninstallCompletion } from './output-uninstall-completion.mts'
import { teardownTabCompletion } from './teardown-tab-completion.mts'

export async function handleUninstallCompletion(targetName: string) {
  const result = await teardownTabCompletion(targetName)
  await outputUninstallCompletion(result, targetName)
}
