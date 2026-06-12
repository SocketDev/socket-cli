import {
  existsSync,
  promises as fs,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
  ROOT_MODULE_IMPORTER,
  parseShowExtensionOutput,
  probeCandidate,
} from './bazel-repo-discovery.mts'
import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from './bazel-workspace-detect.mts'
import { findWorkspaceRoots } from './bazel-workspace-walk.mts'
import { getErrorCause } from '../../../utils/errors.mts'
import { IGNORED_DIRS } from '../../../utils/glob.mts'

import type { CqueryRepoResult, ExtractedArtifact } from './bazel-cquery.mts'
import type { BazelQueryOptions } from './bazel-query-runner.mts'
import type { WorkspaceMode } from './bazel-workspace-detect.mts'
import type { Dirent } from 'node:fs'

export type ExtractBazelOptions = {
  bazelFlags: string | undefined
  bazelOutputBase: string | undefined
  bazelRc: string | undefined
  bin: string | undefined
  cwd: string
  // Optional env override used for python-shim PATH augmentation.
  env?: NodeJS.ProcessEnv
  // Directory basenames the workspace walker must not descend into.
  // Caller-supplied so the orchestrator stays generic; the CLI command
  // composes the codebase-wide `IGNORED_DIRS` with Bazel-specific dirs
  // like `.socket-auto-manifest`.
  ignoreDirNames?: ReadonlySet<string> | undefined
  // Directory basename prefixes the workspace walker must not descend
  // into. Caller-supplied so the orchestrator stays generic; the CLI
  // command supplies `bazel-` for Bazel's output_base symlinks.
  ignoreDirPrefixes?: readonly string[] | undefined
  out: string
  // Use the auto-manifest sibling directory instead of writing directly to `out`.
  outLayout?: 'flat'
  // Per-repo cquery timeout in milliseconds. When the caller leaves this
  // unset the orchestrator falls back to DEFAULT_PER_REPO_TIMEOUT_MS (the
  // auto-manifest default, kept short so the wider scan is not stalled). The
  // explicit `socket manifest bazel` command wires this to a CLI flag with a
  // longer default.
  perRepoTimeoutMs?: number | undefined
  verbose: boolean
}

// Best-effort-per-hub produces four distinct run outcomes a single `ok`
// boolean would conflate:
//  - `complete`    — every discovered hub extracted cleanly; >=1 manifest.
//  - `partial`     — >=1 manifest written, but at least one hub failed,
//                    timed out, or dropped edges. Worth uploading, but the
//                    graph is known-incomplete.
//  - `noEcosystem` — no Bazel/Maven found. Whether that's an error is
//                    caller-dependent (tolerated in auto mode, error in
//                    explicit mode), so it must NOT be flattened into the
//                    failure states.
//  - `hardFailure` — zero manifests written and it wasn't `noEcosystem`
//                    (discovery threw, or every discovered hub failed).
//                    Always an error for every caller.
export type ExtractBazelStatus =
  | 'complete'
  | 'hardFailure'
  | 'noEcosystem'
  | 'partial'

// Per-hub extraction state inside one workspace. Recorded so the CLI can emit
// a machine-readable completeness signal instead of presenting a partial
// extraction as complete.
//  - `populated`     — the hub yielded >=1 artifact and a manifest was written.
//  - `empty`         — the hub is defined but has no Maven targets.
//  - `not-defined`   — the probed conventional name does not exist here.
//  - `skipped-lockfile` — a committed maven_install.json already covers this
//                    hub, so the CLI deliberately did not re-emit it.
//  - `failed`        — the hub's cquery errored, timed out, or its graph was
//                    known-incomplete (dropped/pruned edges, --keep_going).
//  - `indeterminate` — discovery could not classify the hub (probe threw or
//                    returned an unrecognized error); NOT evidence of absence.
export type HubState =
  | 'populated'
  | 'empty'
  | 'not-defined'
  | 'skipped-lockfile'
  | 'failed'
  | 'indeterminate'

export type HubOutcome = {
  hub: string
  state: HubState
  // Short, machine-stable reason when the hub is `failed`/`indeterminate`.
  reason?: string | undefined
}

// Per-workspace outcome. `load` distinguishes a workspace we could not even
// read (`failed` — e.g. an unbound-var MODULE.bazel fragment) from one we
// analyzed (`loaded`). A workspace that failed to load contributes to a
// hard failure when nothing else was analyzable, and to a partial otherwise.
export type WorkspaceOutcome = {
  relPath: string
  load: 'loaded' | 'failed'
  hubs: HubOutcome[]
  // Set when the workspace itself could not be analyzed.
  reason?: string | undefined
}

export type ExtractBazelResult = {
  artifactCount: number
  manifestPaths: string[]
  status: ExtractBazelStatus
  // True only when `status === 'complete'`. Surfaced so downstream consumers
  // (and the CLI's emitted summary) get a single machine-readable
  // completeness flag without re-deriving it from `status`.
  complete: boolean
  // Per-workspace / per-hub analyzability breakdown backing the completeness
  // signal. Empty for `noEcosystem` and early `hardFailure` (toolchain setup
  // failed before any workspace was inspected).
  workspaceOutcomes: WorkspaceOutcome[]
}

const DEFAULT_PER_REPO_TIMEOUT_MS = 60_000
const REAP_TIMEOUT_MS = 10_000

// Machine-readable completeness signal emitted alongside the synthetic
// manifests. A `complete: false` summary tells a downstream consumer (e.g.
// depscan) that the uploaded SBOM is known-incomplete so it must not be
// treated as an authoritative full closure. Enforcement of this signal is a
// separate downstream follow-up; the CLI only emits it.
const COMPLETENESS_SUMMARY_FILE_NAME = 'socket-bazel-manifest-summary.json'

// Default directory-prune policy for the Bazel workspace walk. The
// orchestrator applies this unconditionally so neither caller (the explicit
// `socket manifest bazel` command nor `--auto-manifest`) can omit it and let
// the walk descend `node_modules`/VCS/vendored trees. Callers may
// pass extra names/prefixes to EXTEND, not replace, this set.
export const DEFAULT_BAZEL_WALKER_IGNORE_DIR_NAMES: ReadonlySet<string> =
  new Set([
    ...IGNORED_DIRS,
    '.hg',
    '.idea',
    '.pnpm-store',
    '.socket-auto-manifest',
    '.svn',
    '.vscode',
  ])
// Bazel's `bazel-*` output_base symlinks.
export const DEFAULT_BAZEL_WALKER_IGNORE_DIR_PREFIXES: readonly string[] = [
  'bazel-',
]

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
  artifacts: Record<string, { version: string }>
  dependencies: Record<string, string[]>
  repositories?: Record<string, string[]>
}

export type NormalizeResult = {
  json: MavenInstallJsonCurrent
  // Versionless keys skipped because the coordinate was malformed (key shape
  // outside 2-4 non-empty segments, or an empty version). Known data loss.
  droppedArtifacts: string[]
  // `source -> target` edges pruned because one endpoint wasn't an emitted
  // artifact. Known data loss.
  prunedEdges: string[]
}

// A versionless `maven_install.json` key must have 2-4 non-empty
// colon-separated segments (`g:a`, `g:a:ext`, `g:a:ext:classifier`) — exactly
// the range depscan's `coordinateToParts` accepts. A key outside that range,
// or with an empty segment, is rejected after upload, so reject it locally.
function isValidVersionlessKey(key: string): boolean {
  const parts = key.split(':')
  if (parts.length < 2 || parts.length > 4) {
    return false
  }
  return parts.every(p => p.length > 0)
}

// Builds a modern `maven_install.json` from artifacts whose `deps` already
// hold resolved versionless coordinates (the cquery parser resolves edge
// labels against each repo's own targets while `repoName` is in scope, so no
// label-to-coordinate resolution happens here). Keys are versionless `g:a`
// (preserving any packaging/classifier segments); dependency values are the
// resolved coordinate sets.
//
// Two-phase so the emitted graph is internally closed and survives the server
// parser, which rejects malformed coordinates and edges referencing unlisted
// artifacts (and can abort after enough errors). Phase 1 builds (and
// validates) the artifact keys; phase 2 emits only edges whose source AND
// target are valid emitted keys. Anything dropped is reported so the caller
// can flip the hub partial — never silently lost post-upload.
export function normalizeToMavenInstallJson(
  artifacts: ExtractedArtifact[],
): NormalizeResult {
  const out: MavenInstallJsonCurrent = {
    artifacts: {},
    dependencies: {},
  }
  const droppedArtifacts: string[] = []
  const prunedEdges: string[] = []
  const versionsByGroupArtifact = new Map<string, string>()
  // Phase 1: artifacts. Validate each key (shape + non-empty version) before
  // accepting it; record the set of valid emitted keys.
  const depsByKey = new Map<string, Set<string>>()
  for (const a of artifacts) {
    const split = splitCoord(a.mavenCoordinates)
    if (!split) {
      droppedArtifacts.push(a.mavenCoordinates)
      continue
    }
    const key = split.groupArtifact
    // A `g:a:` coordinate strips to the valid-shaped key `g:a` but an empty
    // version, which the server rejects — require both.
    if (!isValidVersionlessKey(key) || !split.version) {
      droppedArtifacts.push(a.mavenCoordinates)
      continue
    }
    const existingVersion = versionsByGroupArtifact.get(key)
    if (existingVersion && existingVersion !== split.version) {
      throw new Error(
        `Conflicting versions for ${key}: ${existingVersion}, ${split.version}. The generated maven_install.json cannot represent multiple versions for the same group:artifact losslessly.`,
      )
    }
    if (!existingVersion) {
      versionsByGroupArtifact.set(key, split.version)
      out.artifacts[key] = { version: split.version }
    }
    // Accumulate the candidate edge set keyed by "g:a" (no version), matching
    // the canonical rules_jvm_external lockfile shape. Pruned against valid
    // keys in phase 2.
    const depCoords = depsByKey.get(key) ?? new Set<string>()
    for (const depCoord of a.deps) {
      depCoords.add(depCoord)
    }
    if (depCoords.size) {
      depsByKey.set(key, depCoords)
    }
  }
  // Phase 2: edges. Emit only where both source and target are emitted keys.
  const validKeys = new Set(Object.keys(out.artifacts))
  for (const [key, depCoords] of depsByKey) {
    if (!validKeys.has(key)) {
      for (const target of depCoords) {
        prunedEdges.push(`${key} -> ${target}`)
      }
      continue
    }
    const kept: string[] = []
    for (const target of depCoords) {
      if (validKeys.has(target)) {
        kept.push(target)
      } else {
        prunedEdges.push(`${key} -> ${target}`)
      }
    }
    if (kept.length) {
      out.dependencies[key] = kept
    }
  }
  return { droppedArtifacts, json: out, prunedEdges }
}

// Cross-workspace dedup keyed on the full Maven coordinate string
// (`g:a:v[:classifier]`). The metadata cquery emits one entry per rule,
// so the same `androidx.annotation:annotation:1.8.2` can show up in
// `examples/dagger/@maven` and `examples/ksp/@maven` in rules_kotlin —
// downstream only needs it once. Each occurrence resolves its edges against
// its own repo's targets, so the resolved `deps` can legitimately differ
// between occurrences; union them rather than keeping only the first, or
// real graph edges would be silently dropped.
export function dedupArtifactsByCoord(
  artifacts: ExtractedArtifact[],
): ExtractedArtifact[] {
  const byCoord = new Map<string, ExtractedArtifact>()
  for (const a of artifacts) {
    const existing = byCoord.get(a.mavenCoordinates)
    if (!existing) {
      byCoord.set(a.mavenCoordinates, { ...a, deps: [...a.deps] })
      continue
    }
    const merged = new Set(existing.deps)
    for (const dep of a.deps) {
      merged.add(dep)
    }
    existing.deps = [...merged]
  }
  return [...byCoord.values()]
}

// The committed lockfile name the server-side walker already ingests for a
// hub: `maven_install.json` for a hub literally named `maven`, else
// `<hub>_maven_install.json`. Centralised so the gate and the synthetic
// writer agree on the name.
function hubManifestFileName(repoName: string): string {
  return repoName === 'maven'
    ? 'maven_install.json'
    : `${repoName}_maven_install.json`
}

// Does a committed lockfile already cover this workspace/hub? The server-side
// walker globs `**/*maven_install.json` at any depth, so a real committed
// lockfile anywhere under the workspace root is already ingested and the CLI
// must not re-emit a synthetic complement (double-emit). We check the
// workspace root itself and any committed lockfile beneath it, while skipping
// the directory we are about to write synthetic manifests into so we never
// mistake our own prior output for a committed file.
function committedLockfileCovers(args: {
  fileName: string
  manifestDir: string
  workspaceRoot: string
}): string | undefined {
  const { fileName, manifestDir, workspaceRoot } = args
  // Resolve once so the manifest-dir skip comparison is path-normalized.
  const manifestDirResolved = path.resolve(manifestDir)
  const stack: string[] = [workspaceRoot]
  while (stack.length) {
    const dir = stack.pop()!
    // Never treat our own synthetic output directory as a committed lockfile.
    if (path.resolve(dir) === manifestDirResolved) {
      continue
    }
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const name = entry.name
        // Don't descend the noise dirs the walker also prunes; this keeps the
        // gate cheap and avoids walking node_modules/VCS trees.
        if (
          DEFAULT_BAZEL_WALKER_IGNORE_DIR_NAMES.has(name) ||
          DEFAULT_BAZEL_WALKER_IGNORE_DIR_PREFIXES.some(p => name.startsWith(p))
        ) {
          continue
        }
        stack.push(path.join(dir, entry.name))
      } else if (entry.isFile() && entry.name === fileName) {
        return path.join(dir, entry.name)
      }
    }
  }
  return undefined
}

// Emit the machine-readable completeness summary next to the manifests. This
// is the CLI's honest "is this SBOM complete?" signal in the emitted output;
// it carries the run status plus the per-workspace / per-hub breakdown so a
// downstream consumer can detect a known-incomplete upload. Best-effort: a
// failure to write the summary must never sink an otherwise-usable run, so it
// is logged (under verbose) and swallowed.
async function writeCompletenessSummary(args: {
  artifactCount: number
  complete: boolean
  manifestDir: string
  manifestPaths: string[]
  status: ExtractBazelStatus
  verbose: boolean
  workspaceOutcomes: WorkspaceOutcome[]
}): Promise<void> {
  const {
    artifactCount,
    complete,
    manifestDir,
    manifestPaths,
    status,
    verbose,
    workspaceOutcomes,
  } = args
  const summary = {
    artifactCount,
    complete,
    ecosystem: 'maven',
    manifestCount: manifestPaths.length,
    status,
    workspaces: workspaceOutcomes,
  }
  try {
    mkdirSync(manifestDir, { recursive: true })
    await fs.writeFile(
      path.join(manifestDir, COMPLETENESS_SUMMARY_FILE_NAME),
      JSON.stringify(summary, null, 2),
      'utf8',
    )
  } catch (e) {
    if (verbose) {
      logger.log(
        `[VERBOSE] completeness summary not written (${getErrorCause(e)}); the run result still carries the signal`,
      )
    }
  }
}

type WriteHubManifestResult = {
  artifactCount: number
  droppedArtifacts: string[]
  manifestPath: string | undefined
  prunedEdges: string[]
}

// Dedup, normalize, and write one hub's manifest. The path mirrors the
// workspace tree: `<manifestDir>/<relPath>/<name>.json`, where `<name>` is
// `maven_install.json` for a hub literally named `maven`, else
// `<hub>_maven_install.json` (matching the server walker's
// `**/*_maven_install.json` glob). The root workspace (`relPath===''`) writes
// at `<manifestDir>/<name>.json`. Returns `manifestPath: undefined` (no file
// written) when the hub yields zero valid artifacts, plus the dropped/pruned
// accounting so the caller can flip the hub partial.
async function writeHubManifest(args: {
  artifacts: ExtractedArtifact[]
  cwd: string
  manifestDir: string
  relPath: string
  repoName: string
  verbose: boolean
}): Promise<WriteHubManifestResult> {
  const { artifacts, manifestDir, relPath, repoName } = args
  const deduped = dedupArtifactsByCoord(artifacts)
  const { droppedArtifacts, json, prunedEdges } =
    normalizeToMavenInstallJson(deduped)
  const artifactCount = Object.keys(json.artifacts).length
  if (!artifactCount) {
    return {
      artifactCount: 0,
      droppedArtifacts,
      manifestPath: undefined,
      prunedEdges,
    }
  }
  const fileName = hubManifestFileName(repoName)
  const hubDir = relPath ? path.join(manifestDir, relPath) : manifestDir
  mkdirSync(hubDir, { recursive: true })
  const manifestPath = path.join(hubDir, fileName)
  await fs.writeFile(manifestPath, JSON.stringify(json, null, 2), 'utf8')
  return { artifactCount, droppedArtifacts, manifestPath, prunedEdges }
}

// Build the per-workspace candidate Maven hub list.
//
// Bzlmod mode: trust `bazel mod show_extension` as the authoritative hub
// list, keeping only hubs imported by <root>.
//
// WORKSPACE mode: no equivalent of `show_extension`, so probe the
// conventional hub names.
//
// On `show_extension` failure (or a parse that yields zero root hubs) under
// Bzlmod, fall through to the conventional-name probe so partial discovery
// is still possible.
type DiscoverResult = {
  candidates: string[]
  // Conventional names whose probe could not be classified (threw or returned
  // an unrecognized error). A non-empty list means discovery may have missed
  // a hub, so the run can never be reported complete.
  indeterminateProbes: string[]
}

async function discoverCandidatesForWorkspace(
  workspaceRoot: string,
  mode: WorkspaceMode,
  queryOpts: BazelQueryOptions,
  verbose: boolean,
): Promise<DiscoverResult> {
  const candidates: string[] = []
  const indeterminateProbes: string[] = []
  let showExtensionSucceeded = false
  if (mode.bzlmod) {
    const extResult = await runBazelModShowMavenExtension(queryOpts)
    if (extResult.code === 0) {
      // The maven extension generates a hub for EVERY module that uses it —
      // the root's own `maven.install` hub(s) plus the rulesets' internal
      // hubs (rules_jvm_external_deps, stardoc_maven, …). Keep only hubs
      // imported by <root>; the rest are build-tooling, not the user's SBOM.
      const entries = parseShowExtensionOutput(extResult.stdout)
      const kept = entries.filter(e =>
        e.importers.includes(ROOT_MODULE_IMPORTER),
      )
      candidates.push(...kept.map(e => e.name))
      // Gate the probe fallback on the KEPT count, not the raw parse: a
      // report listing only transitive ruleset hubs (all filtered out) must
      // still fall through to conventional probing so a root @maven isn't
      // missed.
      showExtensionSucceeded = kept.length > 0
      if (verbose) {
        logger.log(
          `[VERBOSE] workspace ${workspaceRoot}: show_extension kept root hub(s)`,
          kept.map(e => e.name),
        )
        for (const dropped of entries) {
          if (!dropped.importers.includes(ROOT_MODULE_IMPORTER)) {
            logger.log(
              `[VERBOSE] workspace ${workspaceRoot}: dropped ${dropped.name} — imported by ${dropped.importers.join(', ')}, not ${ROOT_MODULE_IMPORTER}`,
            )
          }
        }
      }
    } else if (verbose) {
      logger.log(
        `[VERBOSE] workspace ${workspaceRoot}: show_extension failed (code=${extResult.code}); falling back to conventional probe`,
      )
    }
  }
  // Probe candidates the show_extension path could not authoritatively
  // enumerate: when it produced root hubs, probe nothing extra; otherwise
  // (WORKSPACE mode, a failed show_extension, or a parse with zero root
  // hubs) probe the conventional hub names.
  const seen = new Set(candidates)
  const toProbe = (
    showExtensionSucceeded ? [] : [...CONVENTIONAL_MAVEN_REPO_NAMES]
  ).filter(name => !seen.has(name))
  if (!toProbe.length) {
    return { candidates, indeterminateProbes }
  }
  const probe = buildMavenProbeFor(queryOpts)
  for (const name of toProbe) {
    // eslint-disable-next-line no-await-in-loop
    const status = await probeCandidate(name, probe, verbose)
    if (status === 'populated') {
      candidates.push(name)
      seen.add(name)
    } else if (status === 'indeterminate') {
      // The probe failed for a reason we can't classify; we have no proof the
      // hub is absent. Record it so the run is flagged not-complete rather
      // than silently treating the hub as "no Maven here".
      indeterminateProbes.push(name)
    }
  }
  return { candidates, indeterminateProbes }
}

// Best-effort reap of a Bazel server. Spawned with a short timeout so
// a wedged server can't itself hang the cleanup; failures are swallowed
// because the caller will `rm -rf` the output_user_root regardless.
async function reapBazelServer(
  bin: string,
  outputUserRoot: string,
  verbose: boolean,
): Promise<void> {
  try {
    await spawn(bin, [`--output_user_root=${outputUserRoot}`, 'shutdown'], {
      timeout: REAP_TIMEOUT_MS,
    })
  } catch (e) {
    // Server may already be dead, or shutdown itself timed out — the
    // tempdir removal below is sufficient cleanup.
    if (verbose) {
      logger.log(
        `[VERBOSE] reapBazelServer: shutdown failed for ${outputUserRoot} (${getErrorCause(e)}); tempdir removal will still run`,
      )
    }
  }
}

async function removeTempdir(dir: string, verbose: boolean): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (e) {
    // Best effort. The next CLI invocation lands a fresh tempdir.
    if (verbose) {
      logger.log(
        `[VERBOSE] removeTempdir: ${dir} not fully removed (${getErrorCause(e)}); a stale dir may linger until the next OS tempdir sweep`,
      )
    }
  }
}

function makeOutputUserRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'socket-bazel-'))
}

// Construct the BazelQueryOptions shape used for a single workspace's
// queries. Lifted to module scope (out of the per-workspace loop) so
// ESLint's consistent-function-scoping is happy; takes everything it
// previously closed over as explicit params.
function buildQueryOpts(args: {
  baseEnv: NodeJS.ProcessEnv | undefined
  bin: string
  invocationFlags: string[]
  opts: ExtractBazelOptions
  outputUserRoot: string
  spawnCwd: string
  verbose: boolean
}): BazelQueryOptions {
  const {
    baseEnv,
    bin,
    invocationFlags,
    opts,
    outputUserRoot,
    spawnCwd,
    verbose,
  } = args
  return {
    bin,
    cwd: spawnCwd,
    invocationFlags,
    outputUserRoot,
    ...(opts.bazelRc ? { bazelRc: opts.bazelRc } : {}),
    ...(opts.bazelFlags ? { bazelFlags: opts.bazelFlags } : {}),
    ...(opts.bazelOutputBase ? { bazelOutputBase: opts.bazelOutputBase } : {}),
    ...(baseEnv ? { env: baseEnv } : {}),
    verbose,
  }
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

  const perRepoTimeoutMs = opts.perRepoTimeoutMs ?? DEFAULT_PER_REPO_TIMEOUT_MS

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
    return {
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'hardFailure',
      workspaceOutcomes: [],
    }
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

  const layout = opts.outLayout ?? 'standalone'
  const manifestDir =
    layout === 'flat' ? path.join(out, '.socket-auto-manifest') : out
  // One manifest per (workspace, hub), written best-effort: a single wedged
  // hub must not discard the manifests every other hub produced.
  const manifestPaths: string[] = []
  let totalArtifacts = 0
  let anyRepos = false
  let hubsSucceeded = 0
  let hubsFailed = 0
  // Per-workspace / per-hub analyzability breakdown backing the completeness
  // signal the CLI emits. A run is only `complete` when no workspace failed to
  // load, no probe was indeterminate, and every queried hub succeeded cleanly.
  const workspaceOutcomes: WorkspaceOutcome[] = []
  let anyIndeterminate = false
  let anyWorkspaceLoadFailed = false
  // A hub we deliberately skipped because a committed lockfile already covers
  // it. This is a SUCCESSFUL no-op (the server already ingests that lockfile),
  // so it must not be conflated with "discovered a hub we failed to extract".
  let anyHubCoveredByLockfile = false

  try {
    // Always apply the default prune policy so no caller can forget it;
    // callers EXTEND it via ignoreDirNames/ignoreDirPrefixes.
    const ignoreDirNames = new Set([
      ...DEFAULT_BAZEL_WALKER_IGNORE_DIR_NAMES,
      ...(opts.ignoreDirNames ?? []),
    ])
    const ignoreDirPrefixes = [
      ...DEFAULT_BAZEL_WALKER_IGNORE_DIR_PREFIXES,
      ...(opts.ignoreDirPrefixes ?? []),
    ]
    const workspaceRoots = findWorkspaceRoots({
      cwd,
      ignoreDirNames,
      ignoreDirPrefixes,
      verbose,
    })
    if (!workspaceRoots.length) {
      logger.warn(
        `No Bazel workspace found at ${cwd} or beneath (looked for MODULE.bazel / WORKSPACE / WORKSPACE.bazel).`,
      )
      return {
        artifactCount: 0,
        complete: false,
        manifestPaths: [],
        status: 'noEcosystem',
        workspaceOutcomes: [],
      }
    }
    if (verbose) {
      logger.log(
        `[VERBOSE] discovered ${workspaceRoots.length} workspace root(s):`,
        workspaceRoots,
      )
    }

    for (const workspaceRoot of workspaceRoots) {
      const relPath = path.relative(cwd, workspaceRoot)
      const hubOutcomes: HubOutcome[] = []
      let mode: WorkspaceMode
      try {
        mode = detectWorkspaceMode(workspaceRoot)
      } catch (e) {
        // A workspace we cannot even read is a load failure, NOT "no Maven
        // here": record it so the run is flagged not-complete (a hard failure
        // when nothing else was analyzable, partial otherwise) rather than
        // silently skipped.
        const reason = getErrorCause(e)
        if (verbose) {
          logger.log(
            `[VERBOSE] workspace ${workspaceRoot}: load failed (${reason})`,
          )
        }
        logger.warn(
          `Workspace ${relPath || '.'}: failed to load (${reason}); it could not be analyzed.`,
        )
        anyWorkspaceLoadFailed = true
        workspaceOutcomes.push({
          hubs: [],
          load: 'failed',
          reason,
          relPath,
        })
        continue
      }
      logger.info(
        `Workspace ${relPath || '.'}: bzlmod=${mode.bzlmod} workspace=${mode.workspace}`,
      )
      const invocationFlags = getBazelInvocationFlags(mode)
      const queryOptsFor = (userRoot: string): BazelQueryOptions =>
        buildQueryOpts({
          baseEnv,
          bin,
          invocationFlags,
          opts,
          outputUserRoot: userRoot,
          spawnCwd: workspaceRoot,
          verbose,
        })

      const { candidates, indeterminateProbes } =
        // eslint-disable-next-line no-await-in-loop
        await discoverCandidatesForWorkspace(
          workspaceRoot,
          mode,
          queryOptsFor(outputUserRoot),
          verbose,
        )
      for (const indeterminate of indeterminateProbes) {
        anyIndeterminate = true
        hubOutcomes.push({
          hub: indeterminate,
          reason: 'probe-indeterminate',
          state: 'indeterminate',
        })
      }
      logger.info(
        `Workspace ${relPath || '.'}: discovered ${candidates.length} Maven repo(s): ${
          candidates.join(', ') || '(none)'
        }`,
      )
      for (const repoName of candidates) {
        // Committed-lockfile gate: the server-side walker already ingests any
        // committed maven_install.json / <hub>_maven_install.json under the
        // workspace; the CLI's synthetic manifest is the COMPLEMENT, not a
        // duplicate. Skip emitting when a committed lockfile already covers
        // this hub. A skip is a successful no-op, so it runs BEFORE
        // `anyRepos` is flipped (which marks "a hub we needed to extract").
        const committed = committedLockfileCovers({
          fileName: hubManifestFileName(repoName),
          manifestDir,
          workspaceRoot,
        })
        if (committed) {
          anyHubCoveredByLockfile = true
          logger.info(
            `@${repoName}: committed lockfile already covers this hub (${path.relative(cwd, committed) || committed}); skipping synthetic manifest.`,
          )
          hubOutcomes.push({
            hub: repoName,
            reason: 'committed-lockfile',
            state: 'skipped-lockfile',
          })
          if (verbose) {
            logger.log(
              `[VERBOSE] @${repoName}: skipped (committed lockfile at ${committed})`,
            )
          }
          continue
        }
        // We are about to extract this hub: it is a real candidate we must
        // analyze, so mark the ecosystem present.
        anyRepos = true
        if (verbose) {
          logger.log(
            `[VERBOSE] workspace ${relPath || '.'}: running metadata cquery for @${repoName} (timeout ${perRepoTimeoutMs}ms)`,
          )
        }
        // eslint-disable-next-line no-await-in-loop
        const result: CqueryRepoResult = await runMetadataCqueryForRepo({
          opts: queryOptsFor(outputUserRoot),
          repoName,
          timeoutMs: perRepoTimeoutMs,
          workspaceRelPath: relPath,
          workspaceRoot,
        })
        if (result.status === 'timeout') {
          logger.warn(
            `@${repoName}: cquery timed out after ${perRepoTimeoutMs}ms; reaping server`,
          )
          hubsFailed += 1
          hubOutcomes.push({
            hub: repoName,
            reason: 'cquery-timeout',
            state: 'failed',
          })
          // eslint-disable-next-line no-await-in-loop
          await reapBazelServer(bin, outputUserRoot, verbose)
          // eslint-disable-next-line no-await-in-loop
          await removeTempdir(outputUserRoot, verbose)
          outputUserRoot = makeOutputUserRoot()
          mintedRoots.push(outputUserRoot)
          if (verbose) {
            logger.log(
              `[VERBOSE] minted fresh --output_user_root=${outputUserRoot} after timeout`,
            )
          }
          continue
        }
        if (result.status === 'error') {
          logger.warn(`@${repoName}: cquery failed; skipping this hub`)
          hubsFailed += 1
          hubOutcomes.push({
            hub: repoName,
            reason: 'cquery-error',
            state: 'failed',
          })
          continue
        }
        // A scan must never silently upload a graph missing edges it knows
        // it dropped: warn unconditionally and treat the hub as partial.
        let hubPartial = result.unresolvedLabels.length > 0
        if (hubPartial) {
          logger.warn(
            `@${repoName}: dropped ${result.unresolvedLabels.length} unresolved dependency edge(s): ${result.unresolvedLabels.join(', ')}`,
          )
        }
        // A non-zero cquery exit that still yielded a usable subset
        // (--keep_going) is reported as `partial` even with no unresolved
        // labels — the graph is known-incomplete, so flip the hub partial.
        if (result.status === 'partial' && !result.unresolvedLabels.length) {
          hubPartial = true
          logger.warn(
            `@${repoName}: cquery partially failed (--keep_going); the dependency graph may be incomplete`,
          )
        }
        let written: WriteHubManifestResult
        try {
          // eslint-disable-next-line no-await-in-loop
          written = await writeHubManifest({
            artifacts: result.artifacts,
            cwd,
            manifestDir,
            relPath,
            repoName,
            verbose,
          })
        } catch (e) {
          // Best-effort per hub: a write failure must not abort the walk and
          // discard the manifests other hubs already produced.
          logger.warn(
            `@${repoName}: failed to write manifest (${getErrorCause(e)}); skipping this hub`,
          )
          hubsFailed += 1
          hubOutcomes.push({
            hub: repoName,
            reason: 'manifest-write-failed',
            state: 'failed',
          })
          continue
        }
        if (written.droppedArtifacts.length) {
          hubPartial = true
          logger.warn(
            `@${repoName}: dropped ${written.droppedArtifacts.length} malformed Maven coordinate(s): ${written.droppedArtifacts.join(', ')}`,
          )
        }
        if (written.prunedEdges.length) {
          hubPartial = true
          logger.warn(
            `@${repoName}: pruned ${written.prunedEdges.length} dependency edge(s) referencing unlisted artifacts: ${written.prunedEdges.join(', ')}`,
          )
        }
        if (written.manifestPath) {
          manifestPaths.push(written.manifestPath)
          totalArtifacts += written.artifactCount
          if (hubPartial) {
            hubsFailed += 1
            hubOutcomes.push({
              hub: repoName,
              reason: 'incomplete-graph',
              state: 'failed',
            })
          } else {
            hubsSucceeded += 1
            hubOutcomes.push({ hub: repoName, state: 'populated' })
          }
          if (verbose) {
            logger.log(
              `[VERBOSE] @${repoName}: status=${result.status}, ${written.artifactCount} artifact(s) -> ${written.manifestPath}`,
            )
          }
        } else {
          // No artifacts to write (empty hub). Not itself a failure, but if
          // edges were dropped the partial signal still applies.
          if (hubPartial) {
            hubsFailed += 1
            hubOutcomes.push({
              hub: repoName,
              reason: 'incomplete-graph',
              state: 'failed',
            })
          } else {
            hubOutcomes.push({ hub: repoName, state: 'empty' })
          }
          if (verbose) {
            logger.log(
              `[VERBOSE] @${repoName}: status=${result.status} (no manifest written)`,
            )
          }
        }
      }
      workspaceOutcomes.push({
        hubs: hubOutcomes,
        load: 'loaded',
        relPath,
      })
      if (verbose) {
        for (const outcome of hubOutcomes) {
          logger.log(
            `[VERBOSE] workspace ${relPath || '.'} hub @${outcome.hub}: ${outcome.state}${
              outcome.reason ? ` (${outcome.reason})` : ''
            }`,
          )
        }
      }
    }

    if (!manifestPaths.length) {
      // Every discovered hub was already covered by a committed lockfile and
      // nothing else needed extraction: writing zero synthetic manifests is
      // the CORRECT complement, not a failure. The run is complete only when
      // no workspace failed to load and no probe was indeterminate.
      if (
        anyHubCoveredByLockfile &&
        !anyRepos &&
        !anyWorkspaceLoadFailed &&
        !anyIndeterminate
      ) {
        logger.success(
          'All discovered Maven hub(s) are already covered by committed lockfiles; nothing to generate.',
        )
        await writeCompletenessSummary({
          artifactCount: 0,
          complete: true,
          manifestDir,
          manifestPaths: [],
          status: 'complete',
          verbose,
          workspaceOutcomes,
        })
        return {
          artifactCount: 0,
          complete: true,
          manifestPaths: [],
          status: 'complete',
          workspaceOutcomes,
        }
      }
      // Nothing was emitted. If nothing was analyzable at all (no repos to
      // extract, no committed-lockfile coverage, no workspace load failure, no
      // indeterminate probe) this is a genuine absence; otherwise it's a hard
      // failure — something was present but we could not extract it.
      if (
        !anyRepos &&
        !anyWorkspaceLoadFailed &&
        !anyIndeterminate &&
        !anyHubCoveredByLockfile
      ) {
        if (verbose) {
          logger.info(
            'No Maven artifacts extracted. failureCategory=no-supported-ecosystem',
          )
        }
        return {
          artifactCount: 0,
          complete: false,
          manifestPaths: [],
          status: 'noEcosystem',
          workspaceOutcomes,
        }
      }
      logger.fail(
        'Discovered or partially analyzed Maven workspace(s) but wrote zero manifests. failureCategory=ecosystem-detected-but-empty',
      )
      await writeCompletenessSummary({
        artifactCount: 0,
        complete: false,
        manifestDir,
        manifestPaths: [],
        status: 'hardFailure',
        verbose,
        workspaceOutcomes,
      })
      return {
        artifactCount: 0,
        complete: false,
        manifestPaths: [],
        status: 'hardFailure',
        workspaceOutcomes,
      }
    }

    // Manifests were written, so the run is not a hard failure. It is only
    // `complete` when every queried hub succeeded cleanly AND no workspace
    // failed to load AND no probe was indeterminate; any of those means the
    // emitted SBOM is known-incomplete (partial under the hybrid rule).
    const knownIncomplete =
      hubsFailed > 0 || anyWorkspaceLoadFailed || anyIndeterminate
    const status: ExtractBazelStatus = knownIncomplete ? 'partial' : 'complete'
    if (status === 'complete') {
      logger.success(
        `Wrote ${manifestPaths.length} manifest(s), ${totalArtifacts} artifact(s) total.`,
      )
    } else {
      const loadNote = anyWorkspaceLoadFailed
        ? ', at least one workspace failed to load'
        : ''
      const indetNote = anyIndeterminate
        ? ', at least one hub could not be classified'
        : ''
      logger.warn(
        `Wrote ${manifestPaths.length} manifest(s), ${totalArtifacts} artifact(s) total — partial run: ${hubsSucceeded} hub(s) succeeded, ${hubsFailed} failed or incomplete${loadNote}${indetNote}. The uploaded SBOM is known-incomplete.`,
      )
    }
    if (verbose) {
      logger.log('[VERBOSE] outputs:', {
        anyIndeterminate,
        anyWorkspaceLoadFailed,
        artifactCount: totalArtifacts,
        hubsFailed,
        hubsSucceeded,
        layout,
        manifestPaths,
        status,
      })
    }
    await writeCompletenessSummary({
      artifactCount: totalArtifacts,
      complete: status === 'complete',
      manifestDir,
      manifestPaths,
      status,
      verbose,
      workspaceOutcomes,
    })
    return {
      artifactCount: totalArtifacts,
      complete: status === 'complete',
      manifestPaths,
      status,
      workspaceOutcomes,
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
    return {
      artifactCount: 0,
      complete: false,
      manifestPaths: [],
      status: 'hardFailure',
      workspaceOutcomes,
    }
  } finally {
    for (const dir of mintedRoots) {
      // eslint-disable-next-line no-await-in-loop
      await reapBazelServer(bin, dir, verbose)
      // eslint-disable-next-line no-await-in-loop
      await removeTempdir(dir, verbose)
    }
  }
}
