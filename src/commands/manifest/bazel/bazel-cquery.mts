/**
 * Per-repo metadata cquery + jsonproto parser for the Maven path.
 *
 * Pipeline:
 *  1. Build a cquery argv targeting `attr("tags", "\bmaven_coordinates=",
 *     @<repo>//...)` plus a union variant for the direct `maven_coordinates`
 *     attribute. `--output=jsonproto` +
 *     `--proto:output_rule_attrs=tags,maven_coordinates,deps,exports,runtime_deps`
 *     keeps the payload small while still surfacing the resolved Maven graph.
 *  2. Spawn under a caller-supplied `outputUserRoot` so the orchestrator can
 *     reap the server cleanly (`bazel --output_user_root=<this> shutdown`
 *     followed by `rm -rf`). The runner itself never deletes anything —
 *     server lifecycle is the orchestrator's concern.
 *  3. Parse the jsonproto stream defensively: dispatch on `attribute[].type`
 *     and accept both camelCase (`stringValue`, `stringListValue`) and
 *     snake_case (`string_value`, `string_list_value`) payload keys.
 *  4. Extract the maven coordinate from the direct `maven_coordinates` attr
 *     when present, else scan `tags` for `maven_coordinates=<G:A:V>`.
 *  5. Resolve each rule's `deps`/`exports`/`runtime_deps` label edges into
 *     versionless Maven coordinates against this repo's own targets, while
 *     `repoName` is still in scope. Edges that point at a hub-prefixed target
 *     we cannot resolve are reported as `unresolvedLabels` so the caller can
 *     flip the hub partial rather than silently dropping graph edges.
 *  6. Tag every artifact with `workspace:<rel-path>` + `repo:<name>`
 *     provenance via `sourceRepo`.
 */
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { splitBazelFlags } from './bazel-query-runner.mts'

import type { BazelQueryOptions } from './bazel-query-runner.mts'

// One Maven artifact recovered from the cquery stream. `ruleKind` is whatever
// `ruleClass` jsonproto reports (`jvm_import`, `aar_import`, `java_library`,
// `kt_jvm_import`, any future rules_jvm_external rule), so the type is open.
// `deps` holds resolved versionless Maven coordinates (the parser resolves the
// rule's label edges against this repo's own targets), not raw Bazel labels.
export type ExtractedArtifact = {
  deps: string[]
  mavenCoordinates: string
  ruleKind: string
  ruleName: string
  sourceRepo?: string | undefined
}

export type CqueryStatus = 'ok' | 'partial' | 'timeout' | 'empty' | 'error'

export type CqueryRepoResult = {
  repoName: string
  workspaceRelPath: string
  status: CqueryStatus
  artifacts: ExtractedArtifact[]
  // Hub-prefixed dep labels the parser could not resolve to a coordinate
  // (missing target or ambiguous suffix). A non-empty list means the graph
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
  opts: BazelQueryOptions
}

// Result of parsing one repo's cquery stream: the recovered artifacts (with
// resolved coordinate edges in `deps`) plus any hub-prefixed dep labels that
// could not be resolved.
export type ParseCqueryResult = {
  artifacts: ExtractedArtifact[]
  unresolvedLabels: string[]
}

// Maven coordinate token: `g:a:v` (3 parts) or `g:a:v:classifier` /
// `g:a:packaging:v` (4-part rules_jvm_external shapes). Tolerant of dots,
// dashes, plus, underscores in any part.
const MAVEN_COORD_TAG_RE = /^maven_coordinates=(.+)$/

// The dep/export/runtime_deps attributes whose label edges encode the
// resolved Maven graph. rules_jvm_external writes `jvm_import.deps` (e.g.
// `junit` -> `@maven//:org_hamcrest_hamcrest_core`); compile/runtime scopes
// surface via `exports`/`runtime_deps`. We union all three.
const EDGE_ATTR_NAMES: ReadonlySet<string> = new Set([
  'deps',
  'exports',
  'runtime_deps',
])

// Build the metadata cquery target expression for one repo. The union of
// two predicates picks up artifacts that:
//  - encode the coordinate in the conventional `tags = ["maven_coordinates=..."]`
//    list (rules_jvm_external's emission for `jvm_import` and friends), or
//  - declare the coordinate as a direct `maven_coordinates` attribute
//    (Bazel-native java_library / kt_jvm_import shape).
// Note: a `maven_url`-only predicate was intentionally dropped — those rules
// carry no coordinate, so selecting them only to discard them downstream is
// wasted analysis. If POM-only artifacts ever matter, synthesize
// a coordinate from `maven_url` instead of re-adding the selector.
function buildMetadataCqueryExpr(repoName: string): string {
  const r = `@${repoName}//...`
  // The `\b` boundary in the tags predicate prevents matches on tag values
  // like `pre_maven_coordinates=fake`; see todo 2 acceptance test (10).
  return [
    `attr("tags", "\\bmaven_coordinates=", ${r})`,
    `attr("maven_coordinates", ".+", ${r})`,
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
    '--proto:output_rule_attrs=tags,maven_coordinates,deps,exports,runtime_deps',
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

// Reads a `LABEL_LIST` jsonproto attribute. Bazel serializes label lists into
// the same string-list payload (`stringListValue` / `string_list_value`) it
// uses for `STRING_LIST`, but tags the attribute `type: "LABEL_LIST"`. The
// `deps`/`exports`/`runtime_deps` edge attrs are LABEL_LIST, so a STRING_LIST
// reader would silently return nothing and leave the graph empty.
function readLabelListAttr(attr: JsonprotoAttribute): string[] | undefined {
  if (attr.type !== 'LABEL_LIST') {
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

// Strip the trailing version segment from a Maven coordinate, preserving any
// packaging/classifier segments. `g:a:v` -> `g:a`,
// `g:a:packaging:v` -> `g:a:packaging`,
// `g:a:packaging:classifier:v` -> `g:a:packaging:classifier`. Coordinates with
// fewer than 3 segments have no version to strip and are returned unchanged.
// This matches depscan's `coordinateToParts` keying (position 3 = extension,
// position 4 = classifier on the versionless key), so AAR/classifier artifacts
// key correctly instead of being mis-keyed as bare `group:artifact` jars.
export function versionlessCoordinate(coord: string): string {
  const parts = coord.split(':')
  if (parts.length < 3) {
    return coord
  }
  return parts.slice(0, -1).join(':')
}

// Recover the `@<repo>//` prefix from a fully-qualified target label, covering
// both apparent (`@maven//:foo`) and bzlmod-canonical
// (`@@rules_jvm_external++maven+maven//pkg:foo`) forms. Returns undefined for
// labels that aren't repo-qualified (e.g. `:src`).
function repoPrefixOfLabel(label: string): string | undefined {
  if (!label.startsWith('@')) {
    return undefined
  }
  const sep = label.indexOf('//')
  if (sep < 0) {
    return undefined
  }
  return label.slice(0, sep + 2)
}

// Strip the leading `@<repo>//:` prefix from a fully-qualified target label
// to recover the bare rule name (e.g. `com_google_guava_guava`).
function ruleNameFromLabel(label: string): string {
  const colon = label.lastIndexOf(':')
  return colon >= 0 ? label.slice(colon + 1) : label
}

// Extract the maven coordinate from a rule's attributes. Prefers the direct
// `maven_coordinates` attribute (Bazel-native shape); falls back to scanning
// `tags` for a `maven_coordinates=<G:A:V>` entry (rules_jvm_external shape).
// Returns undefined if neither yields a non-empty value.
function extractMavenCoordinate(rule: JsonprotoRule): string | undefined {
  let coord: string | undefined
  for (const attr of rule.attribute ?? []) {
    if (attr.name === 'maven_coordinates') {
      const direct = readStringAttr(attr)
      if (direct && direct.length) {
        coord = direct
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
  return coord
}

// Collect the union of `deps`/`exports`/`runtime_deps` label edges off a rule.
function extractEdgeLabels(rule: JsonprotoRule): string[] {
  const labels: string[] = []
  for (const attr of rule.attribute ?? []) {
    if (attr.name && EDGE_ATTR_NAMES.has(attr.name)) {
      const list = readLabelListAttr(attr)
      if (list) {
        labels.push(...list)
      }
    }
  }
  return labels
}

// A coordinate-bearing rule recovered from the cquery stream, before its edge
// labels are resolved to coordinates.
type RawRecord = {
  fullLabel: string
  coord: string
  ruleKind: string
  ruleName: string
  edgeLabels: string[]
}

type LabelCoordIndex = {
  // Full target label (as emitted by this cquery) -> versionless coordinate.
  fullLabels: Map<string, string>
  // `:<ruleName>` suffix -> set of versionless coordinates, used only as a
  // unique-match fallback for labels that don't full-match.
  suffixToCoords: Map<string, Set<string>>
  // Repo prefixes (`@maven//`, `@@rje++maven+maven//`, …) of every selected
  // coordinate-bearing target — the set of "this hub's" prefixes.
  hubPrefixes: Set<string>
}

// Build the label -> coordinate index from this repo's own coordinate-bearing
// targets, keyed by the full emitted rule label (the form dep labels also use,
// since both come from the same cquery output). The `:<ruleName>` suffix map
// is a fallback for labels that don't full-match.
function buildLabelCoordIndex(records: RawRecord[]): LabelCoordIndex {
  const fullLabels = new Map<string, string>()
  const suffixToCoords = new Map<string, Set<string>>()
  const hubPrefixes = new Set<string>()
  for (const rec of records) {
    const coord = versionlessCoordinate(rec.coord)
    fullLabels.set(rec.fullLabel, coord)
    const suffix = `:${rec.ruleName}`
    const set = suffixToCoords.get(suffix) ?? new Set<string>()
    set.add(coord)
    suffixToCoords.set(suffix, set)
    const prefix = repoPrefixOfLabel(rec.fullLabel)
    if (prefix) {
      hubPrefixes.add(prefix)
    }
  }
  return { fullLabels, hubPrefixes, suffixToCoords }
}

function isHubPrefixed(label: string, hubPrefixes: Set<string>): boolean {
  for (const prefix of hubPrefixes) {
    if (label.startsWith(prefix)) {
      return true
    }
  }
  return false
}

type DepResolution =
  | { kind: 'coord'; coord: string }
  | { kind: 'unresolved' }
  | { kind: 'drop' }

// Resolve one dep label into a versionless coordinate. Classifies into three
// buckets (there is deliberately no "seen but coordinate-less" bucket — the
// cquery only selects coordinate-bearing targets):
//  - `coord`     — full-label match, unique-suffix fallback, or an already-a-
//                  coordinate `g:a:v` string label.
//  - `unresolved`— hub-prefixed but resolves to nothing in the selected set
//                  (missing target or ambiguous suffix): a known-dropped edge.
//  - `drop`      — a non-maven target (`@platforms//…`, `:src`): intentional.
function resolveDepLabel(label: string, index: LabelCoordIndex): DepResolution {
  const full = index.fullLabels.get(label)
  if (full) {
    return { coord: full, kind: 'coord' }
  }
  if (isHubPrefixed(label, index.hubPrefixes)) {
    // Suffix fallback, but only when the match is unique.
    const suffix = `:${ruleNameFromLabel(label)}`
    const set = index.suffixToCoords.get(suffix)
    if (set && set.size === 1) {
      return { coord: [...set][0]!, kind: 'coord' }
    }
    // Hub-prefixed but missing or ambiguous — a genuinely dropped edge.
    return { kind: 'unresolved' }
  }
  // Already-a-coordinate fallback: a bare `g:a:v` string label (not a Bazel
  // label). Versionless-normalize it. Exclude `//`-prefixed package-relative
  // labels (`//pkg:thing`) — those are Bazel targets, not coordinates.
  if (
    label.includes(':') &&
    !label.startsWith('@') &&
    !label.startsWith(':') &&
    !label.startsWith('//')
  ) {
    return { coord: versionlessCoordinate(label), kind: 'coord' }
  }
  // Non-maven target — intentional drop, not counted.
  return { kind: 'drop' }
}

// Pure parser for the jsonproto cquery stream. Returns one
// `ExtractedArtifact` per rule with a recoverable maven coordinate (its `deps`
// holding resolved versionless coordinates) plus the set of hub-prefixed dep
// labels that could not be resolved. The `sourceRepo` field carries
// `<workspaceRelPath>:<repoName>` provenance when a workspace path was
// provided; otherwise just the repo name.
export function parseCqueryJsonproto(
  stdout: string,
  repoName: string,
  workspaceRelPath: string,
): ParseCqueryResult {
  if (!stdout.trim()) {
    return { artifacts: [], unresolvedLabels: [] }
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
  // First pass: collect coordinate-bearing rules with their raw edge labels.
  const records: RawRecord[] = []
  for (const target of targets) {
    if (target.type && target.type !== 'RULE') {
      continue
    }
    const rule = target.rule
    if (!rule || !rule.name) {
      continue
    }
    const coord = extractMavenCoordinate(rule)
    if (!coord) {
      continue
    }
    records.push({
      coord,
      edgeLabels: extractEdgeLabels(rule),
      fullLabel: rule.name,
      ruleKind: rule.ruleClass ?? rule.rule_class ?? 'unknown',
      ruleName: ruleNameFromLabel(rule.name),
    })
  }
  // Second pass: resolve edge labels against this repo's own targets.
  const index = buildLabelCoordIndex(records)
  const provenance = workspaceRelPath
    ? `${workspaceRelPath}:${repoName}`
    : repoName
  const out: ExtractedArtifact[] = []
  const unresolved = new Set<string>()
  for (const rec of records) {
    const deps = new Set<string>()
    for (const label of rec.edgeLabels) {
      const resolution = resolveDepLabel(label, index)
      if (resolution.kind === 'coord') {
        deps.add(resolution.coord)
      } else if (resolution.kind === 'unresolved') {
        unresolved.add(label)
      }
    }
    out.push({
      deps: [...deps],
      mavenCoordinates: rec.coord,
      ruleKind: rec.ruleKind,
      ruleName: rec.ruleName,
      sourceRepo: provenance,
    })
  }
  return { artifacts: out, unresolvedLabels: [...unresolved] }
}

// Classify the runner's raw outcome. Non-zero exit with `--keep_going` is a
// `partial` (some target analysis failed; the successful subset is still in
// stdout). A clean exit with unresolved hub-prefixed edges is also `partial`
// — the graph is known-incomplete. Zero exit with no parsed artefacts is
// `empty`. Spawn timeout is signalled separately; this helper handles the
// post-spawn case.
function classifyCqueryOutcome(
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
      code?: unknown
      killed?: unknown
      signal?: unknown
      stderr?: unknown
      stdout?: unknown
    }
    const stdout = typeof err.stdout === 'string' ? err.stdout : ''
    const stderr = typeof err.stderr === 'string' ? err.stderr : ''
    // On a `timeout`, the registry spawn kills the child, so Node sets
    // `killed: true` and `signal: 'SIGTERM'` (or `SIGKILL`). There is no
    // `timedOut` flag on the real rejection, so do not test for one.
    const timedOut =
      err.killed === true ||
      err.signal === 'SIGTERM' ||
      err.signal === 'SIGKILL'
    const { artifacts, unresolvedLabels } = stdout
      ? parseCqueryJsonproto(stdout, repoName, workspaceRelPath)
      : { artifacts: [], unresolvedLabels: [] }
    // The registry `spawn` rejects on a non-zero exit, so a `--keep_going`
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
