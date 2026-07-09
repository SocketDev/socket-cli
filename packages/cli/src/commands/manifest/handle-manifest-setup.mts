import { outputManifestSetup } from './output-manifest-setup.mts'
import { setupManifestConfig } from './setup-manifest-config.mts'

// socket-lint: allow boolean-trap -- collapsing into an options object would
// change call sites in test/unit/commands/manifest/handle-manifest-setup.test.mts,
// which is out of scope for this pass.
export async function handleManifestSetup(
  cwd: string,
  defaultOnReadError: boolean,
): Promise<void> {
  const result = await setupManifestConfig(cwd, defaultOnReadError)

  await outputManifestSetup(result)
}
