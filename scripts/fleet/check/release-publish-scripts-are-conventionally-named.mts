#!/usr/bin/env node
/*
 * @file Fleet-wide check: a `package.json` script that does recognizable
 *   release or publish work must carry the `<target>:<verb>` convention name.
 *   The fleet cuts releases and publishes packages through a fixed vocabulary:
 *
 *     github:release  → an immutable GitHub release (release-pipeline.mts, or
 *                       the wheelhouse's bespoke github-release.mts)
 *     npm:publish     → an npm registry publish (publish-pipeline.mts /
 *                       npm-publish.mts)
 *     cargo:publish   → `cargo publish`
 *     go:publish      → a Go module tag-push publish (go-publish.mts)
 *     python:publish  → `uv publish` / `twine upload`
 *
 *   The check is BODY-DRIVEN, not name-guessing: it classifies each script's
 *   body to the release/publish target it actually performs, then fails when
 *   the script is named anything other than that target's canonical
 *   `<target>:<verb>` key (a bare `release` / `publish` / `deploy` hiding a
 *   pipeline invocation, or a `github:release` whose body actually publishes to
 *   npm). A script whose body does NO recognizable release/publish work is
 *   ignored here — canonical-body drift for `github:release` / `npm:publish` is
 *   enforced separately by the sync-scaffolding CANONICAL_SCRIPT_BODIES gate.
 *
 *   Enforcing (exit 1 on a violation): there is no fleet backlog — no repo ships
 *   a mis-named release/publish script today — so the convention holds from the
 *   start. Pure classification (classifyReleasePublishScript) is exported for
 *   unit tests; the scan/report is the thin CLI shell.
 *
 *   Usage: node scripts/fleet/check/release-publish-scripts-are-conventionally-named.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'

const logger = getDefaultLogger()

export type ReleasePublishTarget = 'github' | 'npm' | 'cargo' | 'go' | 'python'

// Body → target patterns. Each entry maps the canonical `<target>:<verb>` name
// to the regexes that identify that target's work in a script BODY. Ordered so
// the classification is deterministic; a body matching more than one target is
// treated as ambiguous (a combined orchestration) and skipped.
const TARGET_SIGNATURES: ReadonlyArray<{
  readonly target: ReleasePublishTarget
  readonly expectedName: string
  readonly patterns: readonly RegExp[]
}> = [
  {
    target: 'github',
    expectedName: 'github:release',
    // require-regex-comment: a body invoking release-pipeline.mts or github-release.mts.
    patterns: [/\brelease-pipeline\.mts\b/, /\bgithub-release\.mts\b/],
  },
  {
    target: 'npm',
    expectedName: 'npm:publish',
    // require-regex-comment: a body invoking publish-pipeline.mts or npm-publish.mts.
    patterns: [/\bpublish-pipeline\.mts\b/, /\bnpm-publish\.mts\b/],
  },
  {
    target: 'cargo',
    expectedName: 'cargo:publish',
    // require-regex-comment: a body running `cargo publish`, or invoking the
    // canonical cargo-publish.mts entry (mirrors the npm signature, which
    // matches both publish-pipeline.mts and npm-publish.mts).
    patterns: [/\bcargo\s+publish\b/, /\bcargo-publish\.mts\b/],
  },
  {
    target: 'go',
    expectedName: 'go:publish',
    // require-regex-comment: a body invoking the canonical go-publish.mts entry.
    // Go has no `go publish` command — a module publishes by pushing a semver
    // tag — so the engine script is the sole signature (cf. cargo's dual form).
    patterns: [/\bgo-publish\.mts\b/],
  },
  {
    target: 'python',
    expectedName: 'python:publish',
    // require-regex-comment: a body running `uv publish` or `twine upload`.
    patterns: [/\buv\s+publish\b/, /\btwine\s+upload\b/],
  },
]

// Remote-dispatch twins live in scripts/fleet/publish-infra/remote-*.mts and
// carry the `remote:` namespace — they dispatch the repo's CI workflow, they do
// not run the local orchestrator. Their filenames embed the local orchestrator
// filename as a substring (remote-github-release.mts contains
// github-release.mts), so match the more specific pattern FIRST or a remote
// dispatcher is misread as the local target and forced to drop its namespace.
const REMOTE_SIGNATURES: ReadonlyArray<{
  readonly target: ReleasePublishTarget
  readonly expectedName: string
  readonly pattern: RegExp
}> = [
  {
    target: 'github',
    expectedName: 'remote:github:release',
    // require-regex-comment: a body dispatching the remote github-release workflow.
    pattern: /\bremote-github-release\.mts\b/,
  },
  {
    target: 'npm',
    expectedName: 'remote:npm:publish',
    // require-regex-comment: a body dispatching the remote npm-publish workflow.
    pattern: /\bremote-npm-publish\.mts\b/,
  },
]

export interface ConventionVerdict {
  readonly target: ReleasePublishTarget
  readonly expectedName: string
  readonly ok: boolean
}

/**
 * Classify one package.json script (name + body) against the `<target>:<verb>`
 * release/publish convention. Returns the verdict when the body performs
 * recognizable release/publish work for exactly one target, or null when the
 * body does no such work (or is ambiguously multi-target — a combined
 * orchestration this check does not police). Pure so it is unit-tested without
 * a filesystem.
 */
export function classifyReleasePublishScript(
  scriptName: string,
  scriptBody: string,
): ConventionVerdict | null {
  const body = scriptBody.trim()
  if (!body) {
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- external API contract: the unit test suite asserts strict equality against this exact `null` return value
    return null
  }
  // Remote-dispatch twins first — their filename is the more specific match, so
  // classify them before the local signatures (whose bare-orchestrator pattern
  // would also match a remote-*.mts body as a substring).
  const remote = REMOTE_SIGNATURES.filter(sig => sig.pattern.test(body))
  if (remote.length === 1) {
    const { expectedName, target } = remote[0]!
    return { expectedName, ok: scriptName === expectedName, target }
  }
  const matched = TARGET_SIGNATURES.filter(sig =>
    sig.patterns.some(re => re.test(body)),
  )
  // No target, or an ambiguous combined body → not this check's concern.
  if (matched.length !== 1) {
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- external API contract: the unit test suite asserts strict equality against this exact `null` return value
    return null
  }
  const { expectedName, target } = matched[0]!
  return { expectedName, ok: scriptName === expectedName, target }
}

export interface ConventionFinding {
  readonly file: string
  readonly scriptKey: string
  readonly value: string
  readonly expectedName: string
}

export async function scanRepo(repoRoot: string): Promise<ConventionFinding[]> {
  const manifests = await collectTrackedFiles(['**/package.json'], {
    cwd: repoRoot,
  })
  const findings: ConventionFinding[] = []
  for (const rel of manifests) {
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      continue
    }
    let manifest: { scripts?: Record<string, unknown> | undefined }
    try {
      manifest = JSON.parse(readFileSync(abs, 'utf8')) as {
        scripts?: Record<string, unknown> | undefined
      }
    } catch {
      continue
    }
    const scripts = manifest.scripts
    if (!scripts || typeof scripts !== 'object') {
      continue
    }
    for (const [scriptKey, rawValue] of Object.entries(scripts)) {
      if (typeof rawValue !== 'string') {
        continue
      }
      const verdict = classifyReleasePublishScript(scriptKey, rawValue)
      if (verdict && !verdict.ok) {
        findings.push({
          expectedName: verdict.expectedName,
          file: rel,
          scriptKey,
          value: rawValue,
        })
      }
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
        '[release-publish-scripts-are-conventionally-named] release/publish scripts ' +
          'follow the <target>:<verb> naming convention.',
      )
    }
    return 0
  }
  logger.fail(
    `[release-publish-scripts-are-conventionally-named] ${findings.length} ` +
      `release/publish script(s) are not named per the <target>:<verb> convention:`,
  )
  logger.group()
  for (const f of findings) {
    logger.fail(
      `${f.file}  "${f.scriptKey}": "${f.value}" → rename to "${f.expectedName}"`,
    )
  }
  logger.groupEnd()
  logger.log(
    'Fix: rename the script to its canonical <target>:<verb> key — ' +
      'github:release, npm:publish, cargo:publish, go:publish, or ' +
      'python:publish. A release never publishes to a registry; publishing ' +
      'resumes from the release.',
  )
  process.exitCode = 1
  return 1
}

if (isMainModule(import.meta.url)) {
  void main()
}
