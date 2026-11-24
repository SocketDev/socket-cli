import { membershipOf } from './discover-manifest-roots.mts'
import { enumerateWorkspaces } from './enumerate-workspaces.mts'
import { pluralize } from '../../utils/words.mts'

import type { BuildRoot, Membership } from './discover-manifest-roots.mts'
import type { EcosystemBuildConfig } from './generate-recursive-manifests.mts'
import type { BuildTool } from './scripts/build-tool.mts'

export type LoadedBuild = {
  membership: Membership
  // The projects it loads besides its own.
  modules: number
}

// Lets the build tool load a build, resolving nothing, for what it includes.
export async function loadBuild({
  config,
  ecosystem,
  excludePaths,
  root,
  scanRoot,
  verbose,
}: {
  config: EcosystemBuildConfig
  ecosystem: BuildTool
  excludePaths: string[] | undefined
  root: BuildRoot
  scanRoot: string
  verbose: boolean
}): Promise<LoadedBuild | undefined> {
  const result = await enumerateWorkspaces({
    bin: config.bin,
    buildOpts: config.buildOpts,
    cwd: root.dir,
    ecosystem,
    entryFile: root.entryFile,
    excludeBase: scanRoot,
    excludePaths,
    javaHome: config.javaHome,
    verbose: verbose || config.verbose,
  })
  if (!result) {
    return undefined
  }
  return {
    membership: await membershipOf(result.buildRoot, result.projects, scanRoot),
    modules: Math.max(0, result.projects.length - 1),
  }
}

// `label`, followed by how many modules it has, when any.
export function withModules(label: string, modules: number): string {
  return modules
    ? `${label} and its ${modules} ${pluralize('module', modules)}`
    : label
}
