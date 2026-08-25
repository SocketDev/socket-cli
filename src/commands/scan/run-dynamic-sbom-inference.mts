import { InputError } from '../../utils/errors.mts'
import { generateRecursiveManifests } from '../manifest/generate-recursive-manifests.mts'
import {
  hasSidecarEntries,
  serializeSidecar,
} from '../manifest/scripts/sidecar.mts'

import type {
  ResolvedPathsSidecar,
  SidecarAccumulator,
} from '../manifest/scripts/sidecar.mts'

export type DynamicSbomInferenceResult = {
  factsPaths: string[]
  resolvedPathsSidecar: ResolvedPathsSidecar | undefined
}

// Recursively discovers and generates Socket facts for every independent
// gradle/sbt/maven build root under `cwd`, returning the generated facts
// paths plus the resolved-paths sidecar that reachability forwards to Coana.
export async function runDynamicSbomInference({
  cwd,
  excludePaths,
  sbtTmpDir,
  withFiles,
}: {
  cwd: string
  excludePaths: string[]
  // sbt provisions its Scala toolchain under this directory and withFiles'
  // artifactPaths point into it, so it must outlive whoever consumes them.
  // Only meaningful alongside `withFiles`.
  sbtTmpDir: string | undefined
  withFiles: boolean
}): Promise<DynamicSbomInferenceResult> {
  const sidecarAcc: SidecarAccumulator | undefined = withFiles
    ? new Map()
    : undefined
  const outcomes = await generateRecursiveManifests({
    cwd,
    excludePaths,
    sbtTmpDir: withFiles ? sbtTmpDir : undefined,
    sidecarAcc,
    verbose: false,
    withFiles,
  })
  // No candidates discovered at all (distinct from candidates that were found
  // but produced no generated facts - empty/skippedDisabled are already warned
  // about elsewhere and are not this kind of mistake).
  if (!outcomes.length) {
    throw new InputError(
      [
        'No Gradle, sbt, or Maven build root was found.',
        '',
        '- Remove --dynamic-sbom-inference; it only applies to these ecosystems.',
        '- Make sure to run it from the correct dir (use --cwd to target another dir).',
      ].join('\n'),
    )
  }
  // Fail loud rather than silently proceed with a partial multi-root result:
  // matches handleManifestDynamicSbomInference's own check.
  if (outcomes.some(o => o.status === 'failed')) {
    throw new InputError(
      'One or more independent build roots failed to generate Socket facts; aborting (see the errors above).',
    )
  }
  return {
    factsPaths: outcomes
      .filter(o => o.status === 'generated')
      .map(o => o.factsPath!),
    resolvedPathsSidecar:
      sidecarAcc && hasSidecarEntries(sidecarAcc)
        ? serializeSidecar(sidecarAcc)
        : undefined,
  }
}
