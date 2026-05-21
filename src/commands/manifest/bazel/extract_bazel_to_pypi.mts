import { existsSync, promises as fs, mkdirSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { resolveBazelBinary } from './bazel-bin-detect.mts'
import { validateOutputBase } from './bazel-output-base-check.mts'
import {
  discoverPypiHubs,
  parseBazelModPipExtensionCandidates,
} from './bazel-pypi-discovery.mts'
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
import { parseVisibleRepoCandidates } from './bazel-repo-discovery.mts'
import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from './bazel-workspace-detect.mts'
import { getErrorCause } from '../../../utils/errors.mts'

import type { PypiHubCandidate } from './bazel-pypi-discovery.mts'
import type {
  ExtractedPypiPackage,
  ReachedPypiLabel,
} from './bazel-pypi-parser.mts'
import type { BazelQueryOptions } from './bazel-query-runner.mts'

export type ExtractBazelToPypiOptions = {
  bazelFlags: string | undefined
  bazelOutputBase: string | undefined
  bazelRc: string | undefined
  bin: string | undefined
  cwd: string
  env?: NodeJS.ProcessEnv
  out: string
  outLayout?: 'flat'
  verbose: boolean
  explicitEcosystem?: boolean
}

export type ExtractBazelToPypiResult = {
  artifactCount: number
  manifestPath?: string | undefined
  ok: boolean
  noEcosystemFound?: boolean
}

// Sort package lines deterministically (locale-aware, lowercase comparison).
function sortPackageLines(
  lines: Array<{ name: string; version: string }>,
): Array<{ name: string; version: string }> {
  return lines.sort((a, b) => {
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

export async function extractBazelToPypi(
  opts: ExtractBazelToPypiOptions,
): Promise<ExtractBazelToPypiResult> {
  const { cwd, out, verbose } = opts
  logger.group('bazel2pypi:')
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
    // Python shim (for rules_python workspace discovery).
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

    // Step 4: discover validated PyPI hubs via the two-step recipe.
    let bazelCommandCandidates: PypiHubCandidate[] | undefined
    let nativeCandidates: string[] | undefined
    if (mode.bzlmod) {
      const extensionResult = await runBazelModShowPipExtension(queryOpts)
      if (extensionResult.code === 0) {
        bazelCommandCandidates = parseBazelModPipExtensionCandidates(
          extensionResult.stdout,
          verbose,
        )
      } else if (verbose) {
        logger.log(
          '[VERBOSE] bazel mod show_extension failed; falling back to bounded static candidate parsing:',
          extensionResult.stderr,
        )
      }

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
    const probe = buildPypiProbeFor(queryOpts)
    const hubs = await discoverPypiHubs(
      cwd,
      probe,
      nativeCandidates,
      verbose,
      bazelCommandCandidates,
    )
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
        ok: false,
        noEcosystemFound: true,
      }
    }

    // Step 5: for each hub, resolve the requirements lockfile (fast path),
    // run the reached-closure query, and collect name==version pairs.
    const allLines: Array<{ name: string; version: string; source: string }> =
      []
    const warnings: string[] = []
    for (const [hubName, hubInfo] of hubs) {
      // eslint-disable-next-line no-await-in-loop
      const lockfileMap = await resolveHubLockfile(hubInfo, cwd, verbose)
      // eslint-disable-next-line no-await-in-loop
      const reached = await queryReachedPypiLabels(hubName, queryOpts, verbose)
      const labelsToQuery = lockfileMap
        ? reached.filter(label => !lockfileMap.has(label.normalizedName))
        : reached
      const divergenceLabels = lockfileMap && verbose ? reached : labelsToQuery
      // eslint-disable-next-line no-await-in-loop
      const spokeTagLookup = await buildSpokeTagLookup(
        divergenceLabels,
        queryOpts,
        verbose,
      )

      // Check for lockfile-vs-spoke-tag divergence and log warnings.
      if (lockfileMap) {
        for (const label of reached) {
          const lockEntry = lockfileMap.get(label.normalizedName)
          const spokeEntry = spokeTagLookup?.get(label.normalizedName)
          if (
            lockEntry &&
            spokeEntry &&
            lockEntry.version !== spokeEntry.version
          ) {
            warnings.push(
              `Version divergence for ${label.originalLabel}: lockfile says ${lockEntry.version}, spoke tag says ${spokeEntry.version}. Using lockfile.`,
            )
          }
        }
      }

      const lines = collectPypiPackages(reached, lockfileMap, spokeTagLookup)
      for (const l of lines) {
        allLines.push({ name: l.name, version: l.version, source: l.source })
      }
      logger.info(`@${hubName}: ${lines.length} package(s)`)
    }

    // Step 6: cross-hub conflict check (same normalized name, different
    // version across multiple hubs).
    const crossHubVersions = new Map<string, string>()
    for (const l of allLines) {
      const normalized = normalizePypiName(l.name)
      const existing = crossHubVersions.get(normalized)
      if (existing && existing !== l.version) {
        throw new Error(
          `Conflicting versions for ${l.name}: ${existing} vs ${l.version} across hubs.`,
        )
      }
      crossHubVersions.set(normalized, l.version)
    }

    // Step 7: sort and write requirements.txt.
    const sorted = sortPackageLines(allLines)
    const lines = sorted.map(p => `${p.name}==${p.version}\n`)
    const layout = opts.outLayout ?? 'standalone'
    const manifestDir =
      layout === 'flat' ? path.join(out, '.socket-auto-manifest') : out
    mkdirSync(manifestDir, { recursive: true })
    const manifestPath = path.join(manifestDir, 'requirements.txt')
    await fs.writeFile(manifestPath, lines.join(''), 'utf8')

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

    for (const w of warnings) {
      logger.warn(w)
    }

    if (!allLines.length) {
      logger.fail(
        'No PyPI packages extracted. failureCategory=ecosystem-detected-but-empty. See warnings above.',
      )
      return { artifactCount: 0, manifestPath, ok: false }
    }
    logger.success(
      `Wrote ${allLines.length} package(s) to ${path.relative(cwd, manifestPath)}.`,
    )
    return {
      artifactCount: allLines.length,
      manifestPath,
      ok: true,
    }
  } catch (e) {
    logger.fail(`Unexpected error in bazel2pypi: ${getErrorCause(e)}`)
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

// Resolve lockfile path and read/parse if within bounds.
async function resolveHubLockfile(
  hubInfo: {
    requirementsLockLabel?: string | undefined
    requirementsLockPath?: string | undefined
  },
  cwd: string,
  verbose: boolean,
): Promise<Map<string, ExtractedPypiPackage> | undefined> {
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

// Run the reached-closure query for Python targets and filter to hub labels.
async function queryReachedPypiLabels(
  hubName: string,
  queryOpts: BazelQueryOptions,
  verbose: boolean,
): Promise<ReachedPypiLabel[]> {
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

// Build a spoke-tag lookup map for reached labels that don't have lockfile
// entries. For each reached label, if the lockfile missed it, resolve the
// actual target via `--output=build` and extract pypi_name/pypi_version.
async function buildSpokeTagLookup(
  reached: ReachedPypiLabel[],
  queryOpts: BazelQueryOptions,
  verbose: boolean,
): Promise<Map<string, ExtractedPypiPackage>> {
  const lookup = new Map<string, ExtractedPypiPackage>()
  for (const label of reached) {
    // Only query the spoke if we haven't already resolved it.
    if (lookup.has(label.normalizedName)) {
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const buildResult = await runBazelQuery(`${label.apparentLabel}`, {
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
        // eslint-disable-next-line no-await-in-loop
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
