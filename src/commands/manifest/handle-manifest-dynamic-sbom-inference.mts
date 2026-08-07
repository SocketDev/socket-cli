import { generateRecursiveManifests } from './generate-recursive-manifests.mts'
import { outputManifestDynamicSbomInference } from './output-manifest-dynamic-sbom-inference.mts'

import type { RecursiveManifestOutcome } from './generate-recursive-manifests.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function handleManifestDynamicSbomInference({
  cwd,
  excludePaths,
  outputKind,
  verbose,
}: {
  cwd: string
  excludePaths: string[]
  outputKind: OutputKind
  verbose: boolean
}): Promise<void> {
  const outcomes = await generateRecursiveManifests({
    cwd,
    excludePaths,
    verbose,
  })

  const result: CResult<RecursiveManifestOutcome[]> = !outcomes.length
    ? {
        ok: false,
        code: 1,
        message:
          'No Gradle, sbt, or Maven build root was found beneath the given directory.',
        data: outcomes,
      }
    : outcomes.some(o => o.status === 'failed')
      ? {
          ok: false,
          code: 1,
          message: 'One or more build roots failed to generate Socket facts.',
          data: outcomes,
        }
      : { ok: true, data: outcomes }

  await outputManifestDynamicSbomInference(result, outputKind)
}
