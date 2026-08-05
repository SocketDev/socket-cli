/*
 * @file Code-as-law: every fleet/repo CLI entry script SELF-DESCRIBES — it
 *   answers `--describe` (one-line purpose) and `-h`/`--help` (usage) without
 *   running its side effect. The shared runner owns the interception
 *   (`scripts/fleet/_shared/run-main.mts`), so the enforceable shape is the
 *   call site: an entry-guarded script must invoke `runMain(<main>, <meta>)`
 *   with the ScriptMeta second argument. Two defects are flagged, scanning
 *   every `.mts` under scripts/fleet/ + scripts/repo/:
 *
 *   1. no-run-main — the file carries an entry guard
 *      (`isMainModule(import.meta.url)` / `import.meta.main`) whose body
 *      never calls the shared runner, so a help request runs the script's
 *      side effect instead of printing usage. The fix is
 *      `runMain(main, SCRIPT_META)`.
 *   2. no-meta — the guard calls `runMain(...)` with a single argument, so
 *      the runner has nothing to print. The fix is passing a
 *      `ScriptMeta { describe, help }` second argument; TypeScript enforces
 *      the shape once it is passed.
 *
 *   Detection is a real parse, not a regex: the fleet's WASM acorn parses the
 *   `.mts` source directly (`typescript: true`, via the hooks' shared
 *   `ast/core.mts` surface), so a guard pattern quoted in a comment or a
 *   guidance string can never false-positive. Fleet convention keeps the
 *   entry guard, `main`, and exports at module top level, so the scan runs
 *   `walkRecursive` with no-op function/class visitors: those subtrees are
 *   pruned INSIDE wasm and never materialize across the boundary — only
 *   guard `IfStatement`s cross into JS. This is the standard-things/esm
 *   `parseTopLevel` optimization, expressed as walker pruning.
 *
 *   Run standalone: `node scripts/fleet/check/entry-scripts-self-describe.mts`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { walkRecursive } from '../../../.claude/hooks/fleet/_shared/ast/core.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { AcornNode } from '../../../.claude/hooks/fleet/_shared/ast/core.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

export interface Finding {
  // repo-root-relative path of the offending entry script.
  file: string
  // Which self-describe defect this is — each has its own fix + message.
  kind: 'no-run-main' | 'no-meta'
}

// Files exempt from the call-site scan, all for ONE reason: they are
// dependency-free by design (node builtins only) because they run where no
// install has happened — the release-reconcile gap job on a bare depth-1
// checkout, the dep-0 prepare doctor before workspace packages resolve, and
// the bundle installer's source on a bare clone. run-main.mts imports
// @socketsecurity/lib-stable at top level, so none can join the seam until a
// dependency-free runner variant exists.
const SELF_DESCRIBE_ALLOWLIST = new Set<string>([
  'scripts/fleet/release-pipeline/reconcile-gap.mts',
  'scripts/repo/bootstrap/prepare.mts',
  'scripts/repo/gen/bootstrap/prepare.mts',
  'scripts/repo/gen/bootstrap/src/fleet.mts',
])

/**
 * The slice of an ESTree node this scan reads. The WASM acorn returns plain
 * ESTree objects with no published TS types; child nodes surface as nested
 * values of these same shapes.
 */
export interface EstreeNode {
  readonly type: string
  readonly name?: string | undefined
  readonly body?: readonly EstreeNode[] | EstreeNode | undefined
  readonly test?: EstreeNode | undefined
  readonly consequent?: EstreeNode | undefined
  readonly expression?: EstreeNode | undefined
  readonly callee?: EstreeNode | undefined
  readonly arguments?: readonly EstreeNode[] | undefined
  readonly object?: EstreeNode | undefined
  readonly property?: EstreeNode | undefined
  readonly argument?: EstreeNode | undefined
  readonly left?: EstreeNode | undefined
  readonly right?: EstreeNode | undefined
  readonly operator?: string | undefined
}

/**
 * True when `node` (an if-condition subtree) references an entry-guard
 * opener: an `isMainModule(...)` call or the `import.meta.main` property.
 * Conditions compose at most a few logical operators, so only those shapes
 * recurse — never the whole tree.
 */
export function isEntryGuardCondition(node: EstreeNode): boolean {
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'isMainModule'
  ) {
    return true
  }
  if (
    node.type === 'MemberExpression' &&
    node.property?.type === 'Identifier' &&
    node.property.name === 'main' &&
    node.object?.type === 'MetaProperty'
  ) {
    return true
  }
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    return (
      (node.left !== undefined && isEntryGuardCondition(node.left)) ||
      (node.right !== undefined && isEntryGuardCondition(node.right))
    )
  }
  if (
    node.type === 'ParenthesizedExpression' ||
    node.type === 'UnaryExpression'
  ) {
    return node.argument !== undefined && isEntryGuardCondition(node.argument)
  }
  return false
}

/**
 * The `runMain(...)` call inside one guard-body statement, unwrapping a
 * `void`-prefixed call; `undefined` when the statement is something else.
 */
function runMainCallOf(stmt: EstreeNode): EstreeNode | undefined {
  if (stmt.type !== 'ExpressionStatement' || stmt.expression === undefined) {
    return undefined
  }
  let expr = stmt.expression
  if (
    expr.type === 'UnaryExpression' &&
    expr.operator === 'void' &&
    expr.argument !== undefined
  ) {
    expr = expr.argument
  }
  if (
    expr.type === 'CallExpression' &&
    expr.callee?.type === 'Identifier' &&
    expr.callee.name === 'runMain'
  ) {
    return expr
  }
  return undefined
}

/**
 * The verdict for one entry guard's `IfStatement`: `undefined` when its body
 * calls `runMain` with a meta argument, else which defect it carries.
 */
function guardVerdict(
  guard: EstreeNode,
): 'no-run-main' | 'no-meta' | undefined {
  const consequent = guard.consequent
  const body: readonly EstreeNode[] =
    consequent === undefined
      ? []
      : consequent.type === 'BlockStatement' && Array.isArray(consequent.body)
        ? consequent.body
        : [consequent]
  for (const inner of body) {
    const call = runMainCallOf(inner)
    if (call) {
      return (call.arguments?.length ?? 0) >= 2 ? undefined : 'no-meta'
    }
  }
  return 'no-run-main'
}

// The walker visitors that make the scan top-level: never calling the
// walker's descend callback prunes the whole subtree inside wasm, so the
// bulk of every file never crosses the wasm→JS boundary.
function skipSubtree(): void {}

/**
 * Classify one script source: `undefined` when compliant or out of scope (no
 * entry guard — a library, an unparseable file, or a module merely quoting
 * the guard in prose), else the defect kind. Runs `walkRecursive` with
 * function/class subtrees pruned, per the fleet's top-level entry
 * convention; the parser reads the `.mts` source directly. Pure — exported
 * for tests.
 */
export function classifyEntrySource(
  text: string,
): 'no-run-main' | 'no-meta' | undefined {
  const verdicts: Array<'no-run-main' | 'no-meta' | undefined> = []
  walkRecursive(text, {
    ArrowFunctionExpression: skipSubtree,
    ClassDeclaration: skipSubtree,
    ClassExpression: skipSubtree,
    FunctionDeclaration: skipSubtree,
    FunctionExpression: skipSubtree,
    IfStatement(node: AcornNode) {
      const guard = node as unknown as EstreeNode
      if (guard.test !== undefined && isEntryGuardCondition(guard.test)) {
        verdicts.push(guardVerdict(guard))
      }
    },
  })
  // A compliant guard settles the file; the worst defect otherwise wins. An
  // unparseable file collects nothing — the lint/type gates own reporting it.
  if (verdicts.length === 0 || verdicts.includes(undefined)) {
    return undefined
  }
  return verdicts.includes('no-run-main') ? 'no-run-main' : 'no-meta'
}

export function scan(repoRoot: string = REPO_ROOT): Finding[] {
  const files = globSync(['scripts/fleet/**/*.mts', 'scripts/repo/**/*.mts'], {
    absolute: false,
    cwd: repoRoot,
  })
  const findings: Finding[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const rel = files[i]!
    if (SELF_DESCRIBE_ALLOWLIST.has(rel)) {
      continue
    }
    let text = ''
    try {
      text = readFileSync(path.join(repoRoot, rel), 'utf8')
    } catch {
      /* c8 ignore next - glob returned the path moments ago; a read race is not testable */
      continue
    }
    const kind = classifyEntrySource(text)
    if (kind) {
      findings.push({ file: rel, kind })
    }
  }
  return findings
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every fleet/repo CLI entry script answers --describe and --help via runMain(main, meta)',
  help: 'Usage: node scripts/fleet/check/entry-scripts-self-describe.mts',
}

function main(): number {
  const findings = scan()
  if (findings.length === 0) {
    logger.log('✔ every fleet/repo CLI entry self-describes')
    return 0
  }
  const noRunMain = findings.filter(f => f.kind === 'no-run-main')
  const noMeta = findings.filter(f => f.kind === 'no-meta')
  if (noRunMain.length > 0) {
    logger.error(
      `entry-scripts-self-describe: ${noRunMain.length} entry script(s) never call the shared runner, so --describe/--help run the side effect instead of printing usage.`,
    )
    logger.error(
      '  Wrap the entry: `runMain(main, SCRIPT_META)` from scripts/fleet/_shared/run-main.mts.',
    )
    for (let i = 0, { length } = noRunMain; i < length; i += 1) {
      logger.error(`  • ${noRunMain[i]!.file}`)
    }
  }
  if (noMeta.length > 0) {
    logger.error(
      `entry-scripts-self-describe: ${noMeta.length} runMain call(s) pass no ScriptMeta, so the runner has nothing to print for --describe/--help.`,
    )
    logger.error(
      '  Pass the second argument: `runMain(main, { describe, help })`.',
    )
    for (let i = 0, { length } = noMeta; i < length; i += 1) {
      logger.error(`  • ${noMeta[i]!.file}`)
    }
  }
  return 1
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
