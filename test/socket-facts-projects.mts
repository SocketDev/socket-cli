import path from 'node:path'

import type {
  SocketFactsProject,
  SocketFactsRunOptions,
} from '../src/commands/manifest/run-manifest-facts.mts'
import type { ReachabilitySettings } from '../src/utils/socket-json.mts'

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

// The reachability settings each tool's runs were sent, from the calls of a
// mocked `runManifestFacts`.
export function reachabilityByTool(
  calls: ReadonlyArray<readonly [SocketFactsRunOptions]>,
): Record<string, ReachabilitySettings | undefined> {
  return Object.fromEntries(
    calls.map(({ 0: opts }) => [opts.ecosystem, opts.reachability]),
  )
}
