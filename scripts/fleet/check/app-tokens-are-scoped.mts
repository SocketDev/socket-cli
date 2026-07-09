/**
 * @file Code-as-law least-privilege gate for GitHub App tokens. Every step that
 *   runs the in-house minter (`mint-app-installation-token.mjs`) MUST scope the
 *   token via a non-blank `PERMISSIONS` env (a JSON object, e.g.
 *   `{"contents":"write"}`) rather than leaving it unset / empty / `{}`, which
 *   would mint a token carrying the app installation's BLANKET permissions. A
 *   compromised workflow with an unscoped token wields the app's full blast
 *   radius instead of just what the job needs. The minter is a `run:` step, not
 *   a recognizable third-party action, so zizmor's `github-app` audit does NOT
 *   see it — this check is the SOLE enforcement of the scope contract (it
 *   formerly backstopped zizmor's check of the `permission-*` inputs on the
 *   pinned token action). Scans `.github/**` (workflows + composite actions) of
 *   the repo, the cascaded `template/base/.github/**`, and the fleet-shared
 *   override actions under `template/overrides/socket-registry/.github/**`
 *   (which host the shared github-release-/github-pr-app-token actions every
 *   member consumes). Exit 0 = every minter step scoped (or none used). Exit 1
 *   = an unscoped step, listed with What / Where / Saw-vs-wanted / Fix. CI gate
 *   via `scripts/check.mts`. Usage: node
 *   scripts/fleet/check/app-tokens-are-scoped.mts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// The in-house minter filename — its presence in a (non-comment) step line marks
// that step as minting a GitHub App token.
const MINTER_FILE_RE = /mint-app-installation-token\.m[jt]s/
// A `PERMISSIONS:` env entry; the captured value is checked for a real scope.
const PERMISSIONS_ENV_RE = /^\s*PERMISSIONS:\s*(\S.*?)\s*$/

// A PERMISSIONS value that mints blanket perms: blank, or an empty object once
// surrounding quotes are stripped. Anything else (e.g. {"contents":"write"}) is
// treated as a real scope.
function isBlankScope(value: string): boolean {
  const inner = value.replace(/^['"]/, '').replace(/['"]$/, '').trim()
  return inner === '' || inner === '{}'
}

export interface UnscopedUse {
  // 1-based line number of the minter step's list item.
  line: number
}

/**
 * Find every minter step in a workflow/action YAML that does NOT carry a scoped
 * `PERMISSIONS` env (so the token would inherit the installation's blanket
 * permissions). Pure + line-based (no YAML dep): for each line invoking the
 * minter, bound its enclosing step — up to the nearest `- ` sequence item, down
 * to the next sibling item / dedent — and scan that block for a non-blank
 * `PERMISSIONS` env. Returns the unscoped steps in file order.
 */
export function findUnscopedAppTokenUses(yaml: string): UnscopedUse[] {
  const lines = yaml.split('\n')
  const unscoped: UnscopedUse[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const ln = lines[i]!
    if (ln.trimStart().startsWith('#') || !MINTER_FILE_RE.test(ln)) {
      continue
    }
    const runIndent = ln.length - ln.trimStart().length
    // Walk up to the step's `- ` sequence item (shallower than the run line).
    let stepStart = i
    let stepIndent = runIndent
    for (let j = i; j >= 0; j -= 1) {
      const m = /^(\s*)-\s/.exec(lines[j]!)
      if (m && m[1]!.length < runIndent) {
        stepStart = j
        stepIndent = m[1]!.length
        break
      }
    }
    // Walk down to the next sibling item / dedent (the step's end).
    let stepEnd = length
    for (let j = i + 1; j < length; j += 1) {
      const cur = lines[j]!
      if (cur.trim() === '') {
        continue
      }
      const indent = cur.length - cur.trimStart().length
      if (indent <= stepIndent) {
        stepEnd = j
        break
      }
    }
    let scoped = false
    for (let j = stepStart; j < stepEnd; j += 1) {
      const m = PERMISSIONS_ENV_RE.exec(lines[j]!)
      if (m && !isBlankScope(m[1]!)) {
        scoped = true
        break
      }
    }
    if (!scoped) {
      unscoped.push({ line: stepStart + 1 })
    }
  }
  return unscoped
}

/**
 * Recursively collect `*.yml` / `*.yaml` files under `dir` (if it exists).
 */
export function collectYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      out.push(...collectYamlFiles(full))
    } else if (/\.ya?ml$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

export function runCheck(repoRoot: string): number {
  // The live .github, the cascaded source (wheelhouse dogfood), and the shared
  // socket-registry override actions — so an unscoped token can't hide in the
  // host's workflows, the template it ships, or the fleet-shared actions.
  const dirs = [
    path.join(repoRoot, '.github'),
    path.join(repoRoot, 'template', 'base', '.github'),
    path.join(repoRoot, 'template', 'overrides', 'socket-registry', '.github'),
  ]
  const findings: Array<{ relPath: string; line: number }> = []
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const dir = dirs[i]!
    for (const file of collectYamlFiles(dir)) {
      const text = readFileSync(file, 'utf8')
      for (const use of findUnscopedAppTokenUses(text)) {
        findings.push({
          line: use.line,
          relPath: path.relative(repoRoot, file),
        })
      }
    }
  }
  if (findings.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[app-tokens-are-scoped] GitHub App token(s) minted with blanket installation permissions.',
      '',
      '  A minter step with no scoped `PERMISSIONS` env mints a token carrying',
      "  EVERY permission the app's installation holds — a compromised workflow",
      '  then wields the app, not just the job. Scope it to the minimum.',
      '',
      '  Unscoped:',
      ...findings.map(f => `    - ${f.relPath}:${f.line}`),
      '',
      '  Fix: set a non-blank PERMISSIONS env (a JSON object) on the step, e.g.',
      `    PERMISSIONS: '{"contents":"write"}'`,
      '',
    ].join('\n'),
  )
  return 1
}

function main(): void {
  process.exitCode = runCheck(REPO_ROOT)
}

try {
  main()
} catch (e) {
  logger.error(e)
  process.exitCode = 1
}
