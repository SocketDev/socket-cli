#!/usr/bin/env node
/*
 * @file `check --all` gate (fail-closed): every workflow job that runs a
 *   VERSION-DERIVATION leg checks out with the `v*` tags reachable.
 *
 *   The bump engine anchors the next version on registry-latest PLUS the last
 *   reachable `v<semver>` tag (scripts/fleet/lib/release-anchor.mts resolves it
 *   with `git describe --tags` + `git tag -l` — LOCAL refs, not the remote).
 *   On a repo whose npm name has never been published the registry read comes
 *   back empty, so the tags are the ONLY anchor. `actions/checkout` at
 *   `fetch-depth: 1` carries no tags, so the engine derives from zero, proposes
 *   0.1.0, and then trips the half-applied-bump gate against the historical
 *   CHANGELOG sections that already describe shipped versions — a red publish
 *   run with a misleading message. The fix is `fetch-tags: true` on the
 *   publish checkout, which restores the version anchor and lets the engine
 *   derive the true next patch.
 *
 *   That fix was one line in one cascade-owned file with fleet-wide blast
 *   radius, protected by nothing but a comment. This gate is the protection.
 *
 *   IN SCOPE — a job is a derivation job when a non-comment line in its body
 *   invokes a DERIVATION_ENTRIES script (in the mode that reaches the bump
 *   engine). Tag reachability is asserted per JOB, not per checkout step: git
 *   tags accumulate in `.git`, so ONE tags-carrying checkout anywhere in the
 *   job satisfies every later step.
 *
 *   OUT OF SCOPE, by evidence, not by omission — a job that reads tags from
 *   the REMOTE (`git ls-remote --tags`, as release-reconcile's `gap` job does)
 *   needs no local tags, and a job that only resolves a tag name from the event
 *   payload (github-release.yml's resolve-release-tag.mjs) never touches the
 *   anchor at all. Neither invokes a derivation entry, so neither is flagged.
 *
 *   Dual-root in the wheelhouse (a `template/` tree exists): the template
 *   workflow roots are scanned alongside the live ones, so a workflow authored
 *   in the template is gated the moment it is written rather than one cascade
 *   later. On a cascaded member only the live `.github/workflows` is scanned.
 *   Absent workflow dir, or a member with no npm-publish.yml (a pure-crates
 *   repo), is a clean no-op — never a failure.
 *
 *   Pure filesystem parse, no network, so offline/CI never flakes.
 *   Usage: node scripts/fleet/check/version-derivation-jobs-have-tags.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * A fleet script whose run reaches the release anchor, and therefore needs the
 * local `v*` tags present in the checkout.
 */
export interface DerivationEntry {
  // Repo-relative script path as it appears in a workflow `run:` command.
  readonly script: string
  // When set, the entry only derives in this mode — the job body must also
  // carry the flag. `cargo-publish.mts --direct` publishes an already-bumped
  // crate and never calls runBump, so the flag keeps the gate honest.
  readonly flag?: string | undefined
  // Why this entry needs tags, quoted in the failure message.
  readonly why: string
}

// The scripts that reach scripts/fleet/lib/release-anchor.mts at runtime.
// bump.mts imports it directly; npm-publish.mts --bump and cargo-publish.mts
// --bump spawn/call the bump engine; publish-pipeline.mts orchestrates the bump
// + release stages and its release leg reads the existing v* tags.
export const DERIVATION_ENTRIES: readonly DerivationEntry[] = [
  {
    script: 'scripts/fleet/bump.mts',
    why: 'bump.mts anchors on the last reachable v-tag (lib/release-anchor.mts)',
  },
  {
    flag: '--bump',
    script: 'scripts/fleet/npm-publish.mts',
    why: 'npm-publish.mts --bump runs the bump engine, which anchors on the last reachable v-tag',
  },
  {
    flag: '--bump',
    script: 'scripts/fleet/cargo-publish.mts',
    why: 'cargo-publish.mts --bump runs the cargo bump engine, which anchors on the last reachable v-tag',
  },
  {
    script: 'scripts/fleet/publish-pipeline.mts',
    why: 'publish-pipeline.mts drives the bump + release stages, which read the existing v* tags',
  },
]

// `fetch-tags: true` on an actions/checkout `with:` block — quoted or bare.
// Matches the key line only; the value must be exactly true.
const FETCH_TAGS_TRUE_RE = /^\s*fetch-tags:\s*['"]?true['"]?\s*(?:#.*)?$/

// `fetch-depth: 0`, full history, which carries tags, on either the third-party
// action's `with:` block or the fleet composites' `checkout-fetch-depth:` input.
const FETCH_DEPTH_ZERO_RE =
  /^\s*(?:checkout-)?fetch-depth:\s*['"]?0['"]?\s*(?:#.*)?$/

// An inline `git fetch … --tags` bootstrap (the shape a job's FIRST step uses
// when no local composite is resolvable yet). `--no-tags` is the opposite and
// must not count, so it is excluded by the caller.
const GIT_FETCH_TAGS_RE = /\bgit\b[^\n]*\bfetch\b[^\n]*--tags\b/

// A mapping key at some indent: `<indent><name>:` with nothing but an optional
// comment after it. Used to find `jobs:` and each job id.
const MAPPING_KEY_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_-]*):\s*(?:#.*)?$/

/**
 * One job's body, sliced out of a workflow file. Line numbers are 1-based.
 */
export interface WorkflowJob {
  readonly id: string
  readonly lines: readonly string[]
  // 1-based line number of the job's key line.
  readonly startLine: number
}

/**
 * A derivation job that checks out without tags reachable.
 */
export interface TagViolation {
  readonly entry: DerivationEntry
  // 1-based line number of the invocation that makes this a derivation job.
  readonly entryLine: number
  readonly jobId: string
  // Repo-relative, forward-slashed path of the workflow.
  readonly relPath: string
  // The checkout inputs actually seen in the job, for the saw-vs-wanted line.
  readonly saw: readonly string[]
}

/**
 * True when the line is blank or a whole-line YAML comment.
 */
function isSkippableLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length === 0 || trimmed.startsWith('#')
}

/**
 * Count of leading spaces, treating a tab as one column.
 */
function indentOf(line: string): number {
  let i = 0
  while (i < line.length && (line[i] === '\t' || line[i] === ' ')) {
    i += 1
  }
  return i
}

/**
 * Slice a workflow's YAML text into its top-level jobs. Line-based on purpose:
 * a YAML parser would be a dependency for what is a fixed two-level
 * `jobs:` → `<job-id>:` grammar, and the rest of the fleet's workflow gates
 * parse the same way. Pure.
 */
export function splitJobs(yamlText: string): WorkflowJob[] {
  const lines = yamlText.split('\n')
  const jobs: WorkflowJob[] = []
  let jobsIndent = -1
  let jobIndent = -1
  let current: { id: string; lines: string[]; startLine: number } | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (jobsIndent < 0) {
      const m = MAPPING_KEY_RE.exec(line)
      if (m && m[2] === 'jobs') {
        jobsIndent = m[1]!.length
      }
      continue
    }
    if (isSkippableLine(line)) {
      current?.lines.push(line)
      continue
    }
    const indent = indentOf(line)
    if (indent <= jobsIndent) {
      // Dedented back out of the `jobs:` block — done.
      break
    }
    if (jobIndent < 0) {
      jobIndent = indent
    }
    const keyMatch = MAPPING_KEY_RE.exec(line)
    if (keyMatch && keyMatch[1]!.length === jobIndent) {
      if (current) {
        jobs.push(current)
      }
      current = { id: keyMatch[2]!, lines: [], startLine: i + 1 }
      continue
    }
    current?.lines.push(line)
  }
  if (current) {
    jobs.push(current)
  }
  return jobs
}

/**
 * The derivation entry a job invokes, with the 1-based line of the invocation,
 * or `undefined` when the job runs no derivation leg. Whole-line comments are
 * ignored so a prose mention of `--bump` never makes a job in scope. The flag,
 * when an entry requires one, is looked for anywhere in the job body — the
 * workflow may build it into a shell array a line above the invocation. Pure.
 */
export function findDerivationEntry(
  job: WorkflowJob,
): { entry: DerivationEntry; line: number } | undefined {
  const code: Array<{ line: number; text: string }> = []
  for (let i = 0, { length } = job.lines; i < length; i += 1) {
    const text = job.lines[i]!
    if (!isSkippableLine(text)) {
      code.push({ line: job.startLine + i + 1, text })
    }
  }
  for (let e = 0, { length: elen } = DERIVATION_ENTRIES; e < elen; e += 1) {
    const entry = DERIVATION_ENTRIES[e]!
    const hit = code.find(c => c.text.includes(entry.script))
    if (!hit) {
      continue
    }
    if (entry.flag && !code.some(c => c.text.includes(entry.flag!))) {
      continue
    }
    return { entry, line: hit.line }
  }
  return undefined
}

/**
 * Every checkout input in the job that bears on tag reachability, as the
 * trimmed source line. Empty when the job configures none. Pure.
 */
export function checkoutSignals(job: WorkflowJob): string[] {
  const signals: string[] = []
  for (let i = 0, { length } = job.lines; i < length; i += 1) {
    const line = job.lines[i]!
    if (isSkippableLine(line)) {
      continue
    }
    if (
      /^\s*(?:checkout-)?fetch-depth:/.test(line) ||
      /^\s*fetch-tags:/.test(line) ||
      GIT_FETCH_TAGS_RE.test(line) ||
      /--no-tags\b/.test(line)
    ) {
      signals.push(line.trim())
    }
  }
  return signals
}

/**
 * True when some step in the job checks out with the `v*` tags reachable:
 * `fetch-tags: true`, a full-history `fetch-depth: 0`, which carries tags, or
 * an inline `git fetch … --tags` bootstrap. Per-JOB, because tags fetched by an
 * earlier step stay in `.git` for every later one. Pure.
 */
export function hasReachableTags(job: WorkflowJob): boolean {
  for (let i = 0, { length } = job.lines; i < length; i += 1) {
    const line = job.lines[i]!
    if (isSkippableLine(line)) {
      continue
    }
    if (FETCH_TAGS_TRUE_RE.test(line) || FETCH_DEPTH_ZERO_RE.test(line)) {
      return true
    }
    if (GIT_FETCH_TAGS_RE.test(line) && !/--no-tags\b/.test(line)) {
      return true
    }
  }
  return false
}

/**
 * Every derivation job in one workflow file that lacks reachable tags. Pure.
 */
export function scanWorkflowText(
  relPath: string,
  yamlText: string,
): TagViolation[] {
  const violations: TagViolation[] = []
  const jobs = splitJobs(yamlText)
  for (let i = 0, { length } = jobs; i < length; i += 1) {
    const job = jobs[i]!
    const hit = findDerivationEntry(job)
    if (!hit || hasReachableTags(job)) {
      continue
    }
    violations.push({
      entry: hit.entry,
      entryLine: hit.line,
      jobId: job.id,
      relPath: normalizePath(relPath),
      saw: checkoutSignals(job),
    })
  }
  return violations
}

// Directory names under `template/` that hold per-slice overlays, each with its
// own `<slice>/.github/workflows`.
const TEMPLATE_OVERLAY_ROOTS = ['conditional', 'optional', 'overrides']

/**
 * Immediate subdirectory names of `root`, or none when the root is absent.
 */
function subdirNames(root: string): string[] {
  if (!existsSync(root)) {
    return []
  }
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .toSorted()
}

/**
 * Repo-relative workflow dirs to scan: the live `.github/workflows`, plus every
 * template workflow root when this repo is the wheelhouse (a `template/` tree
 * exists). Only dirs that exist are returned. Pure filesystem.
 */
export function listWorkflowDirs(repoRoot: string): string[] {
  const candidates = [path.join('.github', 'workflows')]
  const templateRoot = path.join(repoRoot, 'template')
  if (existsSync(templateRoot)) {
    const layers = ['base', 'presets']
    for (let i = 0, { length } = TEMPLATE_OVERLAY_ROOTS; i < length; i += 1) {
      const group = TEMPLATE_OVERLAY_ROOTS[i]!
      const slices = subdirNames(path.join(templateRoot, group))
      for (let s = 0, { length: slen } = slices; s < slen; s += 1) {
        layers.push(path.join(group, slices[s]!))
      }
    }
    for (let i = 0, { length } = layers; i < length; i += 1) {
      candidates.push(path.join('template', layers[i]!, '.github', 'workflows'))
    }
  }
  return candidates.filter(rel => existsSync(path.join(repoRoot, rel)))
}

/**
 * Every derivation job across the repo's workflow roots that lacks tags.
 */
export function scanWorkflows(repoRoot: string): TagViolation[] {
  const violations: TagViolation[] = []
  const dirs = listWorkflowDirs(repoRoot)
  for (let d = 0, { length: dlen } = dirs; d < dlen; d += 1) {
    const dir = dirs[d]!
    const files = readdirSync(path.join(repoRoot, dir), { withFileTypes: true })
      .filter(
        entry =>
          entry.isFile() &&
          (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')),
      )
      .map(entry => entry.name)
      .toSorted()
    for (let f = 0, { length: flen } = files; f < flen; f += 1) {
      const rel = path.join(dir, files[f]!)
      const text = readFileSync(path.join(repoRoot, rel), 'utf8')
      violations.push(...scanWorkflowText(rel, text))
    }
  }
  return violations
}

/**
 * The four-part (what / where / saw vs wanted / fix) report for one finding.
 */
export function formatViolation(violation: TagViolation): string[] {
  const saw = violation.saw.length
    ? violation.saw.join(' | ')
    : 'no fetch-depth / fetch-tags input at all (actions/checkout defaults to a tagless depth-1 clone)'
  return [
    `  ✗ ${violation.relPath} — job \`${violation.jobId}\` runs a version-derivation leg with no tags in the checkout.`,
    `      Where: ${violation.relPath}:${violation.entryLine} (${violation.entry.script})`,
    `      Saw:    ${saw}`,
    `      Wanted: \`fetch-tags: true\` (or \`fetch-depth: 0\` / \`checkout-fetch-depth: '0'\`, which also carry tags) on a checkout step in this job.`,
    `      Why:    ${violation.entry.why}. On a repo whose package has never been published the registry read is empty, so the tags are the ONLY anchor — a tagless checkout makes the engine derive from ZERO (0.1.0) and then trip the half-applied-bump gate against the historical CHANGELOG sections (decmpfs run 30226873755).`,
    `      Fix:    add \`fetch-tags: true\` under the checkout step's \`with:\` in job \`${violation.jobId}\`. Edit the canonical copy under \`template/\` and re-run the dogfood cascade — never the live copy.`,
  ]
}

function main(): void {
  const violations = scanWorkflows(REPO_ROOT)
  if (violations.length) {
    logger.fail(
      [
        '[version-derivation-jobs-have-tags] version-derivation jobs check out without the v* tags:',
        '',
        ...violations.flatMap(formatViolation),
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[version-derivation-jobs-have-tags] every version-derivation job checks out with the v* tags reachable.',
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every workflow job running a version-derivation leg checks out with the v* tags reachable',
  help: `Usage: node scripts/fleet/check/version-derivation-jobs-have-tags.mts [flags]

  --quiet  suppress the clean-pass message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
