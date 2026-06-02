import { logger } from '@socketsecurity/registry/lib/logger'

import { spawnCoanaDlx } from '../../utils/dlx.mts'

// Delegates Socket facts generation for a JVM build tool to the Coana CLI's
// `manifest <ecosystem>` command. The build-tool resolution scripts (the Gradle
// init script and the sbt plugin) live in Coana now, so socket-cli no longer
// runs them itself; it only asks Coana for the uploadable `.socket.facts.json`.
//
// The resolved artifact-paths sidecar is intentionally NOT requested here: it
// only matters for reachability analysis, which is internal to Coana, so Coana
// emits it itself when it runs reachability. `socket manifest` only needs the
// facts file.
//
// `spawnCoanaDlx` resolves the Coana CLI via dlx (or a local build when
// `SOCKET_CLI_COANA_LOCAL_PATH` is set). `bin` (the gradle/sbt executable) is
// forwarded only when explicitly chosen; when empty, Coana applies the same
// default socket-cli used to (`./gradlew`, or `sbt` on PATH).
export async function runCoanaManifestFacts({
  bin,
  buildOpts,
  buildOptsFlag,
  configs,
  cwd,
  ecosystem,
  ignoreUnresolved,
  verbose,
}: {
  bin: string
  buildOpts: string[]
  buildOptsFlag: '--gradle-opts' | '--sbt-opts'
  configs: string
  cwd: string
  ecosystem: 'gradle' | 'sbt'
  ignoreUnresolved: boolean
  verbose: boolean
}): Promise<void> {
  // `coana manifest <ecosystem> <path>` emits `.socket.facts.json` by default;
  // there is no `--facts` flag (the artifact-paths sidecar is reachability-
  // internal and not requested here).
  const coanaArgs: string[] = ['manifest', ecosystem, cwd]
  if (bin) {
    coanaArgs.push('--bin', bin)
  }
  if (configs) {
    coanaArgs.push('--configs', configs)
  }
  if (ignoreUnresolved) {
    coanaArgs.push('--ignore-unresolved')
  }
  if (verbose) {
    coanaArgs.push('--debug')
  }
  // `--gradle-opts` / `--sbt-opts` are variadic on the Coana side; keep them
  // last so the pass-through values don't swallow any following flags.
  if (buildOpts.length) {
    coanaArgs.push(buildOptsFlag, ...buildOpts)
  }

  logger.log(
    `Generating Socket facts for the ${ecosystem} project at \`${cwd}\` ...`,
  )
  if (verbose) {
    logger.log('[VERBOSE] coana args:', coanaArgs)
  }

  // Stream Coana's output so the user sees build-tool progress and Coana's own
  // "Socket facts file written to: ..." line.
  const result = await spawnCoanaDlx(
    coanaArgs,
    undefined,
    { cwd },
    { stdio: 'inherit' },
  )
  if (!result.ok) {
    process.exitCode = 1
    logger.fail(result.message || 'Coana failed to generate Socket facts')
    return
  }
  logger.success('Generated Socket facts')
  logger.log('')
  logger.log(
    'Next step is to generate a Scan by running the `socket scan create` command on the same directory.',
  )
}
