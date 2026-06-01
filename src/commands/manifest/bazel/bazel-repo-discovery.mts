/**
 * Maven hub repo discovery for `socket manifest bazel`.
 *
 * - Bzlmod path: `bazel mod show_extension @rules_jvm_external//:extensions.bzl%maven`
 *   emits a text-format report listing every repo the maven extension generated;
 *   `parseShowExtensionOutput` extracts the names of hub repos (items annotated
 *   with `(imported by ...)`) and skips generated per-artifact repos.
 * - Legacy WORKSPACE path: probe a fixed list of conventional Maven hub names.
 *   Each probe is classified into `populated` / `empty` / `not-defined`; the
 *   orchestrator keeps only the `populated` candidates.
 *
 * No Starlark source is read by this module. All semantic interpretation
 * comes from Bazel itself (`mod show_extension`, `cquery`).
 */
import { logger } from '@socketsecurity/registry/lib/logger'

// The importer token Bazel prints for a hub generated for the root module
// itself (`(imported by <root>, …)`). Hubs imported only by rulesets
// (`rules_jvm_external@6.7`, `stardoc@0.7.2`, …) are build-tooling, not the
// user's SBOM, and are filtered out by the orchestrator.
export const ROOT_MODULE_IMPORTER = '<root>'

// One hub repo from a `bazel mod show_extension` report: its name plus the
// modules that imported it (the `(imported by …)` annotation), merged across
// every line the repo appears on.
export type ShowExtensionRepo = {
  name: string
  importers: string[]
}

export type ProbeResult = {
  code: number
  stdout: string
  stderr: string
}

export type RepoProbe = (repoName: string) => Promise<ProbeResult>

export type ProbeStatus = 'populated' | 'empty' | 'not-defined'

// Conventional Maven hub names rules_jvm_external sets up under
// WORKSPACE-mode invocations. Probing each one is cheap (a failed visibility
// lookup never triggers a `repository_rule` fetch) so the orchestrator can
// try them all without paying the cost of a real cquery on undefined repos.
export const CONVENTIONAL_MAVEN_REPO_NAMES: readonly string[] = [
  'maven',
  'maven_install',
  'maven_dev',
  'unpinned_maven',
  'maven_unpinned',
]

// Pattern Bazel emits when a probed repo name isn't visible to the main
// module. Used to distinguish `not-defined` (skip silently) from `empty`
// (the repo exists but has no targets). Tolerant of either single- or
// double-quote styles Bazel has used across versions.
const NOT_VISIBLE_STDERR_RE =
  /No repository visible as ['"]?@?[A-Za-z0-9._+-]+['"]? from/
// Other "repo isn't analyzable" patterns Bazel emits, especially under
// WORKSPACE mode and on Bazel 6.x. They all map to `not-defined`.
const NO_SUCH_PACKAGE_STDERR_RE = /no such package ['"`]?@/
// Pattern emitted when a repo IS visible / defined but yields no targets.
// `--keep_going` plus `'no targets found beneath'` is the empty-but-defined
// signature. The orchestrator treats `empty` and `not-defined` uniformly
// as skips.
const NO_TARGETS_STDERR_RE = /no targets found beneath/i
// Anchor for the maven extension's section header in
// `bazel mod show_extension` output. Tolerant of the canonical-name form
// Bazel uses across versions (`@@rules_jvm_external+`, `@@rules_jvm_external~`,
// or any future separator) and of trailing trailing whitespace.
const SHOW_EXT_SECTION_HEADER_RE =
  /^## @@?[A-Za-z0-9._+~-]+\/\/:extensions\.bzl%maven:\s*$/m
// Bullet within `Fetched repositories:` that names a hub repo (one with an
// `(imported by ...)` annotation). Bullets without that annotation are
// generated per-artifact repos and are skipped.
const FETCHED_HUB_BULLET_RE =
  /^ {2}- (?<name>\S+) \(imported by (?<importers>[^)]+)\)\s*$/

// Pure parser for `bazel mod show_extension @rules_jvm_external//:extensions.bzl%maven`
// stdout. Returns the hub repos listed under `Fetched repositories:` — i.e.
// items annotated with `(imported by ...)` — each carrying the set of modules
// that imported it. Generated per-artifact repos (no annotation) are skipped.
// A repo can legitimately appear on multiple lines with different importers,
// so importers are merged per repo (name-only dedupe would lose that, and the
// importers data is what lets the orchestrator keep only root-imported hubs).
// Output is sorted by name. Tolerant of `DEBUG:` / `WARNING:` lines from
// Bazel; the section header `## @@<canonical>//:extensions.bzl%maven:` is the
// anchor.
export function parseShowExtensionOutput(stdout: string): ShowExtensionRepo[] {
  const headerMatch = SHOW_EXT_SECTION_HEADER_RE.exec(stdout)
  if (!headerMatch) {
    return []
  }
  const tail = stdout.slice(headerMatch.index + headerMatch[0].length)
  // Find the `Fetched repositories:` line within the section.
  const fetchedIdx = tail.indexOf('\nFetched repositories:')
  if (fetchedIdx === -1) {
    return []
  }
  const afterFetched = tail.slice(fetchedIdx + '\nFetched repositories:'.length)
  const importersByName = new Map<string, Set<string>>()
  for (const line of afterFetched.split(/\r?\n/)) {
    // Stop at the next `## ` section header (some Bazel versions print
    // multiple extensions in one report).
    if (line.startsWith('## ')) {
      break
    }
    // Empty line is fine; bullet that doesn't match is fine (it's an
    // un-imported generated artifact repo) — skip it.
    const match = FETCHED_HUB_BULLET_RE.exec(line)
    if (!match || !match.groups) {
      continue
    }
    const name = match.groups['name']
    if (!name) {
      continue
    }
    const importers = importersByName.get(name) ?? new Set<string>()
    for (const importer of (match.groups['importers'] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)) {
      importers.add(importer)
    }
    importersByName.set(name, importers)
  }
  return [...importersByName.keys()].sort().map(name => ({
    importers: [...importersByName.get(name)!].sort(),
    name,
  }))
}

// Classify a raw probe result into one of three states. The probe contract
// is whatever the runner emits — typically a lightweight
// `cquery '@<name>//...' --keep_going --output=label`. The orchestrator
// treats `empty` and `not-defined` uniformly as no-ops; the distinction
// is preserved for verbose-mode diagnostics.
export function classifyProbeResult(result: ProbeResult): ProbeStatus {
  // A successful probe with any stdout means the repo exists AND has at
  // least one target — populated.
  if (result.code === 0 && result.stdout.trim().length > 0) {
    return 'populated'
  }
  // Code 1 with the "no repository visible" message → undefined.
  if (
    result.code !== 0 &&
    (NOT_VISIBLE_STDERR_RE.test(result.stderr) ||
      NO_SUCH_PACKAGE_STDERR_RE.test(result.stderr))
  ) {
    return 'not-defined'
  }
  // Code 1 with the "no targets" message → defined but empty.
  if (result.code !== 0 && NO_TARGETS_STDERR_RE.test(result.stderr)) {
    return 'empty'
  }
  // Code 0 with empty stdout: WORKSPACE-mode probes do this when the repo
  // name isn't declared (Exp 5c). Treat as not-defined.
  if (result.code === 0) {
    return 'not-defined'
  }
  // Code 1 with no recognizable message: be conservative and call it
  // not-defined so the orchestrator skips it without erroring the workspace.
  return 'not-defined'
}

// Convenience: probe a single candidate and return its classified status,
// with optional verbose logging. Pure orchestration around `probe` +
// `classifyProbeResult`; isolated so the test suite can exercise the
// logging contract independently of the runner implementation.
export async function probeCandidate(
  repoName: string,
  probe: RepoProbe,
  verbose?: boolean,
): Promise<ProbeStatus> {
  let result: ProbeResult
  try {
    result = await probe(repoName)
  } catch (e) {
    if (verbose) {
      logger.log(
        `[VERBOSE] discovery: probe @${repoName}: not-defined (probe threw: ${
          e instanceof Error ? e.message : String(e)
        })`,
      )
    }
    return 'not-defined'
  }
  const status = classifyProbeResult(result)
  if (verbose) {
    logger.log(`[VERBOSE] discovery: probe @${repoName}: ${status}`)
  }
  return status
}
