import path from 'node:path'

import { joinOr } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'

import { isFactsOnlyTypes } from '../../utils/coana.mts'
import { InputError } from '../../utils/errors.mts'
import { realpathOrResolved } from '../../utils/fs.mts'
import { generateRecursiveManifests } from '../manifest/generate-recursive-manifests.mts'
import { DSI_SETUP_COMMAND } from '../manifest/run-manifest-facts.mts'
import {
  PURL_TYPE_BY_TOOL,
  buildToolLabelsFor,
} from '../manifest/scripts/build-tool.mts'

import type { FactsOnlyTypes } from '../../utils/coana.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { RecursiveManifestOutcome } from '../manifest/generate-recursive-manifests.mts'
import type {
  SocketFactsContext,
  SocketFactsWorkDir,
} from '../manifest/run-manifest-facts.mts'

const DSI_SETTINGS_DOCS_URL =
  'https://github.com/SocketDev/socket-cli/blob/v1.x/docs/dynamic-sbom-inference-settings.md'

// Who consumes the facts: Coana for `fix` and `reach`, with the work dir that
// collects what its run reads, or only the scan upload.
export type FactsTarget =
  | { consumer: 'upload'; workDir?: undefined }
  | { consumer: 'fix' | 'reach'; workDir: KeptRootsDir }

export type FactsConsumer = FactsTarget['consumer']

// Only reachability installs the dependencies its analysis reads.
export type KeptRootsDir = Omit<SocketFactsWorkDir, 'withFiles'>

export type DynamicSbomInferenceResult = {
  // Facts files of dropped runs, which the scan must not collect.
  discardedFactsPaths: string[]
  // Each discovered build root's purl type, generated or not: Coana takes
  // these types' artifacts only from facts files.
  factsOnlyTypes: FactsOnlyTypes
  factsPaths: string[]
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
// build root of the selected ecosystems under `cwd`.
export async function runDynamicSbomInference({
  consumer,
  context,
  cwd,
  excludePaths,
  purlTypes,
  workDir,
}: FactsTarget & {
  context: Omit<SocketFactsContext, 'workDir'>
  cwd: string
  excludePaths: string[]
  purlTypes: readonly PURL_Type[]
}): Promise<DynamicSbomInferenceResult> {
  const coanaReadsFacts = consumer !== 'upload'
  const outcomes = await generateRecursiveManifests({
    context: {
      ...context,
      workDir: workDir && { ...workDir, withFiles: consumer === 'reach' },
    },
    cwd,
    excludePaths,
    purlTypes,
    verbose: false,
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
      [
        'One or more independent build roots failed to generate Socket facts; aborting (see the errors above).',
        '',
        `- To fix a build's settings or skip it, run \`${DSI_SETUP_COMMAND}\`.`,
        `- The settings are documented at ${DSI_SETTINGS_DOCS_URL}.`,
      ].join('\n'),
    )
  }
  const factsPaths = outcomes
    .filter(o => o.status === 'generated')
    .map(o => o.factsPath!)
  if (coanaReadsFacts) {
    checkFactsForCoana(outcomes, consumer, !!factsPaths.length)
  }
  return {
    discardedFactsPaths: outcomes.flatMap(o =>
      o.discardedFactsPath ? [o.discardedFactsPath] : [],
    ),
    factsOnlyTypes,
    factsPaths,
  }
}

// `paths` without the facts files discovery discarded: each holds what was
// there before the scan, not a kept build's.
export async function withoutDiscardedFacts(
  paths: string[],
  discarded: readonly string[] | undefined,
): Promise<string[]> {
  if (!discarded?.length) {
    return paths
  }
  const names = new Set(discarded.map(p => path.basename(p)))
  const keys = new Set(discarded)
  const isDiscarded = await Promise.all(
    paths.map(
      async p =>
        names.has(path.basename(p)) && keys.has(await realpathOrResolved(p)),
    ),
  )
  return paths.filter((_, index) => !isDiscarded[index])
}
