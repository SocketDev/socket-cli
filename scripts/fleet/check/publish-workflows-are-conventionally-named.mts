#!/usr/bin/env node
/*
 * @file Fleet-wide check: a GitHub Actions workflow that does recognizable
 *   registry-publish work must carry the `<target>-publish[-<variant>].yml`
 *   filename, bind the matching `<target>-publish` GitHub environment on its
 *   publish job, and mint an OIDC token (`id-token: write`). The fleet
 *   publishes through a fixed workflow-file vocabulary that npm's / crates.io's
 *   trusted-publisher config PINS BY FILENAME:
 *
 *     npm-publish.yml     → an npm registry publish   (environment: npm-publish)
 *     cargo-publish.yml   → a `cargo publish`         (environment: cargo-publish)
 *     go-publish.yml      → a Go module tag-push publish (environment: go-publish)
 *
 *   A `-<variant>` suffix is allowed for a second same-target publisher in one
 *   repo (`npm-publish-cli-exe.yml` stages a bespoke second npm artifact); the
 *   environment + OIDC rules still apply.
 *
 *   The check is BODY-DRIVEN, not name-guessing: it classifies each workflow's
 *   body to the registry it actually publishes to (`npm publish` / `pnpm
 *   publish` / `npm-publish.mts` / `publish-pipeline.mts` / `cargo publish` /
 *   `cargo-publish.mts` / `go-publish.mts`), then fails when:
 *
 *     - FILENAME     — a publishing body lives under a non-conventional name
 *                      (`provenance.yml`, `publish-npm.yml`, a bare
 *                      `publish.yml`) instead of `<target>-publish[-variant].yml`.
 *                      This is the drift that hid socket-cli's live npm
 *                      publisher under `provenance.yml`.
 *     - ENVIRONMENT  — the publish job does not bind the `<target>-publish`
 *                      GitHub environment (the human-approval + trusted-
 *                      publisher gate; the OIDC exchange is scoped to it).
 *     - OIDC         — the workflow never grants `id-token: write`, so npm /
 *                      crates.io trusted publishing can't mint its short-lived
 *                      token and a long-lived registry secret is implied.
 *
 *   A workflow whose body does NO recognizable registry-publish work is ignored
 *   here (a `github-release.yml`, a CI workflow). Reusable `workflow_call`
 *   publishers that delegate the environment via an input surface as an
 *   ENVIRONMENT finding under their, already non-conventional, filename — which
 *   is the intended signal to retire them.
 *
 *   INFORMATIONAL for now (exit 0, lists findings): the fleet is mid-migration
 *   off the legacy `provenance.yml` / `publish-npm.yml` shapes. Pure
 *   classification (`classifyPublishWorkflow`) is exported for unit tests; the
 *   scan/report is the thin CLI shell. Flip MODE to 'strict' (exit 1) once the
 *   fleet backlog clears — the twin `release-publish-scripts-are-conventionally-
 *   named.mts` (package.json script names) is already enforcing.
 *
 *   Usage: node scripts/fleet/check/publish-workflows-are-conventionally-named.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'
import { extractRunLines } from './publish-workflows-are-staged-fail-closed.mts'

const logger = getDefaultLogger()

// Report-only until the fleet clears the legacy provenance.yml / publish-npm.yml
// backlog; flip to 'strict' (exit 1) after. Mirrors the report→strict rollout
// of the other publish-surface gates, published-packages-have-files-field, etc.
const MODE: 'report' | 'strict' = 'report'

export type PublishTarget = 'npm' | 'cargo' | 'go'

// Body → target patterns. Each entry maps a registry target to the regexes that
// identify that target's publish work in a workflow BODY. Ordered so
// classification is deterministic; a body matching more than one target is an
// ambiguous combined orchestration and is skipped, not this check's concern.
const TARGET_SIGNATURES: ReadonlyArray<{
  readonly target: PublishTarget
  readonly patterns: readonly RegExp[]
}> = [
  {
    target: 'npm',
    // require-regex-comment: a body running a DIRECT npm publish step —
    // `npm/pnpm/yarn publish`, `pnpm stage publish`, or the canonical
    // npm-publish.mts engine. Deliberately NOT publish-pipeline.mts: that is the
    // reconcile/orchestration engine invoked by the canonical release-reconcile.yml
    // a gap-backfill workflow, not a primary publisher, so matching it would
    // false-flag release-reconcile.yml as drift.
    patterns: [
      /\b(?:npm|pnpm|yarn)\s+publish\b/,
      /\bpnpm\s+stage\s+publish\b/,
      /\bnpm-publish\.mts\b/,
    ],
  },
  {
    target: 'cargo',
    // require-regex-comment: a body running `cargo publish` or invoking the
    // canonical cargo-publish.mts engine.
    patterns: [/\bcargo\s+publish\b/, /\bcargo-publish\.mts\b/],
  },
  {
    target: 'go',
    // require-regex-comment: a body invoking the canonical go-publish.mts engine
    // (Go has no `go publish` command — a module publishes by pushing a tag).
    patterns: [/\bgo-publish\.mts\b/],
  },
]

export interface PublishWorkflowVerdict {
  readonly target: PublishTarget
  readonly expectedEnvironment: string
  readonly filenameOk: boolean
  readonly environmentOk: boolean
  readonly oidcOk: boolean
  readonly ok: boolean
  readonly issues: readonly string[]
}

/**
 * The environment name a workflow binds, if any. Reads the FIRST `environment:`
 * key (job-level) as either a bare string or the object form (`environment:\n
 * name: <x>`), and tolerates the conditional expression form
 * (`environment: ${{ ... 'npm-publish' ... }}`) by scanning the value for a
 * `<target>-publish` token. Returns undefined when no environment is bound.
 * Pure — a deliberately thin regex read, not a YAML parse (mirrors the
 * body-driven style of the sibling checks).
 */
export function extractsEnvironment(
  body: string,
  expectedEnvironment: string,
): boolean {
  // Bare or expression form on the same line: `environment: <value>`.
  const inline = body.match(/^\s*environment:\s*(.+)$/m)
  if (inline?.[1]?.includes(expectedEnvironment)) {
    return true
  }
  // Object form: `environment:` then a `name:` child.
  const objForm = body.match(/^\s*environment:\s*\n\s*name:\s*(.+)$/m)
  if (objForm?.[1]?.includes(expectedEnvironment)) {
    return true
  }
  return false
}

/**
 * Classify one workflow (filename + body) against the publish-workflow
 * convention. Returns the verdict when the body performs recognizable
 * registry-publish work for exactly one target, or null when the body does no
 * such work, or is ambiguously multi-target. Pure so it is unit-tested without
 * a filesystem.
 */
export function classifyPublishWorkflow(
  fileName: string,
  body: string,
): PublishWorkflowVerdict | null {
  const trimmed = body.trim()
  if (!trimmed) {
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- external API contract: the unit test suite asserts strict equality against this exact `null` return value
    return null
  }
  const matched = TARGET_SIGNATURES.filter(sig =>
    sig.patterns.some(re => re.test(trimmed)),
  )
  // No target, or an ambiguous combined body → not this check's concern.
  if (matched.length !== 1) {
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- external API contract: the unit test suite asserts strict equality against this exact `null` return value
    return null
  }
  const { target } = matched[0]!
  // A workflow whose EVERY publish invocation carries `--dry-run` validates
  // the release path without ever uploading — it is not a publisher, and
  // requiring it to bind the publish environment / mint an OIDC token would
  // hand a token to a job that must never have one. Least privilege wins over
  // pattern-matching the command name. Scanned over `run:` content only: the
  // workflow's own `name:` can say "npm publish" without running one.
  const invocationLines = extractRunLines(trimmed)
    .map(runLine => runLine.text)
    .filter(text =>
      TARGET_SIGNATURES.some(sig => sig.patterns.some(re => re.test(text))),
    )
  if (
    invocationLines.length > 0 &&
    invocationLines.every(line => /--dry-run\b/.test(line))
  ) {
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- external API contract: the unit test suite asserts strict equality against this exact `null` return value
    return null
  }
  const expectedEnvironment = `${target}-publish`
  const base = path.basename(fileName)
  // `<target>-publish.yml` or `<target>-publish-<variant>.yml`.
  const nameRe = new RegExp(
    `^${target}-publish(?:-[a-z0-9-]+)?\\.(?:yml|yaml)$`,
  )
  const filenameOk = nameRe.test(base)
  const environmentOk = extractsEnvironment(trimmed, expectedEnvironment)
  const oidcOk = /\bid-token:\s*write\b/.test(trimmed)
  const issues: string[] = []
  if (!filenameOk) {
    issues.push(
      `filename "${base}" should match ${expectedEnvironment}[-<variant>].yml`,
    )
  }
  if (!environmentOk) {
    issues.push(`publish job should bind environment: ${expectedEnvironment}`)
  }
  if (!oidcOk) {
    issues.push(
      'workflow should grant id-token: write (OIDC trusted publishing)',
    )
  }
  return {
    target,
    expectedEnvironment,
    filenameOk,
    environmentOk,
    oidcOk,
    ok: filenameOk && environmentOk && oidcOk,
    issues,
  }
}

export interface PublishWorkflowFinding {
  readonly file: string
  readonly target: PublishTarget
  readonly issues: readonly string[]
}

export async function scanRepo(
  repoRoot: string,
): Promise<PublishWorkflowFinding[]> {
  const workflows = await collectTrackedFiles(
    ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
    { cwd: repoRoot },
  )
  const findings: PublishWorkflowFinding[] = []
  for (const rel of workflows) {
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      continue
    }
    let body: string
    try {
      body = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const verdict = classifyPublishWorkflow(rel, body)
    if (verdict && !verdict.ok) {
      findings.push({
        file: rel,
        target: verdict.target,
        issues: verdict.issues,
      })
    }
  }
  return findings
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet')
  const findings = await scanRepo(REPO_ROOT)
  if (!findings.length) {
    if (!quiet) {
      logger.success(
        '[publish-workflows-are-conventionally-named] publish workflows follow ' +
          'the <target>-publish[-variant].yml + environment + OIDC convention.',
      )
    }
    return 0
  }
  const strict = MODE === 'strict'
  const report = strict ? logger.fail : logger.warn
  report.call(
    logger,
    `[publish-workflows-are-conventionally-named] ${findings.length} ` +
      `publish workflow(s) drift from the <target>-publish convention` +
      (strict ? ':' : ' (report-only):'),
  )
  logger.group()
  for (const f of findings) {
    report.call(logger, `${f.file}  [${f.target}]`)
    logger.group()
    for (const issue of f.issues) {
      report.call(logger, issue)
    }
    logger.groupEnd()
  }
  logger.groupEnd()
  logger.log(
    'Fix: rename the workflow to <target>-publish[-variant].yml, bind the ' +
      '<target>-publish environment on the publish job, and grant id-token: ' +
      'write. Trusted-publisher config pins the filename — reconfigure the ' +
      'registry entry in lock-step with any rename.',
  )
  if (strict) {
    process.exitCode = 1
    return 1
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  void main()
}
