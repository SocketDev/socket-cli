import {
  matchingPatchEntries,
  readPatchManifest,
  writePatchManifest,
} from './manifest.mts'
import type { PatchManifest } from './manifest.mts'

export interface PatchRemoveResult {
  removed: string[]
  manifestFound: boolean
}

export interface PatchRemovePlan extends PatchRemoveResult {
  manifest?: PatchManifest | undefined
}

export async function planPatchRemoval(
  projectRoot: string,
  identifier: string,
): Promise<PatchRemovePlan> {
  const manifest = await readPatchManifest(projectRoot)
  if (!manifest) {
    return { removed: [], manifestFound: false }
  }

  return {
    removed: matchingPatchEntries(manifest, identifier).map(([purl]) => purl),
    manifestFound: true,
    manifest,
  }
}

export async function removePatchRecords(
  projectRoot: string,
  identifier: string,
): Promise<PatchRemoveResult> {
  const plan = await planPatchRemoval(projectRoot, identifier)
  if (!plan.manifest || plan.removed.length === 0) {
    return { removed: plan.removed, manifestFound: plan.manifestFound }
  }

  const patches = { ...plan.manifest.patches }
  for (const purl of plan.removed) {
    delete patches[purl]
  }

  await writePatchManifest(projectRoot, { ...plan.manifest, patches })
  return {
    removed: plan.removed,
    manifestFound: true,
  }
}
