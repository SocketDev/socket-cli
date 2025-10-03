/** @fileoverview Manifest setup business logic handler for Socket CLI. Orchestrates interactive configuration setup and delegates to output formatter with success/failure status. */

import { outputManifestSetup } from './output-manifest-setup.mts'
import { setupManifestConfig } from './setup-manifest-config.mts'

export async function handleManifestSetup(
  cwd: string,
  defaultOnReadError: boolean,
): Promise<void> {
  const result = await setupManifestConfig(cwd, defaultOnReadError)

  await outputManifestSetup(result)
}
