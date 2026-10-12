import { outputInstallCompletion } from './output-install-completion.mts'
import { setupTabCompletion } from './setup-tab-completion.mts'

export async function handleInstallCompletion(targetName: string) {
  const result = await setupTabCompletion(targetName)
  await outputInstallCompletion(result)
}
