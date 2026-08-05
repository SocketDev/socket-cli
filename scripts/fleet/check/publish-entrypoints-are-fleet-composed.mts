#!/usr/bin/env node
/*
 * @file Fleet check — every member's npm publish path is the FLEET path.
 *
 *   The owner rule: a member publishes through the shared fleet script. A member
 *   may keep a custom publish flow only where its shape genuinely differs —
 *   socket-registry publishes ~131 override packages, not one — and even that
 *   flow composes the SAME primitives instead of carrying its own copies.
 *
 *   Why it is a gate and not a convention: five members shipped a byte-identical
 *   `npm-publish.yml` and a byte-identical `scripts/fleet/npm-publish.mts`, and
 *   still published under two different credentials. The workflow said trusted
 *   publishing; one member's environment quietly supplied a long-lived
 *   `NODE_AUTH_TOKEN` that covered a failed OIDC exchange, and the divergence
 *   was invisible until a release failed. Uniform bytes are not uniform
 *   behavior — the guarantee has to be that ONE piece of code does the upload,
 *   so a fix to it reaches everyone.
 *
 *   Three passes:
 *
 *   - ENTRY POINTS RESOLVE. Every publish-shaped `package.json` script that runs
 *     a local `.mts` must resolve to a script under `scripts/fleet/`, or to a
 *     repo-local script whose import graph reaches `scripts/fleet/publish-infra/`
 *     (directly or through repo-local modules). A publish entry point that
 *     reaches no fleet code is a standalone reimplementation by definition.
 *
 *   - THE UPLOAD IS FLEET-OWNED. No file outside `scripts/fleet/` may build an
 *     npm-family UPLOAD invocation itself — `pnpm publish`, `pnpm stage publish`,
 *     or their argv-array form. That invocation is where provenance is decided,
 *     where the auth posture is asserted, and where a failed OIDC exchange is
 *     caught; a second copy is a second set of those decisions, and it will be
 *     the stale one. Everything ELSE stays repo-local by design: publish order,
 *     which commits to republish, how an approve batch refreshes its OTP. That
 *     is orchestration, and orchestration is a member's own business.
 *
 *   - NO WORKFLOW RESERVES A NAME. The `0.0.0` placeholder reservation is the
 *     one publish allowed to authenticate with a long-lived token, and it is
 *     LOCAL-ONLY: a name that does not exist yet cannot have a trusted
 *     publisher, so a reservation can never be a CI publish. No workflow may
 *     invoke `placeholder.mts`. The script refuses at runtime under a runner
 *     too, but a workflow that calls it is a policy violation checked in, and
 *     this catches it at commit time instead of at release time.
 *
 *   Scope: the repo's own `scripts/` tree, plus `template/base/scripts/` and
 *   `template/overrides/<member>/scripts/` in the wheelhouse so a
 *   reimplementation authored in the template is caught before it cascades.
 *   Workflows are scanned in the same live-plus-template shape. Generated,
 *   vendored, and dependency trees are skipped, as are this check's own
 *   fixtures.
 *
 *   STRICT: any finding exits 1. Pure classification (`auditPublishComposition`)
 *   is exported for unit tests; the scan is the thin CLI shell.
 *
 *   Usage: node scripts/fleet/check/publish-entrypoints-are-fleet-composed.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The fleet publish tier. A repo-local script is "composed" when its import
// graph reaches one of these; the runner scripts count because they are thin
// shells over publish-infra.
const FLEET_PUBLISH_MARKERS: readonly string[] = [
  'publish-infra/',
  'publish-shared.mts',
  'npm-publish.mts',
  'publish-pipeline.mts',
]

// A package.json script NAME that names a publish. Matched on the name, not the
// body, so a script that shells out to something unexpected is still audited.
// The token is `publish`, nothing looser: a `release-*` script is usually a
// bump / changelog / tag step, and treating it as an uploader sends the reader
// to the wrong fix. Whether a release-shaped name is accurate belongs to
// release-publish-scripts-are-conventionally-named, not here.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const PUBLISH_SCRIPT_NAME_RE = /(?:^|[:-])publish(?:$|[:-])/

// `node <path>.mts` / `node <path>.mjs` inside a package.json script body.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const NODE_SCRIPT_RE = /\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*([\w./-]+\.m?[jt]s)\b/

// A relative import specifier, quoted, from an import / export-from / dynamic
// import. Broad on purpose — the graph walk only follows the ones that resolve
// to a real repo-local file.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const RELATIVE_IMPORT_RE =
  /from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]/g

// Line and block comments, stripped before the scan. A `.mts` that DESCRIBES
// the publish flow in prose ("dispatches the npm publish workflow") is not
// running it; matching prose would make the gate unusable in exactly the
// scripts that document the flow.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const COMMENT_RE = /\/\*[\s\S]*?\*\/|(?<![:\w])\/\/[^\n]*/g

// The argv forms a script uses to spawn an npm upload. Only these count — a
// `.mts` publishes by spawning a command with an argument ARRAY, never by
// interpolating a shell string, so the argv shape is the complete surface and
// it cannot be tripped by a sentence.
//
//   ['stage', 'publish', …]         staged upload
//   ['publish', '--access', …]      direct upload
//   spawn('pnpm', ['publish' …])    either, written inline
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const ARGV_UPLOAD_RE =
  /['"]stage['"]\s*,\s*['"]publish['"]|['"]publish['"]\s*,\s*['"]--(?:access|dry-run|provenance|tag)['"]|['"](?:npm|pnpm|yarn)['"]\s*,\s*\[\s*['"](?:publish|stage)['"]/

// The name-reservation script. A workflow naming it is the finding — the
// reservation is local-only by policy, so there is no valid CI caller.
const PLACEHOLDER_SCRIPT_NAME = 'placeholder.mts'

// Directories never worth walking.
const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'build',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'upstream',
  'vendor',
])

export interface PublishCompositionFinding {
  /**
   * `entry-point` — a publish entry point that reaches no fleet publish code.
   * `duplicate-upload` — an npm upload invocation built outside the fleet tree.
   * `workflow-reservation` — a workflow that invokes the local-only `0.0.0`
   * name reservation.
   */
  kind: 'duplicate-upload' | 'entry-point' | 'workflow-reservation'
  /**
   * Repo-relative path of the offending file.
   */
  relPath: string
  /**
   * The specific thing that tripped the finding, quotable in the report.
   */
  detail: string
}

/**
 * True for a path inside a fleet-owned script tree, live or templated. Those
 * trees ARE the shared primitive, so they are exempt from the duplicate-upload
 * pass by definition.
 */
export function isFleetOwnedScript(relPath: string): boolean {
  const unix = normalizePath(relPath)
  return unix.includes('scripts/fleet/') || unix.includes('/scripts/fleet/')
}

/**
 * The `.mts`/`.mjs` a package.json script body invokes with `node`, or
 * undefined when it invokes something else (another pnpm script, a shell
 * pipeline, a binary).
 */
export function nodeScriptTarget(body: string): string | undefined {
  const match = NODE_SCRIPT_RE.exec(body)
  return match?.[1]
}

/**
 * Whether a package.json script name names a publish.
 */
export function isPublishScriptName(name: string): boolean {
  return PUBLISH_SCRIPT_NAME_RE.test(name)
}

/**
 * `source` with its comments blanked out, newlines preserved so a later line
 * count still lines up.
 */
export function stripSourceComments(source: string): string {
  return source.replace(COMMENT_RE, match => match.replace(/[^\n]/g, ' '))
}

/**
 * The npm upload invocation `source` builds, or undefined when it builds none.
 * Comments are stripped first, so prose describing the publish flow never
 * counts. Returns the matched text, whitespace collapsed, so the report quotes
 * the source rather than describing it.
 */
export function uploadInvocationIn(source: string): string | undefined {
  const argv = ARGV_UPLOAD_RE.exec(stripSourceComments(source))
  return argv ? argv[0].replace(/\s+/g, ' ') : undefined
}

/**
 * Every relative import specifier in a module's source.
 */
export function relativeImportsIn(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(RELATIVE_IMPORT_RE)) {
    const spec = match[1] ?? match[2]
    if (spec) {
      found.push(spec)
    }
  }
  return found
}

/**
 * Whether `absPath`'s import graph reaches the fleet publish tier.
 *
 * Walks repo-local relative imports breadth-first with a visited set, so a
 * cycle terminates and a diamond is read once. A specifier naming a fleet
 * publish module counts even when the file is not on disk — a member that
 * imports `../fleet/publish-shared.mts` is composed whether or not this
 * particular checkout has cascaded yet.
 */
export function importGraphReachesFleetPublish(
  absPath: string,
  readSource: (filePath: string) => string | undefined,
): boolean {
  const queue = [absPath]
  const seen = new Set<string>()
  while (queue.length) {
    const current = queue.shift()!
    if (seen.has(current)) {
      continue
    }
    seen.add(current)
    const source = readSource(current)
    if (source === undefined) {
      continue
    }
    const specs = relativeImportsIn(source)
    for (let i = 0, { length } = specs; i < length; i += 1) {
      const spec = specs[i]!
      if (FLEET_PUBLISH_MARKERS.some(marker => spec.includes(marker))) {
        return true
      }
      queue.push(path.resolve(path.dirname(current), spec))
    }
  }
  return false
}

/**
 * The `placeholder.mts` invocation a workflow body contains, or undefined when
 * it contains none. Comments are stripped first — a workflow that explains in a
 * `#` comment why there is no reservation job is not one running a reservation.
 */
export function reservationInvocationIn(body: string): string | undefined {
  const lines = body.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.replace(/#.*$/, '')
    if (line.includes(PLACEHOLDER_SCRIPT_NAME)) {
      return line.trim()
    }
  }
  return undefined
}

/**
 * Classify one repo tree. Pure over its inputs: `manifestScripts` is the
 * package.json `scripts` map, `scriptFiles` is every repo-relative script path
 * to audit, `workflowFiles` is every repo-relative workflow path, and
 * `readSource` resolves a path to its text.
 */
export function auditPublishComposition(config: {
  manifestScripts: Readonly<Record<string, string>>
  readSource: (filePath: string) => string | undefined
  repoRoot: string
  scriptFiles: readonly string[]
  workflowFiles?: readonly string[] | undefined
}): PublishCompositionFinding[] {
  const {
    manifestScripts,
    readSource,
    repoRoot,
    scriptFiles,
    workflowFiles = [],
  } = {
    __proto__: null,
    ...config,
  } as typeof config
  const findings: PublishCompositionFinding[] = []

  const names = Object.keys(manifestScripts)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (!isPublishScriptName(name)) {
      continue
    }
    const target = nodeScriptTarget(manifestScripts[name] ?? '')
    if (!target || isFleetOwnedScript(target)) {
      continue
    }
    const abs = path.resolve(repoRoot, target)
    if (!importGraphReachesFleetPublish(abs, readSource)) {
      findings.push({
        detail: `package.json script "${name}" runs ${target}`,
        kind: 'entry-point',
        relPath: target,
      })
    }
  }

  for (let i = 0, { length } = scriptFiles; i < length; i += 1) {
    const relPath = scriptFiles[i]!
    if (isFleetOwnedScript(relPath)) {
      continue
    }
    const source = readSource(path.resolve(repoRoot, relPath))
    if (source === undefined) {
      continue
    }
    const invocation = uploadInvocationIn(source)
    if (invocation) {
      findings.push({
        detail: invocation,
        kind: 'duplicate-upload',
        relPath,
      })
    }
  }

  for (let i = 0, { length } = workflowFiles; i < length; i += 1) {
    const relPath = workflowFiles[i]!
    const body = readSource(path.resolve(repoRoot, relPath))
    if (body === undefined) {
      continue
    }
    const invocation = reservationInvocationIn(body)
    if (invocation) {
      findings.push({
        detail: invocation,
        kind: 'workflow-reservation',
        relPath,
      })
    }
  }
  return findings
}

// Every `.mts`/`.mjs` under `dir`, repo-relative, skipping the never-walked
// directories.
function collectScriptFiles(repoRoot: string, dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue
    }
    const full = path.join(dir, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      out.push(...collectScriptFiles(repoRoot, full))
    } else if (/\.m[jt]s$/.test(name)) {
      out.push(normalizePath(path.relative(repoRoot, full)))
    }
  }
  return out
}

// The script roots to audit: the live tree always, plus the template sources in
// the wheelhouse so a reimplementation is caught before it cascades.
function scriptRoots(repoRoot: string): string[] {
  const roots = [path.join(repoRoot, 'scripts')]
  const overrides = path.join(repoRoot, 'template', 'overrides')
  roots.push(path.join(repoRoot, 'template', 'base', 'scripts'))
  if (existsSync(overrides)) {
    for (const name of readdirSync(overrides)) {
      roots.push(path.join(overrides, name, 'scripts'))
    }
  }
  return roots
}

// Every workflow file, repo-relative: the live `.github/workflows` plus the
// template sources in the wheelhouse, same live-plus-template shape as the
// script roots.
function collectWorkflowFiles(repoRoot: string): string[] {
  const roots = [
    path.join(repoRoot, '.github', 'workflows'),
    path.join(repoRoot, 'template', 'base', '.github', 'workflows'),
  ]
  const conditional = path.join(repoRoot, 'template', 'conditional')
  if (existsSync(conditional)) {
    for (const name of readdirSync(conditional)) {
      roots.push(path.join(conditional, name, '.github', 'workflows'))
    }
  }
  const out: string[] = []
  for (let i = 0, { length } = roots; i < length; i += 1) {
    const root = roots[i]!
    if (!existsSync(root)) {
      continue
    }
    for (const name of readdirSync(root)) {
      if (/\.ya?ml$/.test(name)) {
        out.push(normalizePath(path.relative(repoRoot, path.join(root, name))))
      }
    }
  }
  return out
}

function readManifestScripts(repoRoot: string): Record<string, string> {
  const manifestPath = path.join(repoRoot, 'package.json')
  if (!existsSync(manifestPath)) {
    return {}
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scripts?: Record<string, string> | undefined
    }
    return parsed.scripts ?? {}
  } catch {
    return {}
  }
}

export function runCheck(repoRoot: string): number {
  const scriptFiles: string[] = []
  for (const root of scriptRoots(repoRoot)) {
    scriptFiles.push(...collectScriptFiles(repoRoot, root))
  }
  const findings = auditPublishComposition({
    manifestScripts: readManifestScripts(repoRoot),
    readSource: filePath => {
      try {
        return readFileSync(filePath, 'utf8')
      } catch {
        return undefined
      }
    },
    repoRoot,
    scriptFiles,
    workflowFiles: collectWorkflowFiles(repoRoot),
  })
  if (findings.length === 0) {
    return 0
  }
  const entryPoints = findings.filter(f => f.kind === 'entry-point')
  const duplicates = findings.filter(f => f.kind === 'duplicate-upload')
  const reservations = findings.filter(f => f.kind === 'workflow-reservation')
  const report: string[] = [
    '[publish-entrypoints-are-fleet-composed] A publish path does not compose the fleet primitives.',
    '',
  ]
  if (entryPoints.length) {
    report.push(
      '  What: a publish entry point reaches no fleet publish code at all.',
      '  Where:',
      ...entryPoints.map(f => `    ${f.relPath} — ${f.detail}`),
      '  Saw vs wanted: an entry point whose import graph never reaches',
      '    scripts/fleet/publish-infra/; wanted it to run the fleet script, or',
      '    to import the fleet primitives it needs.',
      '  Fix: point the script at scripts/fleet/npm-publish.mts, or import the',
      '    publish-infra primitives from the repo-local orchestrator.',
      '',
    )
  }
  if (duplicates.length) {
    report.push(
      '  What: an npm UPLOAD invocation is built outside scripts/fleet/.',
      '  Where:',
      ...duplicates.map(f => `    ${f.relPath} — ${f.detail}`),
      '  Saw vs wanted: a second copy of the upload command; wanted the one in',
      '    scripts/fleet/publish-infra/npm/publish-command.mts. That function',
      '    decides provenance, asserts the trusted-publishing auth posture, and',
      '    catches a failed OIDC exchange that still exits 0. A copy re-decides',
      '    all three, and drifts.',
      '  Fix: delete the local invocation and call uploadNpmPackage({ cwd, mode,',
      '    tag, dryRun }) instead. Keep your orchestration — publish order, which',
      '    commits ship, how an approve batch refreshes its OTP — that part is',
      '    yours. Only the upload itself is shared.',
      '',
    )
  }
  if (reservations.length) {
    report.push(
      '  What: a workflow invokes the 0.0.0 placeholder name reservation.',
      '  Where:',
      ...reservations.map(f => `    ${f.relPath} — ${f.detail}`),
      '  Saw vs wanted: a reservation wired into CI; wanted it run only by a',
      '    human or an agent, locally. Everything that publishes from CI',
      '    publishes by trusted publishing, and a reservation cannot — the name',
      '    it claims does not exist yet, so no trusted publisher can be',
      '    configured for it. Reserving from CI would mean holding a publish',
      '    token there, which the policy forbids outright.',
      '  Fix: delete the job. Run `node scripts/fleet/publish-infra/npm/',
      '    placeholder.mts <name> --apply` locally instead, then configure the',
      '    OIDC trusted publisher and release through npm-publish.yml.',
      '',
    )
  }
  logger.fail(report.join('\n'))
  return 1
}

function main(): void {
  process.exitCode = runCheck(REPO_ROOT)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'check that the npm publish path composes the shared fleet primitives',
  help: 'Usage: node scripts/fleet/check/publish-entrypoints-are-fleet-composed.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
