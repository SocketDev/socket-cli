import { existsSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
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
// `SOCKET_CLI_COANA_LOCAL_PATH` is set). `bin` (the gradle/maven/sbt executable)
// is always resolved by the caller to a concrete default (`<cwd>/gradlew`, or
// `mvn`/`sbt` on PATH) before we get here, so it is forwarded verbatim; the
// empty guard below is just a cheap safeguard against passing `--bin ''`.
export async function runCoanaManifestFacts({
  bin,
  buildOpts,
  buildOptsFlag,
  cwd,
  ecosystem,
  excludeConfigs,
  ignoreUnresolved,
  includeConfigs,
  verbose,
}: {
  bin: string
  buildOpts: string[]
  buildOptsFlag: '--gradle-opts' | '--maven-opts' | '--sbt-opts'
  cwd: string
  ecosystem: 'gradle' | 'maven' | 'sbt'
  excludeConfigs: string
  ignoreUnresolved: boolean
  includeConfigs: string
  verbose: boolean
}): Promise<void> {
  // Pin the facts output location explicitly rather than relying on Coana's
  // "project root" default. `factsPath` is then the single source of truth for
  // both what we tell Coana to write and what we verify exists below, so the
  // two can't drift apart if Coana's default ever changes. This is deliberately
  // NOT user-configurable: Socket facts always land in the project root so that
  // `socket scan create <project>` finds them (see cmd-manifest-scala.mts, which
  // rejects --out/--stdout in facts mode).
  const factsDir = cwd
  const factsFile = constants.DOT_SOCKET_DOT_FACTS_JSON
  const factsPath = path.join(factsDir, factsFile)
  // `coana manifest <ecosystem> <path>` emits `.socket.facts.json` by default;
  // there is no `--facts` flag (the artifact-paths sidecar is reachability-
  // internal and not requested here).
  const coanaArgs: string[] = [
    'manifest',
    ecosystem,
    cwd,
    '--output-dir',
    factsDir,
    '--output-file',
    factsFile,
  ]
  if (bin) {
    coanaArgs.push('--bin', bin)
  }
  if (includeConfigs) {
    coanaArgs.push('--include-configs', includeConfigs)
  }
  if (excludeConfigs) {
    coanaArgs.push('--exclude-configs', excludeConfigs)
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
  // A zero exit code doesn't guarantee a facts file was written: Coana skips
  // emitting it when there are no resolvable dependencies (e.g. with
  // --ignore-unresolved). We pinned the output to `factsPath` above, so confirm
  // it exists before claiming success; otherwise the "next step: socket scan
  // create" line would mislead.
  if (!existsSync(factsPath)) {
    logger.warn(
      `Coana completed but wrote no ${factsFile} (no resolvable dependencies?); nothing to upload.`,
    )
    return
  }
  logger.success('Generated Socket facts')
  logger.log('')
  logger.log(
    'Next step is to generate a Scan by running the `socket scan create` command on the same directory.',
  )
}
