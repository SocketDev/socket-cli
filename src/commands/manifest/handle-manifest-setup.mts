import { outputManifestSetup } from './output-manifest-setup.mts'
import { setupManifestConfig } from './setup-manifest-config.mts'
import { setupRecursiveManifestConfig } from './setup-recursive-manifest-config.mts'

export async function handleManifestSetup(
  cwd: string,
  defaultOnReadError: boolean,
  dynamicSbomInference = false,
  excludePaths?: string[] | undefined,
): Promise<void> {
  const result = dynamicSbomInference
    ? await setupRecursiveManifestConfig(cwd, defaultOnReadError, excludePaths)
    : await setupManifestConfig(cwd, defaultOnReadError)

  await outputManifestSetup(result)
}
