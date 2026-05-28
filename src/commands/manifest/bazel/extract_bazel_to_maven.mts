import {
  existsSync,
  promises as fs,
  mkdirSync,
  mkdtempSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { resolveBazelBinary } from './bazel-bin-detect.mts'
import { runMetadataCqueryForRepo } from './bazel-cquery.mts'
import { ensureJavaOnPath } from './bazel-java-shim.mts'
import { validateOutputBase } from './bazel-output-base-check.mts'
import { provisionPythonShim } from './bazel-python-shim.mts'
import {
  buildMavenProbeFor,
  runBazelModShowMavenExtension,
} from './bazel-query-runner.mts'
import {
  CONVENTIONAL_MAVEN_REPO_NAMES,
  parseShowExtensionOutput,
  probeCandidate,
} from './bazel-repo-discovery.mts'
import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from './bazel-workspace-detect.mts'
import { findWorkspaceRoots } from './bazel-workspace-walk.mts'
import { getErrorCause } from '../../../utils/errors.mts'

import type {
  CqueryRepoResult,
  CqueryStatus,
} from './bazel-cquery.mts'
import type { ExtractedArtifact } from './bazel-build-parser.mts'
import type { BazelQueryOptions } from './bazel-query-runner.mts'
import type { WorkspaceMode } from './bazel-workspace-detect.mts'

export type ExtractBazelOptions = {
  bazelFlags: string | undefined
  bazelOutputBase: string | undefined
  bazelRc: string | undefined
  bin: string | undefined
  cwd: string
  // Optional env override used for python-shim PATH augmentation.
  env?: NodeJS.ProcessEnv
  // Customer-supplied Maven hub names augmenting the auto-discovery
  // candidate set. Wired in by the `--bazel-maven-repo=<name>` flag for
  // legacy WORKSPACE workspaces whose hubs use non-conventional names
  // (or custom Bzlmod extensions `mod show_extension` doesn't enumerate).
  extraMavenRepoNames?: string[] | undefined
  out: string
  // Use the auto-manifest sibling directory instead of writing directly to `out`.
  outLayout?: 'flat'
  // Per-repo cquery timeout in milliseconds. Auto-manifest default is 60s
  // (the orchestrator's job is to not stall the wider scan); explicit
  // invocations may bump it.
  perRepoTimeoutMs?: number | undefined
  verbose: boolean
}

export type ExtractBazelResult = {
  artifactCount: number
  manifestPath?: string | undefined
  noEcosystemFound?: boolean | undefined
  ok: boolean
  // Path to the per-invocation status sidecar describing which repos
  // produced artefacts and which timed out / were empty. Useful for the
  // server-side to surface partial results to the customer.
  statusPath?: string | undefined
}

type SidecarRepoEntry = {
  name: string
  status: CqueryStatus
  artifactCount: number
  durationMs: number
}

type SidecarWorkspaceEntry = {
  relPath: string
  mode: { bzlmod: boolean; workspace: boolean }
  repos: SidecarRepoEntry[]
}

type Sidecar = {
  complete: boolean
  workspaces: SidecarWorkspaceEntry[]
}

const DEFAULT_PER_REPO_TIMEOUT_MS = 60_000
const REAP_TIMEOUT_MS = 10_000

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
    const depKey = split.groupArtifact
    const depCoords = dependencySets.get(depKey) ?? new Set<string>()
    for (const depLabel of a.deps) {
      const c = depLabelToCoord(depLabel, labelToCoord)
      if (c) {
        const cs = splitCoord(c)
        depCoords.add(cs ? cs.groupArtifact : c)
      } else if (
        depLabel.includes(':') &&
        !depLabel.startsWith('@') &&
        !depLabel.startsWith(':')
      ) {
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

// Cross-workspace dedup keyed on the full Maven coordinate string
// (`g:a:v[:classifier]`). The metadata cquery emits one entry per rule,
// so the same `androidx.annotation:annotation:1.8.2` can show up in
// `examples/dagger/@maven` and `examples/ksp/@maven` in rules_kotlin —
// downstream only needs it once.
function dedupArtifactsByCoord(
  artifacts: ExtractedArtifact[],
): ExtractedArtifact[] {
  const seen = new Set<string>()
  const out: ExtractedArtifact[] = []
  for (const a of artifacts) {
    if (seen.has(a.mavenCoordinates)) {
      continue
    }
    seen.add(a.mavenCoordinates)
    out.push(a)
  }
  return out
}

// Build the per-workspace candidate Maven hub list. Bzlmod mode prefers
// `bazel mod show_extension`; WORKSPACE mode (and Bzlmod fallback when
// show_extension yields nothing) probes the conventional names plus any
// customer-supplied extras. Returns the list in discovery order.
async function discoverCandidatesForWorkspace(
  workspaceRoot: string,
  mode: WorkspaceMode,
  queryOpts: BazelQueryOptions,
  extras: readonly string[],
  verbose: boolean,
): Promise<string[]> {
  const candidates: string[] = []
  if (mode.bzlmod) {
    const extResult = await runBazelModShowMavenExtension(queryOpts)
    if (extResult.code === 0) {
      candidates.push(...parseShowExtensionOutput(extResult.stdout))
      if (verbose) {
        logger.log(
          `[VERBOSE] workspace ${workspaceRoot}: show_extension yielded`,
          candidates,
        )
      }
    } else if (verbose) {
      logger.log(
        `[VERBOSE] workspace ${workspaceRoot}: show_extension failed (code=${extResult.code}); falling back to conventional probe`,
      )
    }
  }
  // Probe conventional names + extras for any candidate not already
  // discovered. WORKSPACE mode relies entirely on the probe; Bzlmod
  // mode uses it as a defensive fallback (e.g. custom Maven extensions
  // mod show_extension doesn't enumerate).
  const seen = new Set(candidates)
  const probe = buildMavenProbeFor(queryOpts)
  const toProbe = [...CONVENTIONAL_MAVEN_REPO_NAMES, ...extras].filter(
    name => !seen.has(name),
  )
  for (const name of toProbe) {
    // eslint-disable-next-line no-await-in-loop
    const status = await probeCandidate(name, probe, verbose)
    if (status === 'populated') {
      candidates.push(name)
      seen.add(name)
    }
  }
  return candidates
}

// Best-effort reap of a Bazel server. Spawned with a short timeout so
// a wedged server can't itself hang the cleanup; failures are swallowed
// because the caller will `rm -rf` the output_user_root regardless.
async function reapBazelServer(
  bin: string,
  outputUserRoot: string,
): Promise<void> {
  try {
    await spawn(
      bin,
      [`--output_user_root=${outputUserRoot}`, 'shutdown'],
      { timeout: REAP_TIMEOUT_MS },
    )
  } catch {
    // Server may already be dead, or shutdown itself timed out — the
    // tempdir removal below is sufficient cleanup.
  }
}

async function removeTempdir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // Best effort. The next CLI invocation lands a fresh tempdir.
  }
}

function makeOutputUserRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'socket-bazel-'))
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

  const perRepoTimeoutMs =
    opts.perRepoTimeoutMs ?? DEFAULT_PER_REPO_TIMEOUT_MS
  const extras = opts.extraMavenRepoNames ?? []

  // Validate config + ensure toolchains BEFORE we mint a tempdir.
  let bin: string
  let baseEnv: NodeJS.ProcessEnv | undefined
  try {
    if (opts.bazelOutputBase) {
      validateOutputBase(opts.bazelOutputBase, opts.cwd)
    }
    ensureJavaOnPath()
    const shim = await provisionPythonShim()
    baseEnv = shim.augmentedEnv ?? opts.env
    bin = await resolveBazelBinary(opts.bin)
  } catch (e) {
    logger.fail(`Unexpected error in bazel2maven: ${getErrorCause(e)}`)
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    }
    return { artifactCount: 0, ok: false }
  }
  logger.info(`Using bazel: ${bin}`)

  // Track every output_user_root we mint so we can reap them all in
  // the cleanup pass, even if a per-repo timeout forced a re-mint.
  let outputUserRoot = makeOutputUserRoot()
  const mintedRoots: string[] = [outputUserRoot]
  if (verbose) {
    logger.log(
      `[VERBOSE] initial --output_user_root=${outputUserRoot} (will be reaped on completion)`,
    )
  }

  const sidecar: Sidecar = { complete: true, workspaces: [] }
  const allArtifacts: ExtractedArtifact[] = []

  try {
    const workspaceRoots = findWorkspaceRoots(cwd, verbose)
    if (!workspaceRoots.length) {
      logger.warn(
        `No Bazel workspace found at ${cwd} or beneath (looked for MODULE.bazel / WORKSPACE / WORKSPACE.bazel).`,
      )
      return { artifactCount: 0, noEcosystemFound: true, ok: false }
    }
    if (verbose) {
      logger.log(
        `[VERBOSE] discovered ${workspaceRoots.length} workspace root(s):`,
        workspaceRoots,
      )
    }

    for (const workspaceRoot of workspaceRoots) {
      const relPath = path.relative(cwd, workspaceRoot)
      let mode: WorkspaceMode
      try {
        mode = detectWorkspaceMode(workspaceRoot)
      } catch (e) {
        if (verbose) {
          logger.log(
            `[VERBOSE] workspace ${workspaceRoot}: detect failed (${getErrorCause(e)}); skipping`,
          )
        }
        continue
      }
      logger.info(
        `Workspace ${relPath || '.'}: bzlmod=${mode.bzlmod} workspace=${mode.workspace}`,
      )
      const invocationFlags = getBazelInvocationFlags(mode)
      const buildQueryOpts = (
        userRoot: string,
        spawnCwd: string,
      ): BazelQueryOptions => ({
        bin,
        cwd: spawnCwd,
        invocationFlags,
        outputUserRoot: userRoot,
        ...(opts.bazelRc ? { bazelRc: opts.bazelRc } : {}),
        ...(opts.bazelFlags ? { bazelFlags: opts.bazelFlags } : {}),
        ...(opts.bazelOutputBase
          ? { bazelOutputBase: opts.bazelOutputBase }
          : {}),
        ...(baseEnv ? { env: baseEnv } : {}),
        verbose,
      })

      // eslint-disable-next-line no-await-in-loop
      const candidates = await discoverCandidatesForWorkspace(
        workspaceRoot,
        mode,
        buildQueryOpts(outputUserRoot, workspaceRoot),
        extras,
        verbose,
      )
      logger.info(
        `Workspace ${relPath || '.'}: discovered ${candidates.length} Maven repo(s): ${
          candidates.join(', ') || '(none)'
        }`,
      )
      const wsEntry: SidecarWorkspaceEntry = {
        mode: { bzlmod: mode.bzlmod, workspace: mode.workspace },
        relPath,
        repos: [],
      }

      for (const repoName of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const result: CqueryRepoResult = await runMetadataCqueryForRepo({
          opts: buildQueryOpts(outputUserRoot, workspaceRoot),
          repoName,
          timeoutMs: perRepoTimeoutMs,
          workspaceRelPath: relPath,
          workspaceRoot,
        })
        wsEntry.repos.push({
          artifactCount: result.artifacts.length,
          durationMs: result.durationMs,
          name: repoName,
          status: result.status,
        })
        allArtifacts.push(...result.artifacts)
        if (result.status === 'ok' || result.status === 'partial') {
          logger.info(
            `@${repoName}: ${result.artifacts.length} artifact(s) (status=${result.status})`,
          )
        } else if (result.status === 'timeout') {
          logger.warn(
            `@${repoName}: cquery timed out after ${perRepoTimeoutMs}ms; reaping server`,
          )
          sidecar.complete = false
          // eslint-disable-next-line no-await-in-loop
          await reapBazelServer(bin, outputUserRoot)
          // eslint-disable-next-line no-await-in-loop
          await removeTempdir(outputUserRoot)
          outputUserRoot = makeOutputUserRoot()
          mintedRoots.push(outputUserRoot)
          if (verbose) {
            logger.log(
              `[VERBOSE] minted fresh --output_user_root=${outputUserRoot} after timeout`,
            )
          }
        } else if (verbose) {
          logger.log(
            `[VERBOSE] @${repoName}: status=${result.status} (no artifacts)`,
          )
        }
      }
      sidecar.workspaces.push(wsEntry)
    }

    const deduped = dedupArtifactsByCoord(allArtifacts)
    const normalized = normalizeToMavenInstallJson(deduped)
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
    const statusPath = path.join(manifestDir, 'manifest-status.json')
    await fs.writeFile(statusPath, JSON.stringify(sidecar, null, 2), 'utf8')

    if (verbose) {
      logger.log('[VERBOSE] outputs:', {
        artifactCount: deduped.length,
        complete: sidecar.complete,
        layout,
        manifestPath,
        statusPath,
        workspaceCount: sidecar.workspaces.length,
      })
    }

    const anyRepos = sidecar.workspaces.some(w => w.repos.length > 0)
    if (!deduped.length) {
      if (!anyRepos) {
        if (verbose) {
          logger.info(
            'No Maven artifacts extracted. failureCategory=no-supported-ecosystem',
          )
        }
        return {
          artifactCount: 0,
          manifestPath,
          noEcosystemFound: true,
          ok: false,
          statusPath,
        }
      }
      logger.fail(
        'Discovered Maven repo(s) but extracted zero artifacts. failureCategory=ecosystem-detected-but-empty',
      )
      return { artifactCount: 0, manifestPath, ok: false, statusPath }
    }
    logger.success(
      `Wrote ${deduped.length} artifact(s) to ${path.relative(cwd, manifestPath)}.`,
    )
    return {
      artifactCount: deduped.length,
      manifestPath,
      ok: sidecar.complete,
      statusPath,
    }
  } catch (e) {
    logger.fail(`Unexpected error in bazel2maven: ${getErrorCause(e)}`)
    if (verbose) {
      logger.group('[VERBOSE] error:')
      logger.log(e)
      logger.groupEnd()
    } else {
      logger.info('Re-run with --verbose for the full stack.')
    }
    return { artifactCount: 0, ok: false }
  } finally {
    for (const dir of mintedRoots) {
      // eslint-disable-next-line no-await-in-loop
      await reapBazelServer(bin, dir)
      // eslint-disable-next-line no-await-in-loop
      await removeTempdir(dir)
    }
  }
}
