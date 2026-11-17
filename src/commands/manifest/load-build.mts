import { pluralize } from '@socketsecurity/registry/lib/words'

import { membershipOf } from './discover-manifest-roots.mts'
import { listBuildProjects } from './run-manifest-facts.mts'

import type { Membership } from './discover-manifest-roots.mts'
import type { SocketFactsRunOptions } from './run-manifest-facts.mts'

export type LoadedBuild = {
  membership: Membership
  // The projects it loads besides its own.
  modules: number
}

// Lets the build tool load a build, resolving nothing, for what it includes.
export async function loadBuild({
  scanRoot,
  ...options
}: SocketFactsRunOptions & { scanRoot: string }): Promise<
  LoadedBuild | undefined
> {
  const projects = await listBuildProjects(options)
  if (!projects) {
    return undefined
  }
  return {
    membership: await membershipOf(projects, scanRoot),
    modules: Math.max(0, projects.length - 1),
  }
}

// `label`, followed by how many modules it has, when any.
export function withModules(label: string, modules: number): string {
  return modules
    ? `${label} and its ${modules} ${pluralize('module', modules)}`
    : label
}
