/**
 * Per-repo metadata cquery runner for the Maven path.
 *
 * Builds a cquery argv targeting `attr("tags", "\bmaven_coordinates=",
 * @<repo>//...)` plus a union variant for the direct `maven_coordinates`
 * attribute. `--output=jsonproto` +
 * `--proto:output_rule_attrs=tags,maven_coordinates,deps,exports,runtime_deps`
 * keeps the payload small while still surfacing the resolved Maven graph.
 * Spawns under a caller-supplied `outputUserRoot` so the orchestrator can
 * reap the server cleanly (`bazel --output_user_root=<this> shutdown`
 * followed by tempdir removal). The runner itself never deletes anything —
 * server lifecycle is the orchestrator's concern. Parsing lives in
 * `bazel-cquery-parse.mts`.
 */
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { parseCqueryJsonproto } from './bazel-cquery-parse.mts'
import { splitBazelFlags } from './bazel-query-runner.mts'

import type { ExtractedArtifact } from './bazel-cquery-parse.mts'
import type { BazelQueryOptions } from './bazel-query-runner.mts'

// Build the full cquery argv for a per-repo metadata cquery. Exposed for
// argv-shape unit tests without touching `spawn`.
export function buildMetadataCqueryArgv(
  repoName: string,
  config: BazelQueryOptions,
): string[] {
  const cfg = { __proto__: null, ...config } as BazelQueryOptions
  const startup: string[] = []
  if (cfg.bazelRc) {
    startup.push(`--bazelrc=${cfg.bazelRc}`)
  }
  if (cfg.outputUserRoot) {
    startup.push(`--output_user_root=${cfg.outputUserRoot}`)
  }
  if (cfg.bazelOutputBase) {
    startup.push(`--output_base=${cfg.bazelOutputBase}`)
  }
  const userFlags = splitBazelFlags(cfg.bazelFlags)
  return [
    ...startup,
    'cquery',
    '--lockfile_mode=off',
    '--noshow_progress',
    ...cfg.invocationFlags,
    buildMetadataCqueryExpr(repoName),
    '--output=jsonproto',
    '--proto:output_rule_attrs=tags,maven_coordinates,deps,exports,runtime_deps',
    '--keep_going',
    ...userFlags,
  ]
}

export type { ExtractedArtifact } from './bazel-cquery-parse.mts'

export type CqueryStatus = 'ok' | 'partial' | 'timeout' | 'empty' | 'error'

export type CqueryRepoResult = {
  repoName: string
  workspaceRelPath: string
  status: CqueryStatus
  artifacts: ExtractedArtifact[]
  // Hub-prefixed dep labels the parser could not resolve to a coordinate:
  // a missing target or an ambiguous suffix. A non-empty list means the graph
  // is known-incomplete; the orchestrator flips the hub partial.
  unresolvedLabels: string[]
  stderr: string
  durationMs: number
}

export type RunMetadataCqueryArgs = {
  repoName: string
  workspaceRoot: string
  // Provenance label (e.g. "examples/dagger"). Empty string for the root
  // workspace. Embedded in each artifact's `sourceRepo` as
  // `workspace:<path>+repo:<name>`.
  workspaceRelPath: string
  // Per-repo timeout in milliseconds. 60s default for auto-manifest;
  // 120s for explicit invocation. Orchestrator picks; runner just enforces.
  timeoutMs: number
  options: BazelQueryOptions
}

// Build the metadata cquery target expression for one repo. The union of
// two predicates picks up artifacts that:
//  - encode the coordinate in the conventional `tags = ["maven_coordinates=..."]`
//    list (rules_jvm_external's emission for `jvm_import` and friends), or
//  - declare the coordinate as a direct `maven_coordinates` attribute
//    (Bazel-native java_library / kt_jvm_import shape).
// Note: a `maven_url`-only predicate was intentionally left out — those rules
// carry no coordinate, so selecting them only to discard them downstream is
// wasted analysis. If POM-only artifacts ever matter, synthesize
// a coordinate from `maven_url` instead of adding the selector.
export function buildMetadataCqueryExpr(repoName: string): string {
  const r = `@${repoName}//...`
  // The `\b` boundary in the tags predicate prevents matches on tag values
  // like `pre_maven_coordinates=fake`.
  return [
    `attr("tags", "\\bmaven_coordinates=", ${r})`,
    `attr("maven_coordinates", ".+", ${r})`,
  ].join(' union ')
}

// Classify the runner's raw outcome. Non-zero exit with `--keep_going` is a
// `partial` (some target analysis failed; the successful subset is still in
// stdout). A clean exit with unresolved hub-prefixed edges is also `partial`
// — the graph is known-incomplete. Zero exit with no parsed artefacts is
// `empty`. Spawn timeout is signalled separately; this helper handles the
// post-spawn case.
export function classifyCqueryOutcome(
  code: number,
  artifactCount: number,
  unresolvedCount: number,
): CqueryStatus {
  if (code === 0) {
    if (!artifactCount) {
      return 'empty'
    }
    return unresolvedCount > 0 ? 'partial' : 'ok'
  }
  // --keep_going treats partial-analysis failures with non-zero exit but
  // still yields the successful subset on stdout. Anything we parsed is
  // worth keeping.
  return artifactCount > 0 ? 'partial' : 'error'
}

// Spawn the per-repo metadata cquery, parse the result, and return a
// structured outcome. On spawn timeout, return `status: 'timeout'` so the
// orchestrator can reap the server (`bazel --output_user_root=<dir>
// shutdown` + tempdir removal) before moving on.
export async function runMetadataCqueryForRepo(
  config: RunMetadataCqueryArgs,
): Promise<CqueryRepoResult> {
  const cfg = { __proto__: null, ...config } as RunMetadataCqueryArgs
  const { options, repoName, timeoutMs, workspaceRelPath, workspaceRoot } = cfg
  const argv = buildMetadataCqueryArgv(repoName, options)
  const startedAt = Date.now()
  try {
    const result = await spawn(options.bin, argv, {
      cwd: workspaceRoot,
      timeout: timeoutMs,
      ...(options.env ? { env: options.env } : {}),
    })
    const { code, stderr, stdout } = result
    const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
      stdout,
      repoName,
      workspaceRelPath,
    )
    return {
      artifacts,
      durationMs: Date.now() - startedAt,
      repoName,
      status: classifyCqueryOutcome(
        code,
        artifacts.length,
        unresolvedLabels.length,
      ),
      stderr,
      unresolvedLabels,
      workspaceRelPath,
    }
  } catch (e) {
    const err = e as {
      code?: number | string | undefined
      killed?: boolean | undefined
      signal?: string | undefined
      stderr?: string | undefined
      stdout?: string | undefined
    }
    const stdout = typeof err.stdout === 'string' ? err.stdout : ''
    const stderr = typeof err.stderr === 'string' ? err.stderr : ''
    // On a `timeout`, the lib spawn kills the child, so Node sets
    // `killed: true` and `signal: 'SIGTERM'` (or `SIGKILL`). There is no
    // `timedOut` flag on the real rejection, so do not test for one.
    const timedOut =
      err.killed === true ||
      err.signal === 'SIGKILL' ||
      err.signal === 'SIGTERM'
    const { artifacts, unresolvedLabels } = stdout
      ? parseCqueryJsonproto(stdout, repoName, workspaceRelPath)
      : { artifacts: [], unresolvedLabels: [] }
    // The lib `spawn` rejects on a non-zero exit, so a `--keep_going`
    // cquery that exits non-zero but still emitted a usable subset lands here
    // — not in the try block. Classify by what we parsed (subset present =>
    // `partial`, nothing parsed => `error`) so that partial subset is written
    // best-effort rather than discarded as a hard error. Timeout stays
    // distinct so the orchestrator can reap the wedged server.
    const code = typeof err.code === 'number' ? err.code : 1
    return {
      artifacts,
      durationMs: Date.now() - startedAt,
      repoName,
      status: timedOut
        ? 'timeout'
        : classifyCqueryOutcome(
            code,
            artifacts.length,
            unresolvedLabels.length,
          ),
      stderr,
      unresolvedLabels,
      workspaceRelPath,
    }
  }
}
