#!/usr/bin/env node
/**
 * @file Edit-one-edit-all gate for the inline git-fetch bootstrap. The
 *   bootstrap — git init + a non-persisting auth-header fetch + checkout
 *   FETCH_HEAD — is intentionally TRI-PLICATED: the fleet checkout composite
 *   action carries the parameterized form, and release-reconcile.yml +
 *   prune-workflow-runs.yml each carry a fixed depth-1 copy in their FIRST
 *   step, which runs before any checkout exists and therefore cannot `uses:` a
 *   local composite. No copy can be extracted, so this gate holds the three in
 *   lock-step instead: it slices each copy out by its stable markers — `git
 *   init -q` through `git checkout -q --detach FETCH_HEAD` — normalizes
 *   incidental whitespace and full-line comments, collapses the one region
 *   that legitimately differs per site — the fetch-args setup between `git
 *   remote add origin` and the token-conditional — and fails when the shared
 *   shape drifts. The two first-step workflow copies additionally have NO
 *   legitimate divergence, so they must match line-for-line. Scans the live
 *   tree and the cascaded source under template/base/. Exit 0 = every present
 *   copy in lock-step. Exit 1 = drift or a copy whose markers vanished. Usage:
 *   node scripts/fleet/check/git-fetch-bootstraps-are-lock-stepped.mts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export const START_MARKER = 'git init -q'
export const END_MARKER = 'git checkout -q --detach FETCH_HEAD'
export const FETCH_ARGS_PLACEHOLDER = '<site-specific fetch-args setup>'

// The anchors bounding the only region that legitimately differs per site:
// ref selection + fetch-depth live between re-pointing origin and the
// token-conditional auth fetch.
const COLLAPSE_FROM_PREFIX = 'git remote add origin '
const COLLAPSE_UNTIL_LINE = 'if [ -n "${GITHUB_TOKEN}" ]; then'

export type BootstrapFamily = 'composite-action' | 'workflow-bootstrap'

export interface BootstrapSiteSpec {
  readonly family: BootstrapFamily
  readonly relPath: string
}

// The composite action is the canonical copy — listed first so it is the
// drift reference; the two workflow bootstraps are its first-step twins.
export const BOOTSTRAP_SITES: readonly BootstrapSiteSpec[] = [
  {
    family: 'composite-action',
    relPath: '.github/actions/fleet/checkout/action.yml',
  },
  {
    family: 'workflow-bootstrap',
    relPath: '.github/workflows/release-reconcile.yml',
  },
  {
    family: 'workflow-bootstrap',
    relPath: '.github/workflows/prune-workflow-runs.yml',
  },
]

export interface ExtractedBootstrap {
  readonly family: BootstrapFamily
  /**
   * Marker-sliced block, trimmed, blank + full-line-comment lines dropped.
   */
  readonly lines: readonly string[]
  readonly relPath: string
}

export interface BootstrapDriftIssue {
  readonly detail: string
  readonly relPath: string
}

/**
 * Slice the bootstrap block out of a file body by its stable markers. Lines
 * are trimmed so YAML indentation is incidental; blank lines and full-line
 * `#` comments are dropped. Undefined when either marker is absent or appears
 * more than once — an ambiguous or rewritten bootstrap must fail loudly, not
 * silently pass.
 */
export function extractBootstrapBlock(
  fileText: string,
): readonly string[] | undefined {
  const trimmed = fileText.split('\n').map(l => l.trim())
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0, { length } = trimmed; i < length; i += 1) {
    if (trimmed[i] === START_MARKER) {
      starts.push(i)
    } else if (trimmed[i] === END_MARKER) {
      ends.push(i)
    }
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0]! < starts[0]!) {
    return undefined
  }
  return trimmed
    .slice(starts[0]!, ends[0]! + 1)
    .filter(l => l !== '' && !l.startsWith('#'))
}

/**
 * Collapse the site-specific fetch-args setup — everything between the
 * `git remote add origin` line and the token-conditional — into a single
 * placeholder line. What remains is the shared shape every copy must match.
 * Returns the lines unchanged when the anchors are missing or inverted; the
 * shape comparison then flags the divergence itself.
 */
export function collapseFetchArgsSetup(lines: readonly string[]): string[] {
  const from = lines.findIndex(l => l.startsWith(COLLAPSE_FROM_PREFIX))
  const until = lines.findIndex(l => l === COLLAPSE_UNTIL_LINE)
  if (from === -1 || until === -1 || until <= from) {
    return [...lines]
  }
  return [
    ...lines.slice(0, from + 1),
    FETCH_ARGS_PLACEHOLDER,
    ...lines.slice(until),
  ]
}

// First index at which two line sequences differ, for a saw-vs-wanted detail.
function firstMismatch(
  a: readonly string[],
  b: readonly string[],
): { saw: string; wanted: string } {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) {
      return { saw: a[i] ?? '<absent line>', wanted: b[i] ?? '<absent line>' }
    }
  }
  return { saw: '<identical>', wanted: '<identical>' }
}

/**
 * Pure drift detector over the extracted copies. Two tiers:
 *
 * 1. Cross-family: every copy's COLLAPSED shape must match the first copy — the
 *    composite action, when present — since ref/depth parameterization is the
 *    only sanctioned divergence.
 * 2. Within the workflow-bootstrap family: the FULL normalized blocks must match
 *    line-for-line — the two first-step copies carry no legitimate divergence
 *    at all.
 */
export function findBootstrapDrift(
  blocks: readonly ExtractedBootstrap[],
): BootstrapDriftIssue[] {
  const issues: BootstrapDriftIssue[] = []
  if (blocks.length < 2) {
    return issues
  }
  const ref = blocks[0]!
  const refShape = collapseFetchArgsSetup(ref.lines)
  for (let i = 1, { length } = blocks; i < length; i += 1) {
    const block = blocks[i]!
    const shape = collapseFetchArgsSetup(block.lines)
    if (shape.join('\n') !== refShape.join('\n')) {
      const { saw, wanted } = firstMismatch(shape, refShape)
      issues.push({
        detail:
          `shared git-fetch shape drifted from ${ref.relPath}\n` +
          `      saw:    ${saw}\n` +
          `      wanted: ${wanted}`,
        relPath: block.relPath,
      })
    }
  }
  const workflows = blocks.filter(b => b.family === 'workflow-bootstrap')
  if (workflows.length >= 2) {
    const wRef = workflows[0]!
    for (let i = 1, { length } = workflows; i < length; i += 1) {
      const block = workflows[i]!
      if (block.lines.join('\n') !== wRef.lines.join('\n')) {
        const { saw, wanted } = firstMismatch(block.lines, wRef.lines)
        issues.push({
          detail:
            `first-step bootstrap drifted from ${wRef.relPath} — the ` +
            `workflow copies carry no legitimate divergence\n` +
            `      saw:    ${saw}\n` +
            `      wanted: ${wanted}`,
          relPath: block.relPath,
        })
      }
    }
  }
  return issues
}

// The site roots to scan: the live tree and the cascaded source. Members
// receive only the live tree; the template root simply won't exist there.
function siteRoots(repoRoot: string): string[] {
  return [repoRoot, path.join(repoRoot, 'template', 'base')]
}

export function runCheck(repoRoot: string): number {
  const blocks: ExtractedBootstrap[] = []
  const markerless: string[] = []
  const roots = siteRoots(repoRoot)
  for (let r = 0, rootCount = roots.length; r < rootCount; r += 1) {
    const root = roots[r]!
    for (let i = 0, { length } = BOOTSTRAP_SITES; i < length; i += 1) {
      const site = BOOTSTRAP_SITES[i]!
      const full = path.join(root, site.relPath)
      if (!existsSync(full)) {
        continue
      }
      const relPath = path.relative(repoRoot, full)
      const lines = extractBootstrapBlock(readFileSync(full, 'utf8'))
      if (lines === undefined) {
        markerless.push(relPath)
      } else {
        blocks.push({ family: site.family, lines, relPath })
      }
    }
  }
  const issues = findBootstrapDrift(blocks)
  if (markerless.length === 0 && issues.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[git-fetch-bootstraps-are-lock-stepped] The inline git-fetch bootstrap has drifted.',
      '',
      '  The bootstrap is intentionally TRI-PLICATED — the two workflow copies run',
      "  as their job's FIRST step, before any checkout exists, so they cannot",
      '  `uses:` the local composite. Every copy must stay in lock-step:',
      '',
      '    .github/actions/fleet/checkout/action.yml   — the composite "Checkout code" step',
      '    .github/workflows/release-reconcile.yml     — first-step "Bootstrap checkout"',
      '    .github/workflows/prune-workflow-runs.yml   — first-step "Bootstrap checkout"',
      '',
      ...(markerless.length
        ? [
            '  Copies whose stable markers vanished — `git init -q` … `git checkout -q',
            '  --detach FETCH_HEAD` must appear exactly once each:',
            '',
            ...markerless.map(p => `    ${p}`),
            '',
          ]
        : []),
      ...(issues.length
        ? [
            '  Drifted copies:',
            '',
            ...issues.map(i => `    ${i.relPath}: ${i.detail}`),
            '',
          ]
        : []),
      '  Fix: edit one, edit all — apply the same change to every copy, in',
      '  template/base/ first, then re-cascade. Or move the canonical copy to a',
      '  surface all three sites can consume and delete the inline duplicates.',
      '',
    ].join('\n'),
  )
  return 1
}

export function main(): void {
  process.exitCode = runCheck(REPO_ROOT)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'verifies the triplicated inline git-fetch bootstrap copies stay in lock-step',
  help: 'Usage: node scripts/fleet/check/git-fetch-bootstraps-are-lock-stepped.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
