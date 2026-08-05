/*
 * @file Fleet policy (code-as-law): the canonical GitHub Actions allowlist
 *   (auditing-gha's CANONICAL_PATTERNS, the set --conform PUTs to every fleet
 *   repo's selected-actions settings) stays in LOCK-STEP with the actions the
 *   template's workflow surface actually references. Two directions:
 *   1. COVERAGE — every external `uses: owner/repo@ref` in the cascaded-
 *      everywhere surface (template/base workflows, .lock.yml included, plus
 *      the fleet composites' action.yml files) must match a canonical pattern.
 *      GitHub validates selected-actions at PLAN time, so a miss doesn't fail
 *      a step — it startup-fails the whole scheduled run with 0 jobs in every
 *      strict-allowlist repo. Incident, 2026-07-21: the gh-aw cascade added
 *      actions/create-github-app-token to weekly-update.lock.yml while the
 *      canonical list lacked the pattern; every strict repo's weekly-update
 *      cron plan-failed daily until a fix wave. Repo-local `./` uses are
 *      exempt by nature, and conditional/preset/override template layers are
 *      NOT held to coverage — their extra actions ride per-repo superset
 *      allowlist entries, like decmpfs's rust and docker set.
 *   2. NO DEAD ENTRIES — every canonical pattern must be referenced by at
 *      least one workflow or composite anywhere in the template tree, or
 *      carry a named external consumer in EXTERNALLY_CONSUMED_PATTERNS. The
 *      allowlist comment used to merely ASSERT this invariant while the list
 *      drifted both ways. Stale external declarations fail too.
 *   Template-source only: a cascaded member's own workflows may legitimately
 *   reference superset actions that live in its repo settings, which are not
 *   readable offline — the auditing-gha skill owns that audit. Pure
 *   filesystem parse, no network, so offline/CI never flakes.
 *   Usage: node scripts/fleet/check/gha-allowlist-matches-template-uses.mts.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  CANONICAL_PATTERNS,
  EXTERNALLY_CONSUMED_PATTERNS,
} from '../../../.claude/skills/fleet/auditing-gha/canonical-patterns.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// An action spec the allowlist governs: `owner/repo...` — two path segments
// before the optional subpath/@ref. Local `./` composites and reusable
// workflows, and `docker://` images, are not selected-actions material.
const ACTION_SPEC_RE = /^[\w.-]+\/[\w.-]+([/@]|$)/

/**
 * Every `uses:` value in a workflow/composite YAML text. Line-based on
 * purpose — a YAML parser would be a dep for what is a fixed `uses:` step-key
 * grammar. Comment lines are skipped; quotes and trailing ` # comments` are
 * stripped. Pure.
 */
export function extractUses(yamlText: string): string[] {
  const specs: string[] = []
  const lines = yamlText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/^\s*#/.test(line)) {
      continue
    }
    // Anchored `uses:` key line: leading indent, an optional `- ` list-item
    // dash, the literal `uses:` key, then the value captured to end-of-line.
    const m = /^\s*(?:-\s+)?uses:\s*(.+)$/.exec(line)
    if (!m) {
      continue
    }
    let value = m[1]!.trim()
    const quote = value.startsWith("'") ? "'" : value.startsWith('"') ? '"' : ''
    if (quote) {
      const end = value.indexOf(quote, 1)
      value = end > 0 ? value.slice(1, end) : value.slice(1)
    } else {
      value = value.split(/\s+#/)[0]!.trim()
    }
    if (value) {
      specs.push(value)
    }
  }
  return specs
}

// True when `spec` is governed by the selected-actions allowlist. `./` local
// composites/reusable workflows and `docker://` images are exempt by nature;
// anything else must look like `owner/repo...` to count — a malformed spec
// would fail GitHub's own workflow parse long before the allowlist applies.
export function isAllowlistGoverned(spec: string): boolean {
  if (spec.startsWith('./') || spec.startsWith('docker://')) {
    return false
  }
  return ACTION_SPEC_RE.test(spec)
}

/**
 * GitHub selected-actions pattern match: `*` is a wildcard over the whole
 * `owner/repo[/path]@ref` spec, everything else is literal, compared
 * case-insensitively — GitHub treats `Swatinem/…` and `swatinem/…` alike.
 * Pure.
 */
export function patternMatchesSpec(pattern: string, spec: string): boolean {
  const source = pattern
    .split('*')
    .map(part => part.replaceAll(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`))
    .join('.*')
  return new RegExp(`^${source}$`, 'i').test(spec)
}

/**
 * COVERAGE direction: the governed specs no canonical pattern matches —
 * each one plan-kills every strict-allowlist repo the file cascades to.
 * Sorted unique. Pure.
 */
export function findUncoveredUses(
  specs: readonly string[],
  patterns: readonly string[],
): string[] {
  const uncovered = new Set<string>()
  for (const spec of specs) {
    if (
      isAllowlistGoverned(spec) &&
      !patterns.some(p => patternMatchesSpec(p, spec))
    ) {
      uncovered.add(spec)
    }
  }
  return [...uncovered].toSorted()
}

export interface DeadEntryFindings {
  // Canonical patterns matching no template reference and carrying no
  // external-consumer declaration — allowlist weight with no consumer.
  dead: string[]
  // External-consumer declarations that no longer hold: the pattern is now
  // referenced by the template tree, or is no longer canonical.
  staleExternal: string[]
}

/**
 * NO DEAD ENTRIES direction plus the external-declaration hygiene that keeps
 * the escape hatch honest. Pure.
 */
export function findDeadEntries(
  patterns: readonly string[],
  specs: readonly string[],
  external: Readonly<Record<string, string>>,
): DeadEntryFindings {
  const governed = specs.filter(isAllowlistGoverned)
  const referenced = (pattern: string): boolean =>
    governed.some(spec => patternMatchesSpec(pattern, spec))
  const dead = patterns
    .filter(p => !(p in external) && !referenced(p))
    .toSorted()
  const staleExternal = Object.keys(external)
    .filter(p => !patterns.includes(p) || referenced(p))
    .toSorted()
  return { dead, staleExternal }
}

export interface TemplateSurface {
  // template/base workflows + composite action.yml files — cascaded to every
  // fleet repo, so canonical coverage is mandatory.
  coverage: string[]
  // The whole template tree's workflows + composites — any reference here
  // keeps a canonical entry alive.
  reference: string[]
}

function walkYamlFiles(root: string, out: string[]): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name)
    if (entry.isDirectory()) {
      walkYamlFiles(p, out)
    } else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
      out.push(p)
    }
  }
}

/**
 * Enumerate the template's workflow surface: every `.github/workflows/*.yml`
 * — gh-aw `.lock.yml` files included — and every `.github/actions/**`
 * action.yml across the template layers. Empty in a cascaded member, which
 * has no template/ tree.
 */
export function listTemplateSurface(repoRoot: string): TemplateSurface {
  const templateRoot = path.join(repoRoot, 'template')
  const baseRoot = path.join(templateRoot, 'base')
  if (!existsSync(baseRoot)) {
    return { coverage: [], reference: [] }
  }
  const yamlFiles: string[] = []
  walkYamlFiles(templateRoot, yamlFiles)
  const sep = path.sep
  const isSurface = (p: string): boolean =>
    p.includes(`${sep}.github${sep}workflows${sep}`) ||
    (p.includes(`${sep}.github${sep}actions${sep}`) &&
      /^action\.ya?ml$/.test(path.basename(p)))
  const reference = yamlFiles.filter(isSurface).toSorted()
  const basePrefix = baseRoot + sep
  const coverage = reference.filter(p => p.startsWith(basePrefix))
  return { coverage, reference }
}

const readSpecs = (files: readonly string[]): string[] =>
  files.flatMap(f => extractUses(readFileSync(f, 'utf8')))

/**
 * Fail the gate when a cascaded-surface `uses:` escapes the canonical
 * allowlist, or a canonical entry has no consumer anywhere — template tree or
 * declared external. Returns the exit code: 0 compliant or member no-op, 1
 * violation. `patterns`/`external` are injectable for tests; production runs
 * on the canonical set.
 */
export function runCheck(
  repoRoot: string,
  patterns: readonly string[] = CANONICAL_PATTERNS,
  external: Readonly<Record<string, string>> = EXTERNALLY_CONSUMED_PATTERNS,
): number {
  const surface = listTemplateSurface(repoRoot)
  // A cascaded member carries no template tree — its own workflows may ride
  // per-repo superset allowlist entries only the GitHub API can confirm, so
  // the offline gate is template-source-only by design.
  if (surface.reference.length === 0) {
    return 0
  }
  const problems: string[] = []
  for (const spec of findUncoveredUses(readSpecs(surface.coverage), patterns)) {
    problems.push(
      `${spec}: referenced by the cascaded template/base surface but matched by no canonical pattern — ` +
        'every strict-allowlist repo plan-fails at the next scheduled run. Add the pattern to ' +
        '.claude/skills/fleet/auditing-gha/canonical-patterns.mts and run the auditing-gha --conform ' +
        'pass across the fleet roster, or port the action to a .github/actions/fleet composite',
    )
  }
  const { dead, staleExternal } = findDeadEntries(
    patterns,
    readSpecs(surface.reference),
    external,
  )
  for (const p of dead) {
    problems.push(
      `${p}: canonical pattern with no consumer — nothing in the template tree references it and no ` +
        'external consumer is declared. Remove the entry, or declare its named consumer in ' +
        'EXTERNALLY_CONSUMED_PATTERNS in .claude/skills/fleet/auditing-gha/canonical-patterns.mts',
    )
  }
  for (const p of staleExternal) {
    problems.push(
      `${p}: stale EXTERNALLY_CONSUMED_PATTERNS declaration — the pattern is now referenced by the ` +
        'template tree or is no longer canonical. Drop the declaration so the escape hatch stays honest',
    )
  }
  if (problems.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[gha-allowlist-matches-template-uses] The canonical GH Actions allowlist and the template workflow surface disagree.',
      '',
      '  Fleet policy: every external `uses:` cascaded via template/base matches a canonical',
      '  selected-actions pattern — GitHub validates the allowlist at plan time, so a miss',
      '  startup-fails every strict-allowlist repo with 0 jobs — and every canonical pattern',
      '  has a live consumer, in-template or declared external. Offenders:',
      ...problems.map(p => `    - ${p}`),
      '',
    ].join('\n'),
  )
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'verifies the canonical GitHub Actions allowlist stays in lock-step with the template workflow uses',
  help: 'Usage: node scripts/fleet/check/gha-allowlist-matches-template-uses.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(() => runCheck(REPO_ROOT), SCRIPT_META)
}
