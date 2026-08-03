import { logger } from '@socketsecurity/registry/lib/logger'

import { expandEnvVarRefs } from './expand-env-var-refs.mts'
import { enumerateWorkspaces as enumerateWorkspacesScript } from './scripts/run.mts'
import { getErrorMessageOr } from '../../utils/errors.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { SocketFactsSbomProject } from './scripts/facts.mts'

export type EnumerateWorkspacesResult = {
  projects: SocketFactsSbomProject[]
}

// Cheap subproject discovery (no dependency resolution) for
// `socket manifest setup --recursive`; dynamic-sbom-inference instead gets
// this list for free as a side effect of its own full facts run.
export async function enumerateWorkspaces({
  bin,
  buildOpts,
  cwd,
  ecosystem,
  excludePaths,
  javaHome,
  verbose,
}: {
  bin: string
  buildOpts: string[]
  cwd: string
  ecosystem: BuildTool
  excludePaths?: string[] | undefined
  javaHome?: string | undefined
  verbose: boolean
}): Promise<EnumerateWorkspacesResult | undefined> {
  let resolvedJavaHome: string | undefined
  if (javaHome) {
    const expanded = expandEnvVarRefs(javaHome)
    if (expanded.missing) {
      process.exitCode = 1
      logger.fail(
        `javaHome (\`${javaHome}\`) references \`${expanded.missing}\`, which is not set in this environment.`,
      )
      return
    }
    resolvedJavaHome = expanded.value
  }

  const scriptOpts = {
    bin: bin || undefined,
    excludePaths: excludePaths?.length ? excludePaths : undefined,
    // `env` replaces the spawned process's whole environment, not just JAVA_HOME.
    env: resolvedJavaHome
      ? { ...process.env, JAVA_HOME: resolvedJavaHome }
      : undefined,
    projectDir: cwd,
    stdio: verbose ? ('inherit' as const) : ('pipe' as const),
    toolOpts: buildOpts,
  }

  let result
  try {
    result = await enumerateWorkspacesScript(ecosystem, scriptOpts)
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      `Could not run the ${ecosystem} build tool` +
        (verbose
          ? `: ${getErrorMessageOr(e, String(e))}`
          : ' (run with --verbose for details).'),
    )
    return
  }

  if (result.code !== 0 && !result.projects.length) {
    process.exitCode = 1
    logger.fail(
      `The ${ecosystem} build failed (exit code ${result.code}) before producing any workspace records.`,
    )
    return
  }

  return { projects: result.projects }
}
