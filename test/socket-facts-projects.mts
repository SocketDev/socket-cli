import path from 'node:path'

import type { SocketFactsProject } from '../src/commands/manifest/run-manifest-facts.mts'

// A project of the build at `buildRoot`, its build files relative to its own
// directory.
export function socketFactsProject(
  buildRoot: string,
  subprojectDir: string,
  buildFiles: readonly string[] = [],
): SocketFactsProject {
  const dir = path.resolve(buildRoot, subprojectDir)
  return { buildFiles: buildFiles.map(file => path.join(dir, file)), dir }
}

export function mavenProject(
  buildRoot: string,
  subprojectDir: string,
  pomFile = 'pom.xml',
): SocketFactsProject {
  return socketFactsProject(buildRoot, subprojectDir, [pomFile])
}
