import { outputManifestSetup } from './output-manifest-setup.mts'
import { setupManifestConfig } from './setup-manifest-config.mts'

// Collapsing into an options object would change call sites in
// test/unit/commands/manifest/handle-manifest-setup.test.mts, which is out of
// scope for this pass.
export async function handleManifestSetup(
  cwd: string,
  // oxlint-disable-next-line socket/no-boolean-trap-param -- out of scope
  defaultOnReadError: boolean,
): Promise<void> {
  const result = await setupManifestConfig(cwd, defaultOnReadError)

  await outputManifestSetup(result)
}
