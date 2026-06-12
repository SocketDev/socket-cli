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

// `indeterminate` means the probe could not be classified: an unrecognized
// non-zero exit, or the probe threw outright (the Bazel invocation itself
// failed). It is NOT evidence that the repo is undefined — treating it as
// `not-defined` would silently under-report a hub that may well hold Maven
// deps. The orchestrator must propagate it so the run is never reported
// `complete` when a probe was indeterminate.
export type ProbeStatus =
  | 'populated'
  | 'empty'
  | 'not-defined'
  | 'indeterminate'

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

// `bazel mod show_extension @rules_jvm_external//:extensions.bzl%maven`
// exits non-zero in two very different situations, and conflating them is
// dangerous for a security tool:
//
//   (a) `@rules_jvm_external` simply isn't in the root module's resolved
//       dependency graph. This is the COMMON case for any bzlmod repo that
//       doesn't use rules_jvm_external (no Maven at all). Bazel's ModCommand
//       resolves the extension argument up front via
//       `ExtensionArg.resolveToExtensionId`, which throws
//       `InvalidArgumentException` and exits non-zero before evaluating any
//       Starlark. This is NOT a failure to analyze; it is a positive,
//       authoritative "there is no maven extension here". It must map to
//       `not-defined` so the workspace cleanly contributes no Maven.
//
//   (b) The module graph genuinely fails to evaluate: a Starlark eval error,
//       an unbound name (e.g. a MODULE.bazel referencing `PYTHON_VERSION` /
//       `pip` before definition), a syntax error, or the bazel binary itself
//       being missing/spawn-failed (normalized to code -1). Here we have NO
//       evidence about whether a maven extension exists, so it must map to
//       `indeterminate` and the run can never be reported complete.
//
// We classify by stderr shape. The exact wording differs across Bazel
// versions; the regex families below are intentionally broad and SHOULD be
// confirmed against live `bazel mod show_extension` output.

// Family (a): the extension / module is not resolvable in the dependency
// graph — an argument-resolution error, not an evaluation failure. These all
// mean "rules_jvm_external (and thus the maven extension) is not present",
// i.e. legitimately not-defined. The `no module ... exists in the dependency
// graph` branch is Bazel's verified real wording (`bazel mod show_extension`
// against a bzlmod repo without rules_jvm_external: "No module with the
// apparent repo name @rules_jvm_external exists in the dependency graph").
const SHOW_EXT_NOT_IN_GRAPH_STDERR_RE =
  /(?:in extension argument|extension argument)?.*(?:not (?:found|resolvable|defined)|no such (?:module|repo(?:sitory)?)|cannot be resolved|is not (?:a )?(?:visible |known )?(?:module|repo(?:sitory)?|extension)|not in the (?:dependency )?graph|no module[^\n]*exists in the (?:dependency )?graph|unknown (?:module|extension)|does not (?:exist|use the extension))/i
// Bazel's canonical phrasing when the named module backing the extension
// (here `rules_jvm_external`) isn't a dependency of the root module.
const SHOW_EXT_MODULE_NOT_DEP_STDERR_RE =
  /(?:rules_jvm_external|module ['"`]?[A-Za-z0-9._+~-]+['"`]?).*(?:is not (?:a )?(?:direct )?dep(?:endenc(?:y|ies))?|not (?:a )?dependency)/i

// Family (b): a genuine evaluation / load failure of the module graph. These
// mean we could not determine whether a maven extension exists, so the result
// is indeterminate, never a clean not-defined.
const SHOW_EXT_EVAL_FAILURE_STDERR_RE =
  /(?:error (?:evaluating|loading|computing)|failed to (?:evaluate|load)|evaluation (?:of|failed)|cannot load|syntax error|name ['"`]?[A-Za-z0-9_]+['"`]? is not defined|variable ['"`]?[A-Za-z0-9_]+['"`]? (?:is|was) (?:referenced|not)|unbound|invalid MODULE\.bazel|MODULE\.bazel.*(?:error|failed)|Traceback|Error in)/i

// Outcome of running `bazel mod show_extension` for the maven extension,
// distinct from the per-repo `ProbeStatus`:
//   `not-defined`   — authoritative: no maven extension in this workspace
//                     (clean run with zero kept hubs, OR rules_jvm_external is
//                     not in the dependency graph).
//   `indeterminate` — enumeration could not be performed (eval/load failure,
//                     binary missing); the run must not be reported complete.
//   `defined`       — the report parsed and yielded one or more root hubs;
//                     the caller uses the parsed hub list directly.
export type ShowExtensionStatus = 'defined' | 'indeterminate' | 'not-defined'

// Classify a `bazel mod show_extension` result. `keptRootHubCount` is the
// number of root-imported hubs the caller parsed from a code-0 run (see
// `parseShowExtensionOutput` + the `<root>` importer filter); it disambiguates
// the code-0 cases without re-parsing here.
//
// IMPORTANT (security correctness): a non-zero exit is the DEFAULT outcome for
// every bzlmod repo that does not use rules_jvm_external, so we must NOT treat
// non-zero as indeterminate by default. We only escalate to `indeterminate`
// when stderr looks like a real evaluation/load failure; an argument/resolution
// error about the missing extension is the legitimate no-Maven case.
export function classifyShowExtensionResult(
  result: ProbeResult,
  keptRootHubCount: number,
): ShowExtensionStatus {
  if (result.code === 0) {
    // Clean run. Either it enumerated root hubs (`defined`) or it ran fine and
    // found no maven extension for the root (`not-defined`).
    return keptRootHubCount > 0 ? 'defined' : 'not-defined'
  }
  // A spawn failure / missing binary is normalized to code -1 upstream; there
  // is no usable stderr classification and we definitely could not enumerate.
  if (result.code === -1) {
    return 'indeterminate'
  }
  const { stderr } = result
  // A genuine module-graph evaluation/load failure wins: we cannot conclude
  // anything about maven presence, so surface it as indeterminate.
  if (SHOW_EXT_EVAL_FAILURE_STDERR_RE.test(stderr)) {
    return 'indeterminate'
  }
  // The maven extension / rules_jvm_external is simply not in the dependency
  // graph: an argument-resolution error. This is the common no-Maven bzlmod
  // repo and is authoritatively not-defined.
  if (
    SHOW_EXT_NOT_IN_GRAPH_STDERR_RE.test(stderr) ||
    SHOW_EXT_MODULE_NOT_DEP_STDERR_RE.test(stderr)
  ) {
    return 'not-defined'
  }
  // Truly unrecognized non-zero exit. Bias toward not-defined: the dominant
  // real-world non-zero case is "extension not in the graph", and a missing
  // bullet here would otherwise abort the user's entire scan. We only reach
  // `indeterminate` above when stderr positively looks like an eval/load
  // failure, which is the case the flag exists for.
  return 'not-defined'
}

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
  // name isn't declared. Treat as not-defined.
  if (result.code === 0) {
    return 'not-defined'
  }
  // Non-zero exit with no recognizable message: the probe failed for a reason
  // we can't classify (Bazel infra error, analysis crash, unexpected stderr).
  // This is NOT proof the repo is undefined, so do NOT downgrade it to
  // not-defined — surface it as indeterminate so the orchestrator can flag
  // the workspace as not fully analyzable rather than silently skipping it.
  return 'indeterminate'
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
    // A thrown probe means the Bazel invocation itself failed; we have no
    // evidence about whether the repo exists. Surface it as indeterminate so
    // the run is not reported complete, rather than swallowing it as a
    // not-defined skip.
    if (verbose) {
      logger.log(
        `[VERBOSE] discovery: probe @${repoName}: indeterminate (probe threw: ${
          e instanceof Error ? e.message : String(e)
        })`,
      )
    }
    return 'indeterminate'
  }
  const status = classifyProbeResult(result)
  if (verbose) {
    logger.log(`[VERBOSE] discovery: probe @${repoName}: ${status}`)
  }
  return status
}
