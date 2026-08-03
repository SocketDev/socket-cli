/**
 * Jsonproto parser for the per-repo Maven metadata cquery.
 *
 * Parses the `--output=jsonproto` stream defensively: dispatches on
 * `attribute[].type` and accepts both camelCase (`stringValue`,
 * `stringListValue`) and snake_case (`string_value`, `string_list_value`)
 * payload keys. Extracts the maven coordinate from the direct
 * `maven_coordinates` attr when present, else scans `tags` for
 * `maven_coordinates=<G:A:V>`. Resolves each rule's
 * `deps`/`exports`/`runtime_deps` label edges into versionless Maven
 * coordinates against this repo's own targets while `repoName` is still in
 * scope; edges that point at a hub-prefixed target we cannot resolve are
 * reported as `unresolvedLabels` so the caller can flip the hub partial
 * rather than silently dropping graph edges.
 */

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

// Result of parsing one repo's cquery stream: the recovered artifacts (with
// resolved coordinate edges in `deps`) plus any hub-prefixed dep labels that
// could not be resolved.
export type ParseCqueryResult = {
  artifacts: ExtractedArtifact[]
  unresolvedLabels: string[]
}

// Maven coordinate tag entry: `maven_coordinates=<coordinate>`; the capture
// holds the coordinate itself.
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

// A coordinate-bearing rule recovered from the cquery stream, before its edge
// labels are resolved to coordinates.
export type RawArtifactRecord = {
  fullLabel: string
  coord: string
  ruleKind: string
  ruleName: string
  edgeLabels: string[]
}

export type LabelCoordIndex = {
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
export function buildLabelCoordIndex(
  records: RawArtifactRecord[],
): LabelCoordIndex {
  const fullLabels = new Map<string, string>()
  const suffixToCoords = new Map<string, Set<string>>()
  const hubPrefixes = new Set<string>()
  for (let i = 0, { length } = records; i < length; i += 1) {
    const rec = records[i]!
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

// Collect the union of `deps`/`exports`/`runtime_deps` label edges off a rule.
export function extractEdgeLabels(rule: JsonprotoRule): string[] {
  const labels: string[] = []
  const attrs = rule.attribute ?? []
  for (let i = 0, { length } = attrs; i < length; i += 1) {
    const attr = attrs[i]!
    if (attr.name && EDGE_ATTR_NAMES.has(attr.name)) {
      const list = readLabelListAttr(attr)
      if (list) {
        labels.push(...list)
      }
    }
  }
  return labels
}

// Extract the maven coordinate from a rule's attributes. Prefers the direct
// `maven_coordinates` attribute (Bazel-native shape); falls back to scanning
// `tags` for a `maven_coordinates=<G:A:V>` entry (rules_jvm_external shape).
// Returns undefined if neither yields a non-empty value.
export function extractMavenCoordinate(
  rule: JsonprotoRule,
): string | undefined {
  let coord: string | undefined
  const attrs = rule.attribute ?? []
  for (let i = 0, { length } = attrs; i < length; i += 1) {
    const attr = attrs[i]!
    if (attr.name === 'maven_coordinates') {
      const direct = readStringAttr(attr)
      if (direct?.length) {
        coord = direct
      }
    } else if (attr.name === 'tags') {
      const tags = readStringListAttr(attr)
      if (tags) {
        for (let j = 0, tagCount = tags.length; j < tagCount; j += 1) {
          const m = MAVEN_COORD_TAG_RE.exec(tags[j]!)
          if (m && !coord) {
            coord = m[1]
          }
        }
      }
    }
  }
  return coord
}

export function isHubPrefixed(
  label: string,
  hubPrefixes: Set<string>,
): boolean {
  for (const prefix of hubPrefixes) {
    if (label.startsWith(prefix)) {
      return true
    }
  }
  return false
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
      const { results } = parsed
      for (let i = 0, { length } = results; i < length; i += 1) {
        const target = results[i]!.target
        if (target) {
          targets.push(target)
        }
      }
    }
  } catch {
    // Fall through to per-line scanning.
  }
  if (!targets.length) {
    // Line separator tolerant of Windows CRLF output.
    const lines = stdout.split(/\r?\n/)
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const trimmed = lines[i]!.trim()
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
  const records: RawArtifactRecord[] = []
  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]!
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
  for (let i = 0, { length } = records; i < length; i += 1) {
    const rec = records[i]!
    const deps = new Set<string>()
    for (let j = 0, edgeCount = rec.edgeLabels.length; j < edgeCount; j += 1) {
      const label = rec.edgeLabels[j]!
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

// Reads a `LABEL_LIST` jsonproto attribute. Bazel serializes label lists into
// the same string-list payload (`stringListValue` / `string_list_value`) it
// uses for `STRING_LIST`, but tags the attribute `type: "LABEL_LIST"`. The
// `deps`/`exports`/`runtime_deps` edge attrs are LABEL_LIST, so a STRING_LIST
// reader would silently return nothing and leave the graph empty.
export function readLabelListAttr(
  attr: JsonprotoAttribute,
): string[] | undefined {
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

export type JsonprotoAttribute = {
  name?: string | undefined
  type?: string | undefined
  stringValue?: string | undefined
  string_value?: string | undefined
  stringListValue?: string[] | undefined
  string_list_value?: string[] | undefined
}

export type JsonprotoRule = {
  name?: string | undefined
  ruleClass?: string | undefined
  rule_class?: string | undefined
  attribute?: JsonprotoAttribute[] | undefined
}

export type JsonprotoTarget = {
  type?: string | undefined
  rule?: JsonprotoRule | undefined
}

export type JsonprotoEnvelope = {
  // Bazel 5+ wraps the stream in `{ "results": [ { "target": {...} } ] }`;
  // older shapes streamed one target per line. Accept either.
  results?: Array<{ target?: JsonprotoTarget | undefined }> | undefined
}

export function readStringAttr(attr: JsonprotoAttribute): string | undefined {
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

export function readStringListAttr(
  attr: JsonprotoAttribute,
): string[] | undefined {
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

// Recover the `@<repo>//` prefix from a fully-qualified target label, covering
// both apparent (`@maven//:foo`) and bzlmod-canonical
// (`@@rules_jvm_external++maven+maven//pkg:foo`) forms. Returns undefined for
// labels that aren't repo-qualified (e.g. `:src`).
export function repoPrefixOfLabel(label: string): string | undefined {
  if (!label.startsWith('@')) {
    return undefined
  }
  const sep = label.indexOf('//')
  if (sep < 0) {
    return undefined
  }
  return label.slice(0, sep + 2)
}

export type DepResolution =
  | { kind: 'coord'; coord: string }
  | { kind: 'unresolved' }
  | { kind: 'drop' }

// Resolve one dep label into a versionless coordinate. Classifies into three
// buckets. There is deliberately no "seen but coordinate-less" bucket — the
// cquery only selects coordinate-bearing targets.
//  - `coord`     — full-label match, unique-suffix fallback, or an already-a-
//                  coordinate `g:a:v` string label.
//  - `unresolved`— hub-prefixed but resolves to nothing in the selected set,
//                  a missing target or ambiguous suffix: a known-dropped edge.
//  - `drop`      — a non-maven target (`@platforms//…`, `:src`): intentional.
export function resolveDepLabel(
  label: string,
  index: LabelCoordIndex,
): DepResolution {
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
  // Already-a-coordinate fallback: a bare `g:a:v` string label that is not a
  // Bazel label. Versionless-normalize it. Exclude `//`-prefixed
  // package-relative labels (`//pkg:thing`) — those are Bazel targets, not
  // coordinates.
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

// Strip the leading `@<repo>//:` prefix from a fully-qualified target label
// to recover the bare rule name (e.g. `com_google_guava_guava`).
export function ruleNameFromLabel(label: string): string {
  const colon = label.lastIndexOf(':')
  return colon >= 0 ? label.slice(colon + 1) : label
}

// Strip the trailing version segment from a Maven coordinate, preserving any
// packaging/classifier segments. `g:a:v` -> `g:a`,
// `g:a:packaging:v` -> `g:a:packaging`,
// `g:a:packaging:classifier:v` -> `g:a:packaging:classifier`. Coordinates with
// fewer than 3 segments have no version to strip and are returned unchanged.
// This matches the server parser's `coordinateToParts` keying (position 3 =
// extension, position 4 = classifier on the versionless key), so
// AAR/classifier artifacts key correctly instead of being mis-keyed as bare
// `group:artifact` jars.
export function versionlessCoordinate(coord: string): string {
  const parts = coord.split(':')
  if (parts.length < 3) {
    return coord
  }
  return parts.slice(0, -1).join(':')
}
