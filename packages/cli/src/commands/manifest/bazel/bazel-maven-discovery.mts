/**
 * Per-workspace Maven hub candidate discovery for the Bazel extractor.
 *
 * Bzlmod mode: trust `bazel mod show_extension` as the authoritative hub
 * list, keeping only hubs imported by <root>.
 *
 * WORKSPACE mode: no equivalent of `show_extension`, so probe the
 * conventional hub names.
 *
 * On `show_extension` failure (or a parse that yields zero root hubs) under
 * Bzlmod, fall through to the conventional-name probe so partial discovery
 * is still possible.
 */
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  buildMavenProbeFor,
  runBazelModShowMavenExtension,
} from './bazel-query-runner.mts'
import {
  classifyShowExtensionResult,
  CONVENTIONAL_MAVEN_REPO_NAMES,
  parseShowExtensionOutput,
  probeCandidate,
  ROOT_MODULE_IMPORTER,
} from './bazel-repo-discovery.mts'

import type { BazelQueryOptions } from './bazel-query-runner.mts'
import type { WorkspaceMode } from './bazel-workspace-detect.mts'

const logger = getDefaultLogger()

export type DiscoverResult = {
  candidates: string[]
  // Conventional names whose probe could not be classified (threw or returned
  // an unrecognized error). A non-empty list means discovery may have missed
  // a hub, so the run can never be reported complete.
  indeterminateProbes: string[]
  // True when authoritative hub enumeration could not be performed: under
  // Bzlmod, `bazel mod show_extension` failed in a way that signals the module
  // graph itself could not be evaluated (Starlark eval error, unbound name,
  // syntax error, or the binary being missing). That is distinct from BOTH a
  // clean code-0 run with zero kept hubs AND a non-zero exit that merely means
  // rules_jvm_external isn't in the dependency graph — those are legitimate
  // "no maven extension here" outcomes (the common no-Maven bzlmod repo) and
  // must NOT flip the run to indeterminate. Only a genuine evaluation failure
  // means we may have missed custom-named hubs, so the run can never be
  // reported complete. See `classifyShowExtensionResult`.
  discoveryIndeterminate: boolean
}

// Build the per-workspace candidate Maven hub list.
export async function discoverCandidatesForWorkspace(
  workspaceRoot: string,
  mode: WorkspaceMode,
  queryOpts: BazelQueryOptions,
  options?: { verbose?: boolean | undefined } | undefined,
): Promise<DiscoverResult> {
  const { verbose } = { __proto__: null, ...options } as {
    verbose?: boolean | undefined
  }
  const candidates: string[] = []
  const indeterminateProbes: string[] = []
  let showExtensionSucceeded = false
  let discoveryIndeterminate = false
  if (mode.bzlmod) {
    const extResult = await runBazelModShowMavenExtension(queryOpts)
    // The maven extension generates a hub for EVERY module that uses it — the
    // root's own `maven.install` hub(s) plus the rulesets' internal hubs
    // (rules_jvm_external_deps, stardoc_maven, …). Keep only hubs imported by
    // <root>; the rest are build-tooling, not the user's SBOM. On a non-zero
    // exit the output is empty, so `kept` is naturally empty too.
    const entries = parseShowExtensionOutput(extResult.stdout)
    const kept = entries.filter(e => e.importers.includes(ROOT_MODULE_IMPORTER))
    // Classify the run rather than treating ANY non-zero exit as a failure:
    // `bazel mod show_extension` exits non-zero on every bzlmod repo that
    // doesn't depend on rules_jvm_external (its argument resolution throws
    // before any Starlark runs), so a blanket non-zero=indeterminate would
    // wrongly flag the common no-Maven repo and abort the user's whole scan.
    const showExtStatus = classifyShowExtensionResult(extResult, kept.length)
    if (showExtStatus === 'defined') {
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
        for (let i = 0, { length } = entries; i < length; i += 1) {
          const dropped = entries[i]!
          if (!dropped.importers.includes(ROOT_MODULE_IMPORTER)) {
            logger.log(
              `[VERBOSE] workspace ${workspaceRoot}: dropped ${dropped.name} — imported by ${dropped.importers.join(', ')}, not ${ROOT_MODULE_IMPORTER}`,
            )
          }
        }
      }
    } else if (showExtStatus === 'indeterminate') {
      // The module graph itself could not be evaluated (Starlark eval error,
      // unbound name, syntax error, or a missing binary normalized to code
      // -1). We have NO evidence about whether custom-named maven hubs exist,
      // so mark discovery indeterminate — the run can never be reported
      // complete — while still falling through to the conventional probe for
      // best-effort coverage.
      discoveryIndeterminate = true
      if (verbose) {
        logger.log(
          `[VERBOSE] workspace ${workspaceRoot}: show_extension failed to evaluate the module graph (code=${extResult.code}); hub enumeration is indeterminate — falling back to conventional probe`,
        )
      }
    } else if (verbose) {
      // `not-defined`: either a clean run with no root maven extension, or a
      // non-zero exit that merely means rules_jvm_external isn't in the
      // dependency graph. Both are authoritative "no maven here"; we still
      // probe conventional names for a hybrid WORKSPACE-maven repo.
      logger.log(
        `[VERBOSE] workspace ${workspaceRoot}: show_extension reports no root maven extension (code=${extResult.code}); treating as not-defined — probing conventional hub names`,
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
    return { candidates, discoveryIndeterminate, indeterminateProbes }
  }
  const probe = buildMavenProbeFor(queryOpts)
  for (let i = 0, { length } = toProbe; i < length; i += 1) {
    const name = toProbe[i]!
    const status = await probeCandidate(name, probe, { verbose })
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
  return { candidates, discoveryIndeterminate, indeterminateProbes }
}
