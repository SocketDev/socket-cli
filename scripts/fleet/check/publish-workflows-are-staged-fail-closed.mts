#!/usr/bin/env node
/*
 * @file Fleet-wide check: a GitHub Actions workflow that publishes to the npm
 *   registry must publish STAGED, fail CLOSED, and — when it also cuts the
 *   release markers — cut the markers FIRST.
 *
 *     - STAGED        — every literal npm-family publish invocation is a
 *                       staged upload (`pnpm stage publish`). A bare
 *                       `npm publish` / `pnpm publish` / `yarn publish` goes
 *                       straight to public: the per-package trusted-publisher
 *                       grants allow "stage publish" only, so the direct form
 *                       dies at the OIDC token exchange — and it skips the
 *                       stage → verify → approve promotion gate. Delegation to
 *                       a fleet publish script (npm-publish.mts,
 *                       publish-pipeline.mts, stage-publish-*.mts) passes:
 *                       those stage by contract.
 *     - FAIL-CLOSED   — `continue-on-error` is forbidden anywhere in a
 *                       publishing workflow. A tolerated publish failure makes
 *                       a 1-of-N release look green — the shape that left
 *                       @socketsecurity/cli 45 versions behind on the
 *                       socket-cli v1.x line while its two siblings shipped.
 *     - MARKERS-FIRST — when the SAME workflow creates the v<version> tag or
 *                       the GitHub release, those steps come BEFORE the first
 *                       publish invocation, so the staged upload's provenance
 *                       binds markers that exist. Markers are cut ONCE per
 *                       run and belong to the release subject (socket-cli:
 *                       the `socket` package) — variants sharing the version
 *                       never get a tag or release of their own. The trade
 *                       is deliberate and
 *                       is the fleet's burn rule: a stage rejected after the
 *                       markers BURNS that version — the next release is a
 *                       patch bump, never a re-publish of the burned number
 *                       (the tag step's different-SHA hard-fail is the
 *                       ratchet).
 *
 *   A workflow with no npm-family publish work is ignored (CI, release-only,
 *   cargo/go publishers). STRICT: any finding exits 1. Pure classification
 *   (`auditPublishWorkflowBody`) is exported for unit tests; the scan/report
 *   is the thin CLI shell.
 *
 *   Usage: node scripts/fleet/check/publish-workflows-are-staged-fail-closed.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'

const logger = getDefaultLogger()

// A literal direct-to-public npm-family publish. `pnpm stage publish` never
// matches: the `stage` token sits between `pnpm` and `publish`, and `\b`
// cannot fire inside the `pnpm` of a `pnpm-` or `npm-publish` compound.
const DIRECT_PUBLISH_RE = /\b(?:npm|pnpm|yarn)\s+publish\b/

// A staged upload (`pnpm stage publish`, or a bare `stage publish` leg in a
// composed command line).
const STAGED_PUBLISH_RE = /\bstage\s+publish\b/

// Delegation to a fleet publish script that stages by contract:
// npm-publish.mts defaults to --staged, publish-pipeline.mts's stage-publish
// leg dispatches it, and stage-publish-*.mts scripts are staged by name.
const SCRIPT_DELEGATION_RE =
  /\b(?:npm-publish|publish-pipeline|stage-publish[\w-]*)\.mts\b/

// Release-marker creation inside workflow YAML: the tag-ref POST and the
// GitHub release cut.
const MARKER_RE = /\bgh release create\b|ref=refs\/tags\//

// `continue-on-error:` as a YAML key at any indentation.
const CONTINUE_ON_ERROR_RE = /^\s*continue-on-error\s*:/

export interface StagedFailClosedFinding {
  file: string
  issues: string[]
}

export interface RunLine {
  lineNo: number
  text: string
}

/**
 * Extract the shell content of every `run:` step — the inline form
 * (`run: <command>`) and the block-scalar forms (`run: |`, `run: >-`), whose
 * content is every following line indented deeper than the `run` key. Only
 * these lines carry commands; workflow names, descriptions, and input labels
 * that merely SAY "npm publish" never reach the classifier.
 */
export function extractRunLines(body: string): RunLine[] {
  const lines = body.split('\n')
  const out: RunLine[] = []
  let blockIndent = -1
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    if (blockIndent >= 0) {
      if (!raw.trim()) {
        continue
      }
      const indent = raw.length - raw.trimStart().length
      if (indent > blockIndent) {
        out.push({ lineNo: i + 1, text: raw })
        continue
      }
      blockIndent = -1
    }
    // Breakdown: `^(\s*(?:-\s+)?)` captures the key's leading indentation
    // plus an optional `- ` list-item dash (the capture's length is the
    // block-scalar indent threshold); `run\s*:` is the step key; `\s*(.*)$`
    // captures the inline command or the `|` / `>` block-scalar marker.
    const keyMatch = /^(\s*(?:-\s+)?)run\s*:\s*(.*)$/.exec(raw)
    if (keyMatch) {
      const rest = (keyMatch[2] ?? '').trim()
      if (rest.startsWith('|') || rest.startsWith('>')) {
        blockIndent = (keyMatch[1] ?? '').length
      } else if (rest) {
        out.push({ lineNo: i + 1, text: rest })
      }
    }
  }
  return out
}

/**
 * Audit one workflow body against the staged / fail-closed / markers-first
 * doctrine. Returns the issue list — empty for a compliant publisher AND for
 * a workflow that does no npm-family publish work at all. Classification runs
 * over `run:` script content only, with shell comment tails stripped, so a
 * workflow name or a commented-out example never counts.
 */
export function auditPublishWorkflowBody(body: string): string[] {
  const lines = body.split('\n')
  const issues: string[] = []
  let firstPublishLine = -1
  let firstMarkerLine = -1
  const directLines: number[] = []
  const runLines = extractRunLines(body)
  for (let i = 0, { length } = runLines; i < length; i += 1) {
    const runLine = runLines[i]
    if (!runLine) {
      continue
    }
    const line = runLine.text.replace(/#.*$/, '')
    const staged = STAGED_PUBLISH_RE.test(line)
    const delegated = SCRIPT_DELEGATION_RE.test(line)
    const direct = !staged && DIRECT_PUBLISH_RE.test(line)
    if ((delegated || direct || staged) && firstPublishLine === -1) {
      firstPublishLine = runLine.lineNo
    }
    if (direct) {
      directLines.push(runLine.lineNo)
    }
    if (firstMarkerLine === -1 && MARKER_RE.test(line)) {
      firstMarkerLine = runLine.lineNo
    }
  }
  if (firstPublishLine === -1) {
    return []
  }
  for (let i = 0, { length } = directLines; i < length; i += 1) {
    issues.push(
      `DIRECT (line ${directLines[i]}) — a bare npm-family publish goes ` +
        `straight to public and the stage-only trusted-publisher grant ` +
        `rejects it; use \`pnpm stage publish\` or delegate to npm-publish.mts.`,
    )
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').replace(/#.*$/, '')
    if (CONTINUE_ON_ERROR_RE.test(line)) {
      issues.push(
        `FAIL-OPEN (line ${i + 1}) — continue-on-error in a publish workflow ` +
          `lets a 1-of-N release look green; a failed publish must fail the ` +
          `job.`,
      )
    }
  }
  if (firstMarkerLine !== -1 && firstMarkerLine > firstPublishLine) {
    issues.push(
      `ORDER (marker at line ${firstMarkerLine}, first publish at line ` +
        `${firstPublishLine}) — cut the v<version> tag + GitHub release ` +
        `BEFORE the first upload so provenance binds real markers; a stage ` +
        `rejected after the markers burns the version (patch-bump forward, ` +
        `never re-publish).`,
    )
  }
  return issues
}

export async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet')
  const workflows = await collectTrackedFiles(
    ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
    { cwd: REPO_ROOT },
  )
  const findings: StagedFailClosedFinding[] = []
  for (const rel of workflows) {
    const body = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    const issues = auditPublishWorkflowBody(body)
    if (issues.length) {
      findings.push({ file: rel, issues })
    }
  }
  if (!findings.length) {
    if (!quiet) {
      logger.success(
        '[publish-workflows-are-staged-fail-closed] publish workflows stage ' +
          'their uploads, hard-fail on error, and cut markers first.',
      )
    }
    return 0
  }
  logger.fail(
    `[publish-workflows-are-staged-fail-closed] ${findings.length} publish ` +
      'workflow(s) violate the staged / fail-closed / markers-first doctrine:',
  )
  logger.group()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]
    if (!finding) {
      continue
    }
    logger.fail(finding.file)
    logger.group()
    for (let j = 0, jLength = finding.issues.length; j < jLength; j += 1) {
      logger.fail(finding.issues[j] ?? '')
    }
    logger.groupEnd()
  }
  logger.groupEnd()
  logger.log(
    'Fix: stage the upload (`pnpm stage publish` or npm-publish.mts), drop ' +
      'continue-on-error, and cut the tag + release before the first upload. ' +
      'A version whose stage was rejected after the markers is burned — bump ' +
      'a patch and ship forward.',
  )
  process.exitCode = 1
  return 1
}

if (isMainModule(import.meta.url)) {
  void main()
}
