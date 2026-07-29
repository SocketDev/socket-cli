/**
 * Bazel leg of `--auto-manifest`: extract Maven (and opt-in PyPI) manifests
 * from a detected Bazel workspace so the wider scan can upload them.
 *
 * Trust boundary: socket.json's `defaults.manifest.bazel` executing settings
 * (`bazel`/`bin`, `bazelFlags`, `bazelRc`, `bazelOutputBase`) choose what gets
 * executed, so they are refused without `--trust-socket-json`. Non-executing
 * defaults (`ecosystems`, `verbose`) are honored untrusted.
 */
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  evaluateEcosystemOutcomes,
  pypiOutcome,
} from './bazel/cmd-manifest-bazel.mts'
import { extractBazelToMaven } from './bazel/extract_bazel_to_maven.mts'
import { extractBazelToPypi } from './bazel/extract_bazel_to_pypi.mts'
import { outputManifest } from './output-manifest.mts'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { InputError } from '../../util/error/errors-types.mts'

import type { EcosystemOutcome } from './bazel/cmd-manifest-bazel.mts'
import type { CResult, OutputKind } from '../../types.mts'
import type { SocketJson } from '../../util/socket/json.mts'

const logger = getDefaultLogger()

const SUPPORTED_AUTO_ECOSYSTEMS = new Set(['maven', 'pypi'])

export type BazelAutoSettings = {
  bazelFlags: string | undefined
  bazelOutputBase: string | undefined
  bazelRc: string | undefined
  bin: string | undefined
}

/**
 * Pick which Bazel ecosystems the auto run extracts. Maven is the default;
 * PyPI is opt-in via socket.json `defaults.manifest.bazel.ecosystems`. The
 * list is non-executing, so it is honored untrusted — but an unknown value is
 * refused loudly rather than silently skipped.
 */
export function resolveBazelAutoEcosystems(
  socketJson: SocketJson | undefined,
): string[] {
  const requested = socketJson?.defaults?.manifest?.bazel?.ecosystems
  if (!Array.isArray(requested) || !requested.length) {
    return ['maven']
  }
  for (let i = 0, { length } = requested; i < length; i += 1) {
    const eco = requested[i]!
    if (!SUPPORTED_AUTO_ECOSYSTEMS.has(eco)) {
      throw new InputError(
        `Unsupported Bazel ecosystem in ${SOCKET_JSON}. defaults.manifest.bazel.ecosystems contains \`${eco}\`, wanted maven or pypi. Fix: remove it or replace it with a supported value.`,
      )
    }
  }
  return requested
}

/**
 * Decide which bazel binary and options an auto-manifest run may use. Unlike
 * gradle/sbt there is no conventional wrapper the CLI can pre-approve, so ANY
 * executing setting from socket.json requires the trust flag.
 */
export function resolveBazelAutoSettings({
  cwd,
  socketJson,
  trustSocketJson,
}: {
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<BazelAutoSettings> {
  const bazelConfig = socketJson?.defaults?.manifest?.bazel
  const executingFields: string[] = []
  if (bazelConfig?.bazel || bazelConfig?.bin) {
    executingFields.push(
      bazelConfig.bazel
        ? 'defaults.manifest.bazel.bazel'
        : 'defaults.manifest.bazel.bin',
    )
  }
  if (bazelConfig?.bazelFlags) {
    executingFields.push('defaults.manifest.bazel.bazelFlags')
  }
  if (bazelConfig?.bazelRc) {
    executingFields.push('defaults.manifest.bazel.bazelRc')
  }
  if (bazelConfig?.bazelOutputBase) {
    executingFields.push('defaults.manifest.bazel.bazelOutputBase')
  }
  if (executingFields.length && !trustSocketJson) {
    return {
      ok: false,
      message: `Refused bazel settings chosen by ${SOCKET_JSON}`,
      cause: [
        `${SOCKET_JSON} in ${cwd} sets ${executingFields.join(', ')}.`,
        'Saw repository-supplied bazel execution settings, wanted none.',
        'These values pick the bazel binary and the options it runs with, and a scanned repository controls its own socket.json.',
        `Fix: re-run with --trust-socket-json to honor ${SOCKET_JSON} in this checkout, or run \`socket manifest bazel\` with explicit flags.`,
      ].join('\n'),
    }
  }
  return {
    ok: true,
    data: {
      bazelFlags: bazelConfig?.bazelFlags,
      bazelOutputBase: bazelConfig?.bazelOutputBase,
      bazelRc: bazelConfig?.bazelRc,
      bin: bazelConfig?.bazel ?? bazelConfig?.bin,
    },
  }
}

/**
 * Run the Bazel extraction for `--auto-manifest` and return the manifest
 * paths it wrote. Outcomes route through the shared success gate: a
 * `hardFailure` throws so the wider scan aborts, a `partial` warns loud but
 * still uploads, and an all-`noEcosystem` result is tolerated here — a Bazel
 * workspace with no Maven/PyPI rules is a normal repo, not an error. A
 * committed-lockfile-covered repo reports `complete` with zero synthetic
 * files, which is a correct no-op.
 */
export async function runBazelAutoManifest({
  cwd,
  outputKind,
  socketJson,
  trustSocketJson,
  verbose,
}: {
  cwd: string
  outputKind: OutputKind
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
  verbose: boolean
}): Promise<string[]> {
  const settings = resolveBazelAutoSettings({
    cwd,
    socketJson,
    trustSocketJson,
  })
  if (!settings.ok) {
    // Sets a non-zero exit code, which the fan-out's abort check turns into
    // an aborted run — a silently skipped ecosystem would under-report.
    await outputManifest(settings, outputKind, '-')
    return []
  }

  const ecosystems = resolveBazelAutoEcosystems(socketJson)
  const bazelVerbose =
    Boolean(socketJson?.defaults?.manifest?.bazel?.verbose) || verbose

  const outcomes: EcosystemOutcome[] = []
  for (let i = 0, { length } = ecosystems; i < length; i += 1) {
    const eco = ecosystems[i]!
    if (eco === 'maven') {
      logger.info(
        'Detected a Bazel workspace, extracting Maven dependencies via bazel query…',
      )
      const mavenResult = await extractBazelToMaven({
        bazelFlags: settings.data.bazelFlags,
        bazelOutputBase: settings.data.bazelOutputBase,
        bazelRc: settings.data.bazelRc,
        bin: settings.data.bin,
        cwd,
        out: cwd,
        outLayout: 'flat',
        // Unset selects the extractor's short auto-manifest default so the
        // wider scan is not stalled; the explicit command's longer default
        // lives in cmd-manifest-bazel.mts.
        perRepoTimeoutMs: undefined,
        verbose: bazelVerbose,
      })
      outcomes.push({
        complete: mavenResult.complete,
        ecosystem: 'maven',
        manifestPaths: mavenResult.manifestPaths,
        status: mavenResult.status,
      })
    } else if (eco === 'pypi') {
      logger.info(
        'Detected a Bazel workspace, extracting PyPI dependencies via bazel query…',
      )
      const pypiResult = await extractBazelToPypi({
        bazelFlags: settings.data.bazelFlags,
        bazelOutputBase: settings.data.bazelOutputBase,
        bazelRc: settings.data.bazelRc,
        bin: settings.data.bin,
        cwd,
        out: cwd,
        outLayout: 'flat',
        verbose: bazelVerbose,
      })
      outcomes.push({
        ecosystem: 'pypi',
        ...pypiOutcome(pypiResult),
      })
    }
  }

  if (outcomes.every(o => o.status === 'noEcosystem')) {
    logger.info(
      'No supported Bazel ecosystems detected (maven, pypi); skipping Bazel manifest generation.',
    )
    return []
  }
  evaluateEcosystemOutcomes(outcomes, { isExplicit: false })

  const generated: string[] = []
  for (let i = 0, { length } = outcomes; i < length; i += 1) {
    generated.push(...outcomes[i]!.manifestPaths)
  }
  return generated
}
