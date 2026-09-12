import { outputUninstallCompletion } from './output-uninstall-completion.mts'
import { teardownTabCompletion } from './teardown-tab-completion.mts'

export async function handleUninstallCompletion(targetName: string) {
  const result = await teardownTabCompletion(targetName)
  await outputUninstallCompletion(result, targetName)
}
