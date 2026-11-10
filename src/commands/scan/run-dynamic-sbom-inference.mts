import { joinOr } from '../../utils/arrays.mts'
import { isFactsOnlyTypes } from '../../utils/coana.mts'
import { InputError } from '../../utils/errors.mts'
import { logger } from '../../utils/logger.mts'
import { generateRecursiveManifests } from '../manifest/generate-recursive-manifests.mts'
import {
  PURL_TYPE_BY_TOOL,
  buildToolLabelsFor,
} from '../manifest/scripts/build-tool.mts'
import { DSI_SETUP_COMMAND } from '../manifest/scripts/resolution-report-render.mts'
import {
  hasSidecarEntries,
  serializeSidecar,
} from '../manifest/scripts/sidecar.mts'

import type { FactsOnlyTypes } from '../../utils/coana.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { RecursiveManifestOutcome } from '../manifest/generate-recursive-manifests.mts'
import type {
  ResolvedPathsSidecar,
  SidecarAccumulator,
} from '../manifest/scripts/sidecar.mts'

// Who consumes the facts: Coana for `fix` and `reach` (which also resolves
// artifact paths), or only the scan upload.
export type FactsConsumer = 'fix' | 'reach' | 'upload'

export type DynamicSbomInferenceResult = {
  // Each discovered build root's purl type, generated or not: Coana takes
  // these types' artifacts only from facts files.
  factsOnlyTypes: FactsOnlyTypes
  factsPaths: string[]
  resolvedPathsSidecar: ResolvedPathsSidecar | undefined
}

// Coana takes the discovered ecosystems' artifacts only from facts files, so a
// build root without them is one it leaves out.
function checkFactsForCoana(
  outcomes: RecursiveManifestOutcome[],
  consumer: Exclude<FactsConsumer, 'upload'>,
  hasFacts: boolean,
): void {
  const hasDisabled = outcomes.some(o => o.status === 'skippedDisabled')
  // Coana (15.14.1) refuses a facts-only reachability run without any facts.
  if (consumer === 'reach' && !hasFacts) {
    throw new InputError(
      [
        'No build root produced Socket facts, which reachability analysis with --dynamic-sbom-inference needs.',
        '',
        ...(hasDisabled
          ? [
              `- Re-enable the builds that socket.json skips (\`${DSI_SETUP_COMMAND}\` walks you through it).`,
            ]
          : []),
        '- Or select other ecosystems with --dynamic-sbom-inference-ecosystems.',
        '- Or remove --dynamic-sbom-inference to analyze the manifest files as they are.',
      ].join('\n'),
    )
  }
  if (hasDisabled) {
    logger.warn(
      'The analysis leaves out the build roots socket.json skips: with --dynamic-sbom-inference, it takes their dependencies only from Socket facts.',
    )
  }
}

// Recursively discovers and generates Socket facts for every independent
// build root of the selected ecosystems under `cwd`, returning the generated
// facts paths plus the resolved-paths sidecar that reachability forwards to
// Coana.
export async function runDynamicSbomInference({
  consumer,
  cwd,
  excludePaths,
  purlTypes,
  sbtTmpDir,
}: {
  consumer: FactsConsumer
  cwd: string
  excludePaths: string[]
  purlTypes: readonly PURL_Type[]
  // sbt provisions its Scala toolchain under this directory and reach's
  // artifactPaths point into it, so it must outlive whoever consumes them.
  // Only meaningful for `reach`.
  sbtTmpDir: string | undefined
}): Promise<DynamicSbomInferenceResult> {
  const withFiles = consumer === 'reach'
  const coanaReadsFacts = consumer === 'fix' || consumer === 'reach'
  const sidecarAcc: SidecarAccumulator | undefined = coanaReadsFacts
    ? new Map()
    : undefined
  const outcomes = await generateRecursiveManifests({
    cwd,
    excludePaths,
    purlTypes,
    sbtTmpDir: withFiles ? sbtTmpDir : undefined,
    sidecarAcc,
    verbose: false,
    withFiles,
  })
  const factsOnlyTypes = [
    ...new Set(outcomes.map(o => PURL_TYPE_BY_TOOL[o.ecosystem])),
  ]
  // No candidates discovered at all (distinct from candidates that were found
  // but produced no generated facts - empty/skippedDisabled are already warned
  // about elsewhere and are not this kind of mistake).
  if (!isFactsOnlyTypes(factsOnlyTypes)) {
    throw new InputError(
      [
        `No ${joinOr(buildToolLabelsFor(purlTypes))} build root was found.`,
        '',
        '- Select other ecosystems with --dynamic-sbom-inference-ecosystems, or remove --dynamic-sbom-inference.',
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
  const factsPaths = outcomes
    .filter(o => o.status === 'generated')
    .map(o => o.factsPath!)
  if (coanaReadsFacts) {
    checkFactsForCoana(outcomes, consumer, !!factsPaths.length)
  }
  return {
    factsOnlyTypes,
    factsPaths,
    resolvedPathsSidecar:
      sidecarAcc && hasSidecarEntries(sidecarAcc)
        ? serializeSidecar(sidecarAcc)
        : undefined,
  }
}
