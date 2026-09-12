/**
 * PyPI extraction for `socket manifest bazel --ecosystem pypi`: discovers
 * validated pip hubs, resolves versions from the requirements lockfile fast
 * path or spoke-tag fallback, and writes a pinned `requirements.txt`.
 */
import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { resolveBazelBinary } from './bazel-bin-detect.mts'
import { validateOutputBase } from './bazel-output-base-check.mts'
import {
  parseBazelModPipExtensionCandidates,
  parseVisibleRepoCandidates,
} from './bazel-pypi-candidates.mts'
import { discoverPypiHubs } from './bazel-pypi-discovery.mts'
import {
  collectPypiPackages,
  filterReachedPypiPackages,
  normalizePypiName,
  parseAliasActualFromBuildOutput,
  parsePypiTagsFromBuildOutput,
  readRequirementsLockFile,
  resolveRequirementsLockPath,
} from './bazel-pypi-parser.mts'
import { provisionPythonShim } from './bazel-python-shim.mts'
import {
  buildPypiProbeFor,
  runBazelModShowPipExtension,
  runBazelModShowVisibleRepos,
  runBazelQuery,
} from './bazel-query-runner.mts'
import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from './bazel-workspace-detect.mts'

import type { PypiHubCandidate } from './bazel-pypi-candidates.mts'
import type {
  ExtractedPypiPackage,
  ReachedPypiLabel,
} from './bazel-pypi-parser.mts'
import type { BazelQueryOptions } from './bazel-query-runner.mts'

const logger = getDefaultLogger()

// Build a spoke-tag lookup map for reached labels that don't have lockfile
// entries. For each reached label, if the lockfile missed it, resolve the
// actual target via `--output=build` and extract pypi_name/pypi_version.
export async function buildSpokeTagLookup(
  reached: ReachedPypiLabel[],
  queryOpts: BazelQueryOptions,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<Map<string, ExtractedPypiPackage>> {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  const lookup = new Map<string, ExtractedPypiPackage>()
  for (let i = 0, { length } = reached; i < length; i += 1) {
    const label = reached[i]!
    // Only query the spoke if we haven't already resolved it.
    if (lookup.has(label.normalizedName)) {
      continue
    }
    const buildResult = await runBazelQuery(label.apparentLabel, {
      ...queryOpts,
      verbose: false,
    })
    if (buildResult.code !== 0) {
      if (verbose) {
        logger.log(
          `[VERBOSE] spoke build query failed for ${label.apparentLabel}:`,
          buildResult.stderr,
        )
      }
      continue
    }
    let parsed = parsePypiTagsFromBuildOutput(buildResult.stdout)
    if (!parsed) {
      const actualLabel = parseAliasActualFromBuildOutput(buildResult.stdout)
      if (actualLabel && actualLabel !== label.apparentLabel) {
        const actualResult = await runBazelQuery(actualLabel, {
          ...queryOpts,
          verbose: false,
        })
        if (actualResult.code === 0) {
          parsed = parsePypiTagsFromBuildOutput(actualResult.stdout)
        } else if (verbose) {
          logger.log(
            `[VERBOSE] spoke actual query failed for ${actualLabel}:`,
            actualResult.stderr,
          )
        }
      }
    }
    if (parsed) {
      lookup.set(normalizePypiName(parsed.name), parsed)
    }
  }
  return lookup
}

export function collectDivergenceWarnings(
  reached: ReachedPypiLabel[],
  lockfileMap: Map<string, ExtractedPypiPackage>,
  spokeTagLookup: Map<string, ExtractedPypiPackage>,
  warnings: string[],
): void {
  for (let i = 0, { length } = reached; i < length; i += 1) {
    const label = reached[i]!
    const lockEntry = lockfileMap.get(label.normalizedName)
    const spokeEntry = spokeTagLookup.get(label.normalizedName)
    if (lockEntry && spokeEntry && lockEntry.version !== spokeEntry.version) {
      warnings.push(
        `Version divergence for ${label.originalLabel}: lockfile says ${lockEntry.version}, spoke tag says ${spokeEntry.version}. Using lockfile.`,
      )
    }
  }
}

export async function collectHubPackages(
  hubs: Awaited<ReturnType<typeof discoverPypiHubs>>,
  cwd: string,
  queryOpts: BazelQueryOptions,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<{ lines: PypiPackageLine[]; warnings: string[] }> {
  const { verbose = false } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  const allLines: PypiPackageLine[] = []
  const warnings: string[] = []
  for (const { 0: hubName, 1: hubInfo } of hubs) {
    const lockfileMap = await resolveHubLockfile(hubInfo, cwd, { verbose })
    const reached = await queryReachedPypiLabels(hubName, queryOpts, {
      verbose,
    })
    const labelsToQuery = lockfileMap
      ? reached.filter(label => !lockfileMap.has(label.normalizedName))
      : reached
    const divergenceLabels = lockfileMap && verbose ? reached : labelsToQuery
    const spokeTagLookup = await buildSpokeTagLookup(
      divergenceLabels,
      queryOpts,
      { verbose },
    )
    if (lockfileMap) {
      collectDivergenceWarnings(reached, lockfileMap, spokeTagLookup, warnings)
    }
    const lines = collectPypiPackages(reached, lockfileMap, spokeTagLookup)
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]!
      allLines.push({
        name: line.name,
        source: line.source,
        version: line.version,
      })
    }
    logger.info(`@${hubName}: ${lines.length} package(s)`)
  }
  return { lines: allLines, warnings }
}

export async function discoverPypiCandidates(
  mode: ReturnType<typeof detectWorkspaceMode>,
  queryOpts: BazelQueryOptions,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<{
  bazelCommandCandidates: PypiHubCandidate[] | undefined
  nativeCandidates: string[] | undefined
}> {
  const { verbose = false } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  if (!mode.bzlmod) {
    return { bazelCommandCandidates: undefined, nativeCandidates: undefined }
  }
  const extensionResult = await runBazelModShowPipExtension(queryOpts)
  const bazelCommandCandidates =
    extensionResult.code === 0
      ? parseBazelModPipExtensionCandidates(extensionResult.stdout, { verbose })
      : undefined
  if (extensionResult.code !== 0 && verbose) {
    logger.log(
      '[VERBOSE] bazel mod show_extension failed; falling back to bounded static candidate parsing:',
      extensionResult.stderr,
    )
  }
  const visibleRepos = await runBazelModShowVisibleRepos(queryOpts)
  const nativeCandidates =
    visibleRepos.code === 0
      ? parseVisibleRepoCandidates(visibleRepos.stdout)
      : undefined
  if (visibleRepos.code === 0 && verbose) {
    logger.log('[VERBOSE] Bzlmod visible repo candidates:', nativeCandidates)
  } else if (visibleRepos.code !== 0 && verbose) {
    logger.log(
      '[VERBOSE] bazel mod dump_repo_mapping failed; falling back to static candidate parsing:',
      visibleRepos.stderr,
    )
  }
  return { bazelCommandCandidates, nativeCandidates }
}

export async function extractBazelToPypi(
  config: ExtractBazelToPypiOptions,
): Promise<ExtractBazelToPypiResult> {
  const cfg = { __proto__: null, ...config } as ExtractBazelToPypiOptions
  const { cwd, out, verbose } = cfg
  logger.group('bazel2pypi:')
  logger.info(`- src dir: \`${cwd}\``)
  logger.info(`- out dir: \`${out}\``)
  if (!existsSync(cwd)) {
    logger.warn(`Warning: cwd does not exist: ${cwd}`)
  }
  logger.groupEnd()

  try {
    const { mode, queryOpts } = await preparePypiExtraction(cfg)

    // Step 4: discover validated PyPI hubs via the two-step recipe.
    const { bazelCommandCandidates, nativeCandidates } =
      await discoverPypiCandidates(mode, queryOpts, { verbose })
    const probe = buildPypiProbeFor(queryOpts)
    const hubs = await discoverPypiHubs(cwd, probe, {
      bazelCommandCandidates,
      nativeCandidates,
      verbose,
    })
    const hubNames = Array.from(hubs.keys())
    logger.info(
      `Discovered ${hubs.size} PyPI hub(s): ${hubNames.join(', ') || '(none)'}`,
    )

    if (!hubs.size) {
      if (verbose) {
        logger.info(
          'No PyPI hubs discovered. failureCategory=no-supported-ecosystem',
        )
      }
      return {
        artifactCount: 0,
        noEcosystemFound: true,
        ok: false,
      }
    }

    // Step 5: for each hub, resolve the requirements lockfile (fast path),
    // run the reached-closure query, and collect name==version pairs.
    const { lines: allLines, warnings } = await collectHubPackages(
      hubs,
      cwd,
      queryOpts,
      { verbose },
    )

    // Step 6: cross-hub conflict check (same normalized name, different
    // version across multiple hubs).
    validateCrossHubVersions(allLines)

    // Step 7: sort and write requirements.txt.
    const layout = cfg.outLayout ?? 'standalone'
    const manifestPath = await writePypiManifest(allLines, out, layout)

    if (verbose) {
      logger.log('[VERBOSE] outputs:', {
        artifactCount: allLines.length,
        generatedManifest: path.relative(out, manifestPath),
        layout,
        manifest: manifestPath,
        pypiHubs: hubNames,
        tool: 'socket manifest bazel',
        workspace: { bzlmod: mode.bzlmod, legacyWorkspace: mode.workspace },
      })
    }

    for (let i = 0, { length } = warnings; i < length; i += 1) {
      logger.warn(warnings[i]!)
    }

    if (!allLines.length) {
      logger.fail(
        'No PyPI packages extracted. failureCategory=ecosystem-detected-but-empty. See warnings above.',
      )
      return { artifactCount: 0, manifestPath, ok: false }
    }
    return { artifactCount: allLines.length, manifestPath, ok: true }
  } catch (e) {
    return reportPypiExtractionError(e, { verbose })
  }
}

export async function preparePypiExtraction(
  cfg: ExtractBazelToPypiOptions,
): Promise<{
  mode: ReturnType<typeof detectWorkspaceMode>
  queryOpts: BazelQueryOptions
}> {
  if (cfg.bazelOutputBase) {
    validateOutputBase(cfg.bazelOutputBase, cfg.cwd)
  }
  const shim = await provisionPythonShim()
  const baseEnv = shim.augmentedEnv ?? cfg.env
  const mode = detectWorkspaceMode(cfg.cwd)
  logger.info(
    `Workspace mode: bzlmod=${mode.bzlmod} workspace=${mode.workspace}`,
  )
  const invocationFlags = getBazelInvocationFlags(mode)
  const bin = await resolveBazelBinary(cfg.bin)
  logger.info(`Using bazel: ${bin}`)
  if (cfg.verbose) {
    logger.log('[VERBOSE] resolved options:', {
      bazelFlags: cfg.bazelFlags ?? '(unset)',
      bazelOutputBase: cfg.bazelOutputBase ?? '(unset)',
      bazelRc: cfg.bazelRc ?? '(unset)',
      bin,
      invocationFlags,
    })
  }
  return {
    mode,
    queryOpts: {
      bin,
      cwd: cfg.cwd,
      invocationFlags,
      ...(cfg.bazelRc ? { bazelRc: cfg.bazelRc } : {}),
      ...(cfg.bazelFlags ? { bazelFlags: cfg.bazelFlags } : {}),
      ...(cfg.bazelOutputBase ? { bazelOutputBase: cfg.bazelOutputBase } : {}),
      ...(baseEnv ? { env: baseEnv } : {}),
      verbose: cfg.verbose,
    },
  }
}

// Run the reached-closure query for Python targets and filter to hub labels.
export async function queryReachedPypiLabels(
  hubName: string,
  queryOpts: BazelQueryOptions,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<ReachedPypiLabel[]> {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  const queryStr = 'deps(kind("py_library|py_binary|py_test", //...))'
  const result = await runBazelQuery(queryStr, queryOpts, 'label')
  if (result.code !== 0) {
    if (verbose) {
      logger.log(
        `[VERBOSE] reached query failed for ${hubName}:`,
        result.stderr,
      )
    }
    return []
  }
  return filterReachedPypiPackages(result.stdout, hubName)
}

export function reportPypiExtractionError(
  error: unknown,
  options?: { verbose?: boolean | undefined } | undefined,
): ExtractBazelToPypiResult {
  const { verbose = false } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  logger.fail(`Unexpected error in bazel2pypi: ${errorMessage(error)}`)
  if (verbose) {
    logger.group('[VERBOSE] error:')
    logger.log(error)
    logger.groupEnd()
  } else {
    logger.info('Re-run with --verbose for the full stack.')
  }
  return { artifactCount: 0, ok: false }
}

// Resolve lockfile path and read/parse if within bounds.
export async function resolveHubLockfile(
  hubInfo: {
    requirementsLockLabel?: string | undefined
    requirementsLockPath?: string | undefined
  },
  cwd: string,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<Map<string, ExtractedPypiPackage> | undefined> {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  const resolved =
    hubInfo.requirementsLockPath ??
    resolveRequirementsLockPath(hubInfo.requirementsLockLabel, cwd)
  if (verbose) {
    logger.log(
      '[VERBOSE] lockfile resolved:',
      resolved ?? '(none from label/path)',
    )
  }
  const result = readRequirementsLockFile(resolved)
  if (verbose && result) {
    logger.log('[VERBOSE] lockfile parsed:', result.size, 'package(s)')
  }
  return result
}

export type ExtractBazelToPypiOptions = {
  env?: NodeJS.ProcessEnv | undefined
  outLayout?: 'flat' | 'standalone' | undefined
} & ExtractBazelToPypiRequired

export type ExtractBazelToPypiRequired = {
  bazelFlags: string | undefined
  bazelOutputBase: string | undefined
  bazelRc: string | undefined
  bin: string | undefined
  cwd: string
  out: string
  verbose: boolean
}

export type ExtractBazelToPypiResult = {
  artifactCount: number
  manifestPath?: string | undefined
  ok: boolean
  noEcosystemFound?: boolean | undefined
}

// One pinned package line destined for the generated requirements.txt.
export type PypiPackageLine = {
  name: string
  version: string
  source: string
}

// Sort package lines deterministically (locale-aware, lowercase comparison).
export function sortPackageLines(lines: PypiPackageLine[]): PypiPackageLine[] {
  return lines.toSorted((a, b) => {
    const aLow = a.name.toLowerCase()
    const bLow = b.name.toLowerCase()
    if (aLow < bLow) {
      return -1
    }
    if (aLow > bLow) {
      return 1
    }
    return a.name.localeCompare(b.name)
  })
}

export function validateCrossHubVersions(lines: PypiPackageLine[]): void {
  const versions = new Map<string, string>()
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const normalized = normalizePypiName(line.name)
    const existing = versions.get(normalized)
    if (existing && existing !== line.version) {
      throw new Error(
        `Conflicting versions for ${line.name}: ${existing} vs ${line.version} across hubs.`,
      )
    }
    versions.set(normalized, line.version)
  }
}

export async function writePypiManifest(
  lines: PypiPackageLine[],
  out: string,
  layout: 'flat' | 'standalone',
): Promise<string> {
  const manifestDir =
    layout === 'flat' ? path.join(out, '.socket-auto-manifest') : out
  mkdirSync(manifestDir, { recursive: true })
  const manifestPath = path.join(manifestDir, 'requirements.txt')
  const content = sortPackageLines(lines)
    .map(line => `${line.name}==${line.version}\n`)
    .join('')
  await fs.writeFile(manifestPath, content, 'utf8')
  return manifestPath
}
