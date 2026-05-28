/**
 * Parse `bazel query --output=build` text and `unsorted_deps.json` files
 * (rules_jvm_external) into a uniform `ExtractedArtifact` shape consumed by
 * the converter.
 *
 * Security gate: every regex uses bounded character classes to prevent
 * catastrophic backtracking on hostile bazel-query output. Rules without
 * `maven_coordinates=` are skipped. Caller is responsible for size-capping
 * the input string.
 */

// `ruleKind` is the rule class the artifact came from. Legacy text-format
// parsers only emit 'jvm_import' / 'aar_import' (the kinds rules_jvm_external
// historically generated); the metadata cquery in bazel-cquery.mts emits
// whatever `ruleClass` jsonproto reports — `java_library`, `kt_jvm_import`,
// any future rules_jvm_external rule — so the type is open.
export type ExtractedArtifact = {
  ruleKind: string
  ruleName: string
  mavenCoordinates: string
  sourceRepo?: string | undefined
  mavenUrl?: string | undefined
  mavenSha256?: string | undefined
  deps: string[]
}

// Per-rule block matcher: matches `<kind>(...)` where kind is jvm_import or
// aar_import, bounded by `^)` (closing paren on its own line) — Bazel
// `--output=build` output convention. Body length capped at 8 KiB; real
// rules are ~500 bytes, so the cap is 16x normal. Prevents pathological
// backtracking on hostile input.
const RULE_RE = /^(jvm_import|aar_import)\(([\s\S]{0,8192}?)^\)/gm

// Cache for per-attribute regexes — avoids recompiling the same pattern on
// every rule block. Keyed by attr name; all attr names are safe alphanumeric
// identifiers so no escaping is needed beyond the bounded character class.
const ATTR_RE_CACHE = new Map<string, RegExp>()

// Cache for per-tag-key regexes used by extractTagValue.
const TAG_RE_CACHE = new Map<string, RegExp>()

function extractAttr(body: string, attr: string): string | undefined {
  // Match `<attr> = "VALUE"` — quoted-string attrs only.
  // Quoted value capped at 4 KiB; canonical Maven URLs are ~150 bytes.
  let re = ATTR_RE_CACHE.get(attr)
  if (!re) {
    re = new RegExp(`\\b${attr}\\s*=\\s*"([^"\\n]{0,4096})"`)
    ATTR_RE_CACHE.set(attr, re)
  }
  const m = re.exec(body)
  return m?.[1]
}

// Extracts a `key=value` pair from inside a Bazel `tags = [...]` attribute
// (rules_jvm_external encodes maven_sha256, maven_coordinates etc. this way).
// Pattern: `"maven_sha256=<hex>"` inside the tags list.
// Returns undefined when the tag is absent or malformed.
function extractTagValue(body: string, tagKey: string): string | undefined {
  // Match the full tags = [...] block (bounded at 8 KiB).
  const tagsM = /\btags\s*=\s*\[([\s\S]{0,8192}?)\]/m.exec(body)
  if (!tagsM) {
    return undefined
  }
  const tagsBlob = tagsM[1] as string
  // Within the blob, look for "<tagKey>=<value>" inside a quoted string.
  // Bounded at 512 bytes per tag entry (sha256 hex is 64 chars; URLs ~150).
  let tagRe = TAG_RE_CACHE.get(tagKey)
  if (!tagRe) {
    tagRe = new RegExp(`"${tagKey}=([^"\\n]{0,512})"`)
    TAG_RE_CACHE.set(tagKey, tagRe)
  }
  const m = tagRe.exec(tagsBlob)
  return m?.[1]
}

function extractDeps(body: string): string[] {
  // Match `deps = ["a", "b", ...]`. Body length capped at 16 KiB; real
  // dep lists are <2 KiB.
  const m = /\bdeps\s*=\s*\[([\s\S]{0,16384}?)\]/m.exec(body)
  if (!m) {
    return []
  }
  const out: string[] = []
  // Per-label cap at 512 bytes; real Bazel labels are <100 bytes.
  for (const q of (m[1] as string).matchAll(/"([^"\n]{0,512})"/g)) {
    out.push(q[1] as string)
  }
  return out
}

/**
 * Parse `bazel query --output=build` stdout into `ExtractedArtifact[]`.
 * Skips rules without a `maven_coordinates` attribute (those aren't
 * rules_jvm_external lockfile rules).
 */
export function parseBazelBuildOutput(text: string): ExtractedArtifact[] {
  const results: ExtractedArtifact[] = []
  for (const m of text.matchAll(RULE_RE)) {
    const ruleKind = m[1] as 'jvm_import' | 'aar_import'
    const body = m[2] as string
    const ruleName = extractAttr(body, 'name')
    // maven_coordinates can be:
    //   (a) a top-level rule attribute: `maven_coordinates = "g:a:v"` (newer rje)
    //   (b) inside tags = [...]: `"maven_coordinates=g:a:v"` (older rje, e.g. ray)
    const coords =
      extractAttr(body, 'maven_coordinates') ??
      extractTagValue(body, 'maven_coordinates')
    if (!ruleName || !coords) {
      continue
    }
    // maven_sha256 is encoded inside tags = [...] as "maven_sha256=<hex>" by
    // rules_jvm_external; try tags first, fall back to standalone attr for
    // older rule shapes that may declare it as a top-level attribute.
    const mavenSha256 =
      extractTagValue(body, 'maven_sha256') ?? extractAttr(body, 'maven_sha256')
    results.push({
      ruleKind,
      ruleName,
      mavenCoordinates: coords,
      mavenUrl: extractAttr(body, 'maven_url'),
      mavenSha256,
      deps: extractDeps(body),
    })
  }
  return results
}

type LegacyUnsortedDepsArtifact = {
  coordinates?: string
  url?: string
  sha256?: string
  deps?: unknown
}

type V2LockArtifact = {
  shasums?: Record<string, string | undefined>
  version?: string
}

function ruleNameFromCoordinate(c: string): string {
  return c.replace(/[^A-Za-z0-9]/g, '_')
}

/**
 * Parse supported `external/<repo>/unsorted_deps.json` shapes emitted by
 * rules_jvm_external. Older files use an artifact array with full coordinates;
 * newer v2 lock-file-shaped files use artifact/dependency maps keyed by
 * `group:artifact`. Caller MUST size-cap the input because JSON.parse is
 * unbounded by default.
 */
export function parseUnsortedDepsJson(json: string): ExtractedArtifact[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }

  const maybe = parsed as {
    artifacts?: LegacyUnsortedDepsArtifact[] | Record<string, V2LockArtifact>
    dependencies?: Record<string, string[]>
  }

  if (Array.isArray(maybe.artifacts)) {
    const out: ExtractedArtifact[] = []
    for (const a of maybe.artifacts) {
      if (typeof a?.coordinates !== 'string') {
        continue
      }
      const deps: string[] = []
      if (Array.isArray(a.deps)) {
        for (const d of a.deps) {
          if (typeof d === 'string') {
            deps.push(d)
          }
        }
      }
      out.push({
        ruleKind: 'jvm_import',
        ruleName: ruleNameFromCoordinate(a.coordinates),
        mavenCoordinates: a.coordinates,
        mavenUrl: typeof a.url === 'string' ? a.url : undefined,
        mavenSha256: typeof a.sha256 === 'string' ? a.sha256 : undefined,
        deps,
      })
    }
    return out
  }

  if (!maybe.artifacts || typeof maybe.artifacts !== 'object') {
    return []
  }

  const dependencies = maybe.dependencies ?? {}
  const out: ExtractedArtifact[] = []
  for (const [groupArtifact, artifact] of Object.entries(maybe.artifacts)) {
    if (!artifact || typeof artifact.version !== 'string') {
      continue
    }
    const shasums = artifact.shasums ?? {}
    const jarSha = shasums['jar']
    if (typeof jarSha === 'string' || Object.keys(shasums).length === 0) {
      out.push(
        v2Artifact(groupArtifact, artifact.version, jarSha, dependencies),
      )
    }
    for (const [classifier, sha256] of Object.entries(shasums)) {
      if (classifier === 'jar' || typeof sha256 !== 'string') {
        continue
      }
      const classifierKey = `${groupArtifact}:jar:${classifier}`
      out.push(
        v2Artifact(classifierKey, artifact.version, sha256, dependencies),
      )
    }
  }
  return out
}

function v2Artifact(
  artifactKey: string,
  version: string,
  sha256: string | undefined,
  dependencies: Record<string, string[]>,
): ExtractedArtifact {
  return {
    ruleKind: 'jvm_import',
    ruleName: ruleNameFromCoordinate(artifactKey),
    mavenCoordinates: `${artifactKey}:${version}`,
    mavenSha256: sha256,
    deps: Array.isArray(dependencies[artifactKey])
      ? dependencies[artifactKey].filter(
          (d): d is string => typeof d === 'string',
        )
      : [],
  }
}
