/**
 * Per-repo metadata cquery + jsonproto parser for the Maven path.
 *
 * Pipeline:
 *  1. Build a cquery argv targeting `attr("tags", "\bmaven_coordinates=",
 *     @<repo>//...)` plus union variants for direct `maven_coordinates` /
 *     `maven_url` attributes. `--output=jsonproto` +
 *     `--proto:output_rule_attrs=tags,maven_coordinates,maven_url` keeps the
 *     payload small.
 *  2. Spawn under a caller-supplied `outputUserRoot` so the orchestrator can
 *     reap the server cleanly (`bazel --output_user_root=<this> shutdown`
 *     followed by `rm -rf`). The runner itself never deletes anything —
 *     server lifecycle is the orchestrator's concern.
 *  3. Parse the jsonproto stream defensively: dispatch on `attribute[].type`
 *     and accept both camelCase (`stringValue`, `stringListValue`) and
 *     snake_case (`string_value`, `string_list_value`) payload keys.
 *  4. Extract the maven coordinate from the direct `maven_coordinates` attr
 *     when present, else scan `tags` for `maven_coordinates=<G:A:V>`.
 *  5. Tag every artifact with `workspace:<rel-path>` + `repo:<name>`
 *     provenance via `sourceRepo`.
 */
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { splitBazelFlags } from './bazel-query-runner.mts'

import type { ExtractedArtifact } from './bazel-build-parser.mts'
import type { BazelQueryOptions } from './bazel-query-runner.mts'

export type CqueryStatus = 'ok' | 'partial' | 'timeout' | 'empty' | 'error'

export type CqueryRepoResult = {
  repoName: string
  workspaceRelPath: string
  status: CqueryStatus
  artifacts: ExtractedArtifact[]
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
  opts: BazelQueryOptions
}

// Maven coordinate token: `g:a:v` (3 parts) or `g:a:v:classifier` /
// `g:a:packaging:v` (4-part rules_jvm_external shapes). Tolerant of dots,
// dashes, plus, underscores in any part.
const MAVEN_COORD_TAG_RE = /^maven_coordinates=(.+)$/

// Build the metadata cquery target expression for one repo. The union of
// three predicates picks up artifacts that:
//  - encode the coordinate in the conventional `tags = ["maven_coordinates=..."]`
//    list (rules_jvm_external's emission for `jvm_import` and friends),
//  - declare the coordinate as a direct `maven_coordinates` attribute
//    (Bazel-native java_library / kt_jvm_import shape), or
//  - declare a `maven_url` (POM-only and source-jar shapes that omit the
//    coordinates tag but still represent a Maven artefact).
function buildMetadataCqueryExpr(repoName: string): string {
  const r = `@${repoName}//...`
  // The `\b` boundary in the tags predicate prevents matches on tag values
  // like `pre_maven_coordinates=fake`; see todo 2 acceptance test (10).
  return [
    `attr("tags", "\\bmaven_coordinates=", ${r})`,
    `attr("maven_coordinates", ".+", ${r})`,
    `attr("maven_url", ".+", ${r})`,
  ].join(' union ')
}

// Build the full cquery argv for a per-repo metadata cquery. Exposed for
// argv-shape unit tests without touching `spawn`. The startup-flag
// composition mirrors `bazel-query-runner`'s `buildStartupFlags` so
// customer `--bazel-startup-flag` values land before the subcommand and
// `--bazel-flag` values land after the standard cquery flags.
export function buildMetadataCqueryArgv(
  repoName: string,
  opts: BazelQueryOptions,
): string[] {
  const startup: string[] = []
  if (opts.bazelRc) {
    startup.push(`--bazelrc=${opts.bazelRc}`)
  }
  if (opts.outputUserRoot) {
    startup.push(`--output_user_root=${opts.outputUserRoot}`)
  }
  if (opts.bazelOutputBase) {
    startup.push(`--output_base=${opts.bazelOutputBase}`)
  }
  if (opts.extraBazelStartupFlags?.length) {
    startup.push(...opts.extraBazelStartupFlags)
  }
  const userFlags = [
    ...splitBazelFlags(opts.bazelFlags),
    ...(opts.extraBazelFlags ?? []),
  ]
  return [
    ...startup,
    'cquery',
    '--lockfile_mode=off',
    '--noshow_progress',
    ...opts.invocationFlags,
    buildMetadataCqueryExpr(repoName),
    '--output=jsonproto',
    '--proto:output_rule_attrs=tags,maven_coordinates,maven_url',
    '--keep_going',
    ...userFlags,
  ]
}

type JsonprotoAttribute = {
  name?: string
  type?: string
  stringValue?: string
  string_value?: string
  stringListValue?: string[]
  string_list_value?: string[]
}

type JsonprotoRule = {
  name?: string
  ruleClass?: string
  rule_class?: string
  attribute?: JsonprotoAttribute[]
}

type JsonprotoTarget = {
  type?: string
  rule?: JsonprotoRule
}

type JsonprotoEnvelope = {
  // Bazel 5+ wraps the stream in `{ "results": [ { "target": {...} } ] }`;
  // older shapes streamed one target per line. Accept either.
  results?: Array<{ target?: JsonprotoTarget }>
}

function readStringAttr(attr: JsonprotoAttribute): string | undefined {
  if (attr.type !== 'STRING') {
    return undefined
  }
  if (typeof attr.stringValue === 'string') {
    return attr.stringValue
  }
  if (typeof attr.string_value === 'string') {
    return attr.string_value
  }
  return undefined
}

function readStringListAttr(attr: JsonprotoAttribute): string[] | undefined {
  if (attr.type !== 'STRING_LIST') {
    return undefined
  }
  if (Array.isArray(attr.stringListValue)) {
    return attr.stringListValue
  }
  if (Array.isArray(attr.string_list_value)) {
    return attr.string_list_value
  }
  return undefined
}

// Extract the maven coordinate from a rule's attributes. Prefers the direct
// `maven_coordinates` attribute (Bazel-native shape); falls back to scanning
// `tags` for a `maven_coordinates=<G:A:V>` entry (rules_jvm_external shape).
// Returns undefined if neither yields a non-empty value.
function extractMavenCoordinate(
  rule: JsonprotoRule,
): { coord: string; url?: string | undefined } | undefined {
  let coord: string | undefined
  let url: string | undefined
  for (const attr of rule.attribute ?? []) {
    if (attr.name === 'maven_coordinates') {
      const direct = readStringAttr(attr)
      if (direct && direct.length) {
        coord = direct
      }
    } else if (attr.name === 'maven_url') {
      const direct = readStringAttr(attr)
      if (direct && direct.length) {
        url = direct
      }
    } else if (attr.name === 'tags') {
      const tags = readStringListAttr(attr)
      if (tags) {
        for (const tag of tags) {
          const m = MAVEN_COORD_TAG_RE.exec(tag)
          if (m && !coord) {
            coord = m[1]
          }
        }
      }
    }
  }
  if (!coord) {
    return undefined
  }
  return url ? { coord, url } : { coord }
}

// Strip the leading `@<repo>//:` prefix from a fully-qualified target label
// to recover the bare rule name (e.g. `com_google_guava_guava`).
function ruleNameFromLabel(label: string): string {
  const colon = label.lastIndexOf(':')
  return colon >= 0 ? label.slice(colon + 1) : label
}

// Pure parser for the jsonproto cquery stream. Returns one
// `ExtractedArtifact` per rule with a recoverable maven coordinate. The
// `sourceRepo` field carries `<workspaceRelPath>:<repoName>` provenance
// when a workspace path was provided; otherwise just the repo name.
export function parseCqueryJsonproto(
  stdout: string,
  repoName: string,
  workspaceRelPath: string,
): ExtractedArtifact[] {
  if (!stdout.trim()) {
    return []
  }
  // Bazel 5+ emits a single JSON envelope; older versions stream one target
  // per line. Try envelope-first, then fall back to per-line.
  const targets: JsonprotoTarget[] = []
  try {
    const parsed = JSON.parse(stdout) as JsonprotoEnvelope
    if (parsed.results) {
      for (const r of parsed.results) {
        if (r.target) {
          targets.push(r.target)
        }
      }
    }
  } catch {
    // Fall through to per-line scanning.
  }
  if (!targets.length) {
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }
      try {
        const parsed = JSON.parse(trimmed) as JsonprotoTarget
        if (parsed?.rule) {
          targets.push(parsed)
        }
      } catch {
        // Skip malformed lines.
      }
    }
  }
  const provenance = workspaceRelPath
    ? `${workspaceRelPath}:${repoName}`
    : repoName
  const out: ExtractedArtifact[] = []
  for (const target of targets) {
    if (target.type && target.type !== 'RULE') {
      continue
    }
    const rule = target.rule
    if (!rule || !rule.name) {
      continue
    }
    const extracted = extractMavenCoordinate(rule)
    if (!extracted) {
      continue
    }
    const ruleKind = rule.ruleClass ?? rule.rule_class ?? 'unknown'
    out.push({
      deps: [],
      mavenCoordinates: extracted.coord,
      ruleKind,
      ruleName: ruleNameFromLabel(rule.name),
      sourceRepo: provenance,
      ...(extracted.url ? { mavenUrl: extracted.url } : {}),
    })
  }
  return out
}

// Classify the runner's raw outcome. Non-zero exit with `--keep_going` is a
// `partial` (some target analysis failed; the successful subset is still in
// stdout). Zero exit with no parsed artefacts is `empty`. Spawn timeout is
// signalled separately; this helper handles the post-spawn case.
function classifyCqueryOutcome(
  code: number,
  artifactCount: number,
): CqueryStatus {
  if (code === 0) {
    return artifactCount > 0 ? 'ok' : 'empty'
  }
  // --keep_going treats partial-analysis failures with non-zero exit but
  // still yields the successful subset on stdout. Anything we parsed is
  // worth keeping.
  return artifactCount > 0 ? 'partial' : 'error'
}

// Spawn the per-repo metadata cquery, parse the result, and return a
// structured outcome. On spawn timeout, return `status: 'timeout'` so the
// orchestrator can reap the server (`bazel --output_user_root=<dir>
// shutdown` + `rm -rf`) before moving on.
export async function runMetadataCqueryForRepo(
  args: RunMetadataCqueryArgs,
): Promise<CqueryRepoResult> {
  const { opts, repoName, timeoutMs, workspaceRelPath, workspaceRoot } = args
  const argv = buildMetadataCqueryArgv(repoName, opts)
  const startedAt = Date.now()
  try {
    const result = await spawn(opts.bin, argv, {
      cwd: workspaceRoot,
      timeout: timeoutMs,
      ...(opts.env ? { env: opts.env } : {}),
    })
    const { code, stderr, stdout } = result
    const artifacts = parseCqueryJsonproto(stdout, repoName, workspaceRelPath)
    return {
      artifacts,
      durationMs: Date.now() - startedAt,
      repoName,
      status: classifyCqueryOutcome(code, artifacts.length),
      stderr,
      workspaceRelPath,
    }
  } catch (e) {
    const err = e as {
      code?: unknown
      killed?: unknown
      signal?: unknown
      stderr?: unknown
      stdout?: unknown
      timedOut?: unknown
    }
    const stdout = typeof err.stdout === 'string' ? err.stdout : ''
    const stderr = typeof err.stderr === 'string' ? err.stderr : ''
    const timedOut =
      err.timedOut === true ||
      err.killed === true ||
      err.signal === 'SIGTERM' ||
      err.signal === 'SIGKILL'
    const artifacts = stdout
      ? parseCqueryJsonproto(stdout, repoName, workspaceRelPath)
      : []
    return {
      artifacts,
      durationMs: Date.now() - startedAt,
      repoName,
      status: timedOut ? 'timeout' : 'error',
      stderr,
      workspaceRelPath,
    }
  }
}
