import {
  existsSync,
  promises as fs,
  mkdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { resolveBazelBinary } from './bazel-bin-detect.mts'
import {
  parseBazelBuildOutput,
  parseUnsortedDepsJson,
} from './bazel-build-parser.mts'
import { ensureJavaOnPath } from './bazel-java-shim.mts'
import { validateOutputBase } from './bazel-output-base-check.mts'
import { provisionPythonShim } from './bazel-python-shim.mts'
import {
  buildProbeFor,
  runBazelModShowVisibleRepos,
} from './bazel-query-runner.mts'
import {
  discoverMavenRepos,
  parseVisibleRepoCandidates,
} from './bazel-repo-discovery.mts'
import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from './bazel-workspace-detect.mts'
import { getErrorCause } from '../../../utils/errors.mts'

import type { ExtractedArtifact } from './bazel-build-parser.mts'
import type { BazelQueryOptions } from './bazel-query-runner.mts'

export type ExtractBazelOptions = {
  bazelFlags: string | undefined
  bazelOutputBase: string | undefined
  bazelRc: string | undefined
  bin: string | undefined
  cwd: string
  // Optional env override used for python-shim PATH augmentation.
  env?: NodeJS.ProcessEnv
  out: string
  // Use the auto-manifest sibling directory instead of writing directly to `out`.
  outLayout?: 'flat'
  verbose: boolean
}

export type ExtractBazelResult = {
  artifactCount: number
  manifestPath?: string | undefined
  noEcosystemFound?: boolean | undefined
  ok: boolean
}

type CoordPair = { groupArtifact: string; version: string }

// Splits "g:a:v" -> { groupArtifact: "g:a", version: "v" }.
// Returns null on malformed input.
function splitCoord(c: string): CoordPair | null {
  const lastColon = c.lastIndexOf(':')
  if (lastColon < 1) {
    return null
  }
  return {
    groupArtifact: c.slice(0, lastColon),
    version: c.slice(lastColon + 1),
  }
}

type MavenInstallJsonCurrent = {
  artifacts: Record<string, { shasums: { jar?: string }; version: string }>
  dependencies: Record<string, string[]>
  repositories?: Record<string, string[]>
}

type LabelCoordIndex = {
  fullLabels: Map<string, string>
  suffixToCoords: Map<string, Set<string>>
}

// Builds a lookup from rule label suffix (e.g. ":com_google_guava_guava") to canonical coord.
function buildLabelToCoordMap(artifacts: ExtractedArtifact[]): LabelCoordIndex {
  const fullLabels = new Map<string, string>()
  const suffixToCoords = new Map<string, Set<string>>()
  for (const a of artifacts) {
    // The rule name (e.g. "com_google_guava_guava") becomes the path under @<repo>//:<name>.
    // We record by ":<name>" suffix so we can look up regardless of repo name.
    const suffix = `:${a.ruleName}`
    const coords = suffixToCoords.get(suffix) ?? new Set<string>()
    coords.add(a.mavenCoordinates)
    suffixToCoords.set(suffix, coords)
    if (a.sourceRepo) {
      fullLabels.set(`@${a.sourceRepo}//${suffix}`, a.mavenCoordinates)
    }
  }
  return { fullLabels, suffixToCoords }
}

// Converts a Bazel dep label to a Maven coordinate, using the label-to-coord map.
// Returns null when the label is not recognised.
function depLabelToCoord(
  label: string,
  labelToCoord: LabelCoordIndex,
): string | null {
  // label may be "@maven//:com_google_guava_failureaccess".
  const colon = label.lastIndexOf(':')
  if (colon < 0) {
    return null
  }
  const fullMatch = labelToCoord.fullLabels.get(label)
  if (fullMatch) {
    return fullMatch
  }
  const key = label.slice(colon)
  const suffixMatches = labelToCoord.suffixToCoords.get(key)
  if (!suffixMatches) {
    return null
  }
  if (suffixMatches.size > 1) {
    throw new Error(
      `Ambiguous Bazel dependency label ${label} maps rule suffix ${key} to multiple Maven coordinates: ${Array.from(
        suffixMatches,
      )
        .sort()
        .join(
          ', ',
        )}. The generated maven_install.json cannot resolve this dependency label losslessly.`,
    )
  }
  return Array.from(suffixMatches)[0] ?? null
}

export function normalizeToMavenInstallJson(
  artifacts: ExtractedArtifact[],
): MavenInstallJsonCurrent {
  const labelToCoord = buildLabelToCoordMap(artifacts)
  const out: MavenInstallJsonCurrent = {
    artifacts: {},
    dependencies: {},
  }
  const versionsByGroupArtifact = new Map<string, string>()
  const dependencySets = new Map<string, Set<string>>()
  for (const a of artifacts) {
    const split = splitCoord(a.mavenCoordinates)
    if (!split) {
      continue
    }
    const existingVersion = versionsByGroupArtifact.get(split.groupArtifact)
    if (existingVersion && existingVersion !== split.version) {
      throw new Error(
        `Conflicting versions for ${split.groupArtifact}: ${existingVersion}, ${split.version}. The generated maven_install.json cannot represent multiple versions for the same group:artifact losslessly.`,
      )
    }
    if (!existingVersion) {
      versionsByGroupArtifact.set(split.groupArtifact, split.version)
      out.artifacts[split.groupArtifact] = {
        shasums: a.mavenSha256 ? { jar: a.mavenSha256 } : {},
        version: split.version,
      }
    } else if (
      a.mavenSha256 &&
      !out.artifacts[split.groupArtifact]?.shasums.jar
    ) {
      out.artifacts[split.groupArtifact] = {
        shasums: { jar: a.mavenSha256 },
        version: split.version,
      }
    }
    // Dependency keys in maven_install.json use "g:a" (no version),
    // matching the canonical rules_jvm_external lockfile shape.
    // Only emit an entry when there are actual dependencies (lockfile omits
    // artifacts with an empty dep list).
    const depKey = split.groupArtifact
    const depCoords = dependencySets.get(depKey) ?? new Set<string>()
    for (const depLabel of a.deps) {
      // First try our rule-label lookup (the common case for --output=build text).
      const c = depLabelToCoord(depLabel, labelToCoord)
      if (c) {
        // c is "g:a:v"; strip the version to produce "g:a" per lockfile shape.
        const cs = splitCoord(c)
        depCoords.add(cs ? cs.groupArtifact : c)
      } else if (
        depLabel.includes(':') &&
        !depLabel.startsWith('@') &&
        !depLabel.startsWith(':')
      ) {
        // unsorted_deps.json deps may be "g:a:v" in older files or
        // "g:a" in v2 lock-file-shaped maps. Strip only when a version is
        // present.
        const parts = depLabel.split(':')
        depCoords.add(
          parts.length >= 3 ? parts.slice(0, -1).join(':') : depLabel,
        )
      }
    }
    if (depCoords.size) {
      dependencySets.set(depKey, depCoords)
    }
  }
  for (const [depKey, depCoords] of dependencySets) {
    out.dependencies[depKey] = Array.from(depCoords)
  }
  return out
}

// Resolves the bazel `external/` dir for the given workspace.
//
// Bazel's `bazel-out/` convenience symlink points at
// `<output_base>/execroot/<workspace>/bazel-out/`; the `external/` dir we
// want is at `<output_base>/external/`. `path.join` is purely lexical and
// would collapse `bazel-out/..` to the cwd itself, which is the wrong place
// Resolve the symlink at the filesystem level and walk up to
// `<output_base>` instead.
function bazelExternalDir(
  cwd: string,
  outputBase: string | undefined,
): string | null {
  if (outputBase) {
    return path.join(outputBase, 'external')
  }
  const bazelOutLink = path.join(cwd, 'bazel-out')
  if (!existsSync(bazelOutLink)) {
    return null
  }
  try {
    // realpath follows symlinks: .../<output_base>/execroot/<workspace>/bazel-out
    const real = realpathSync(bazelOutLink)
    // Walk up bazel-out -> <workspace> -> execroot -> <output_base>, then into external/.
    return path.join(real, '..', '..', '..', 'external')
  } catch {
    return null
  }
}

// Internal diagnostic: when truthy, skip the unsorted_deps.json fast path
// and force the bazel-query regex fallback. Used by bazel-bench to
// deterministically exercise parseBazelBuildOutput on every CI run. Truthy
// values are '1', 'true', 'yes' (case-insensitive); anything else (unset,
// '', '0', 'false') is treated as off. Not exposed as a user-facing CLI
// flag, so it is read here rather than added to constants.mts.
function isForceQueryFallbackEnabled(): boolean {
  const raw = process.env['SOCKET_BAZEL_FORCE_QUERY_FALLBACK']
  if (!raw) {
    return false
  }
  const normalized = raw.toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

// Tries `external/<repo>/unsorted_deps.json` first; falls back to parsing the
// probe stdout the caller already captured during discovery. Discovery runs
// the same `kind("jvm_import rule|aar_import rule", @<repo>//:*)` query that
// extraction needs, so reusing its stdout skips one bazel-query invocation
// per repo on the unpinned path (where unsorted_deps.json isn't on disk).
async function extractFromOneRepo(
  repoName: string,
  queryOpts: BazelQueryOptions,
  cachedProbeStdout: string,
): Promise<ExtractedArtifact[]> {
  const verbose = queryOpts.verbose
  // unsorted_deps.json lives under the bazel external dir.
  // When --output_base is set, it's under that; otherwise under the workspace's
  // bazel-out symlink (resolved via realpath, NOT lexical path.join — the
  // lexical form would collapse `bazel-out/..` to cwd and miss the file).
  const externalDir = bazelExternalDir(queryOpts.cwd, queryOpts.bazelOutputBase)
  if (verbose) {
    logger.log(
      `[VERBOSE] @${repoName}: external dir:`,
      externalDir ?? '(unresolved — bazel-out symlink absent)',
    )
  }
  const forceFallback = isForceQueryFallbackEnabled()
  if (forceFallback && verbose) {
    logger.log(
      `[VERBOSE] @${repoName}: SOCKET_BAZEL_FORCE_QUERY_FALLBACK set; skipping unsorted_deps.json fast path.`,
    )
  }
  const candidates = forceFallback
    ? []
    : externalDir
      ? [path.join(externalDir, repoName, 'unsorted_deps.json')]
      : []
  for (const c of candidates) {
    if (existsSync(c)) {
      // Bound the read to 1GB to prevent OOM on hostile content while allowing large real-world lockfiles.
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.stat(c)
      if (stat.size > 1024 * 1024 * 1024) {
        logger.warn(
          `Skipping oversized ${c} (${stat.size} bytes); falling back to cached probe stdout.`,
        )
        break
      }
      const json = readFileSync(c, 'utf8')
      const parsed = parseUnsortedDepsJson(json)
      if (parsed.length) {
        if (verbose) {
          logger.log(
            `[VERBOSE] @${repoName}: source=unsorted_deps.json (${c}, ${parsed.length} artifact(s))`,
          )
        }
        return parsed.map(a => ({ ...a, sourceRepo: repoName }))
      }
    } else if (verbose) {
      logger.log(`[VERBOSE] @${repoName}: unsorted_deps.json miss at`, c)
    }
  }
  // Reuse the probe stdout that discovery already captured for this repo.
  // The probe ran exactly this query during validation and only validated
  // repos with code === 0 make it into the cache, so retry is unnecessary
  // — if the probe was flaky, the repo wouldn't be in the map.
  if (!cachedProbeStdout) {
    logger.warn(
      `No cached probe stdout for @${repoName}; skipping. (This shouldn't happen — discovery should have populated it.)`,
    )
    return []
  }
  if (verbose) {
    logger.log(
      `[VERBOSE] @${repoName}: source=cached probe stdout (${cachedProbeStdout.length} bytes)`,
    )
  }
  return parseBazelBuildOutput(cachedProbeStdout).map(a => ({
    ...a,
    sourceRepo: repoName,
  }))
}

export async function extractBazelToMaven(
  opts: ExtractBazelOptions,
): Promise<ExtractBazelResult> {
  const { cwd, out, verbose } = opts
  logger.group('bazel2maven:')
  logger.info(`- src dir: \`${cwd}\``)
  logger.info(`- out dir: \`${out}\``)
  if (!existsSync(cwd)) {
    logger.warn(`Warning: cwd does not exist: ${cwd}`)
  }
  logger.groupEnd()

  try {
    // Validate caller-provided Bazel filesystem settings before invoking Bazel.
    if (opts.bazelOutputBase) {
      validateOutputBase(opts.bazelOutputBase, opts.cwd)
    }
    // Java must be available before rules_jvm_external/Coursier runs;
    // python shim follows so its augmented PATH inherits the JDK prefix.
    ensureJavaOnPath()
    const shim = await provisionPythonShim()
    const baseEnv = shim.augmentedEnv ?? opts.env

    // Step 1: workspace detection.
    const mode = detectWorkspaceMode(cwd)
    logger.info(
      `Workspace mode: bzlmod=${mode.bzlmod} workspace=${mode.workspace}`,
    )
    const invocationFlags = getBazelInvocationFlags(mode)

    // Step 2: bazel binary resolution.
    const bin = await resolveBazelBinary(opts.bin)
    logger.info(`Using bazel: ${bin}`)
    if (verbose) {
      logger.log('[VERBOSE] resolved options:', {
        bin,
        bazelRc: opts.bazelRc ?? '(unset)',
        bazelOutputBase: opts.bazelOutputBase ?? '(unset)',
        bazelFlags: opts.bazelFlags ?? '(unset)',
        invocationFlags,
      })
    }

    // Step 3: build the shared query options object.
    const queryOpts: BazelQueryOptions = {
      bin,
      cwd,
      invocationFlags,
      ...(opts.bazelRc ? { bazelRc: opts.bazelRc } : {}),
      ...(opts.bazelFlags ? { bazelFlags: opts.bazelFlags } : {}),
      ...(opts.bazelOutputBase
        ? { bazelOutputBase: opts.bazelOutputBase }
        : {}),
      ...(baseEnv ? { env: baseEnv } : {}),
      verbose,
    }

    // Step 4: discover validated Maven repos via the two-step recipe.
    // Bzlmod has a native visible-repository surface; prefer that over static
    // MODULE.bazel parsing and keep bounded parsing as the legacy/fallback path.
    let nativeCandidates: string[] | undefined
    if (mode.bzlmod) {
      const visibleRepos = await runBazelModShowVisibleRepos(queryOpts)
      if (visibleRepos.code === 0) {
        nativeCandidates = parseVisibleRepoCandidates(visibleRepos.stdout)
        if (verbose) {
          logger.log(
            '[VERBOSE] Bzlmod visible repo candidates:',
            nativeCandidates,
          )
        }
      } else if (verbose) {
        logger.log(
          '[VERBOSE] bazel mod show_repo failed; falling back to static candidate parsing:',
          visibleRepos.stderr,
        )
      }
    }
    // Returns Map<repoName, probeStdout> so extraction can reuse the probe
    // output and skip running an identical bazel-query a second time.
    const probe = buildProbeFor(queryOpts)
    const repos = await discoverMavenRepos(
      cwd,
      probe,
      nativeCandidates,
      verbose,
    )
    const repoNames = Array.from(repos.keys())
    logger.info(
      `Discovered ${repos.size} Maven repo(s): ${repoNames.join(', ') || '(none)'}`,
    )

    // Step 5: extract artifacts from each repo (preferring unsorted_deps.json).
    const allArtifacts: ExtractedArtifact[] = []
    for (const [repo, probeStdout] of repos) {
      // eslint-disable-next-line no-await-in-loop
      const artifacts = await extractFromOneRepo(repo, queryOpts, probeStdout)
      allArtifacts.push(...artifacts)
      logger.info(`@${repo}: ${artifacts.length} artifact(s)`)
    }

    // Step 6: normalize to maven_install.json shape.
    const normalized = normalizeToMavenInstallJson(allArtifacts)

    // Step 7: write outputs.
    // Standalone output writes directly to `out`; auto-manifest uses a sibling directory
    // to avoid colliding with a repo's checked-in rules_jvm_external lockfile and
    // to avoid repo-root gitignore patterns such as `/maven_install.json`.
    const layout = opts.outLayout ?? 'standalone'
    const manifestDir =
      layout === 'flat' ? path.join(out, '.socket-auto-manifest') : out
    mkdirSync(manifestDir, { recursive: true })
    const manifestPath = path.join(manifestDir, 'maven_install.json')
    await fs.writeFile(
      manifestPath,
      JSON.stringify(normalized, null, 2),
      'utf8',
    )

    if (verbose) {
      logger.log('[VERBOSE] outputs:', {
        artifactCount: allArtifacts.length,
        generatedManifest: path.relative(out, manifestPath),
        layout,
        manifest: manifestPath,
        mavenRepos: repoNames,
        tool: 'socket manifest bazel',
        workspace: { bzlmod: mode.bzlmod, legacyWorkspace: mode.workspace },
      })
    }

    if (!allArtifacts.length) {
      if (verbose) {
        logger.info('No Maven artifacts extracted.')
      }
      return {
        artifactCount: 0,
        manifestPath,
        noEcosystemFound: true,
        ok: false,
      }
    }
    logger.success(
      `Wrote ${allArtifacts.length} artifact(s) to ${path.relative(cwd, manifestPath)}.`,
    )
    return {
      artifactCount: allArtifacts.length,
      manifestPath,
      ok: true,
    }
  } catch (e) {
    // Always surface the error message; users should not have to
    // re-run a multi-minute bazel build with --verbose just to see whether
    // the failure was a missing dependency, permission error, or network blip.
    logger.fail(`Unexpected error in bazel2maven: ${getErrorCause(e)}`)
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    } else {
      logger.info('Re-run with --verbose for the full stack.')
    }
    return { artifactCount: 0, ok: false }
  }
}
