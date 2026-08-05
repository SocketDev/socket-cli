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
 *   3. runs-on-import — the file invokes its own pipeline from a TOP-LEVEL
 *      statement (`main()`, `void main()`, `await main()`, `export const run
 *      = main().catch(…)`), so merely loading the module starts the work.
 *      Nothing gates on argv, so `--describe` and `--help` never get a turn:
 *      `node scripts/fleet/update.mts --describe` ran a full taze update plus
 *      `pnpm install`, rewriting four tracked files. Defects 1 and 2 both
 *      assume an entry guard exists to inspect — a file with NO guard at all
 *      read as "a library, out of scope" and passed. The fix is the same
 *      shape as the others: keep the work inside `main`, export it for the
 *      tests, and end the file with `if (isMainModule(import.meta.url)) {
 *      runMain(main, SCRIPT_META) }`.
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
 *   Run standalone: `node scripts/fleet/check/entry-scripts-are-self-describing.mts`.
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

/**
 * The self-describe defects, each with its own fix + operator message. See
 * the file header for what each one means.
 */
export type SelfDescribeDefect = 'no-run-main' | 'no-meta' | 'runs-on-import'

export interface Finding {
  // repo-root-relative path of the offending entry script.
  file: string
  // Which self-describe defect this is — each has its own fix + message.
  kind: SelfDescribeDefect
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

// Exempt from the runs-on-import scan only: test-runner/run-vitest.mts is an
// internal bridge test.mts spawns as its OWN process, never a user-facing
// entry, and the argv it receives is VITEST's — intercepting `-h` there would
// shadow vitest's own flag parsing. It carries the same documented exemption
// in entry-scripts-are-fail-soft's UNGUARDED_MAIN_ALLOWLIST.
const RUNS_ON_IMPORT_ALLOWLIST = new Set<string>([
  'scripts/fleet/test-runner/run-vitest.mts',
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
  readonly declaration?: EstreeNode | undefined
  readonly declarations?: readonly EstreeNode[] | undefined
  readonly id?: EstreeNode | undefined
  readonly init?: EstreeNode | undefined
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
export function runMainCallOf(stmt: EstreeNode): EstreeNode | undefined {
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
export function guardVerdict(
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

// The name every fleet entry gives the function holding its work. The
// runs-on-import scan needs it because a file with that defect has no
// `runMain(<fn>, meta)` call to read the pipeline's name from.
const PIPELINE_FN_NAME = 'main'

/**
 * The statement a top-level `export …` wraps, or the statement itself.
 * `export const run = main()` and a bare `const run = main()` are the same
 * defect, so the export wrapper is peeled before either is inspected.
 */
function unwrapExport(stmt: EstreeNode): EstreeNode {
  return (stmt.type === 'ExportDefaultDeclaration' ||
    stmt.type === 'ExportNamedDeclaration') &&
    stmt.declaration !== undefined
    ? stmt.declaration
    : stmt
}

/**
 * The call at the core of an expression, peeling the wrappers an entry uses
 * to launch its pipeline: `void`, `await`, an optional chain, and a trailing
 * `.catch(…)` / `.then(…)` handler. `main().catch(fn)` unwraps to `main()`.
 * Pure — exported for tests.
 */
export function unwrapPipelineCall(
  node: EstreeNode | undefined,
): EstreeNode | undefined {
  let current = node
  for (;;) {
    if (current === undefined) {
      return undefined
    }
    if (
      (current.type === 'UnaryExpression' && current.operator === 'void') ||
      current.type === 'AwaitExpression'
    ) {
      current = current.argument
      continue
    }
    if (current.type === 'ChainExpression') {
      current = current.expression
      continue
    }
    // `<call>.catch(fn)` / `<call>.then(fn)` — step onto the receiver.
    if (
      current.type === 'CallExpression' &&
      current.callee?.type === 'MemberExpression'
    ) {
      current = current.callee.object
      continue
    }
    return current
  }
}

/**
 * True when the expression invokes the module's own pipeline function by
 * name. Pure — exported for tests.
 */
export function isPipelineInvocation(node: EstreeNode | undefined): boolean {
  const call = unwrapPipelineCall(node)
  return (
    call?.type === 'CallExpression' &&
    call.callee?.type === 'Identifier' &&
    call.callee.name === PIPELINE_FN_NAME
  )
}

/**
 * True when a top-level statement DECLARES the pipeline — `function main()`
 * or `const main = async () => …`. Only a file that owns a `main` can run it
 * on import, so this gates the scan and keeps a library that merely calls
 * some imported `main` out of scope.
 */
function declaresPipeline(stmt: EstreeNode): boolean {
  if (stmt.type === 'FunctionDeclaration') {
    return stmt.id?.name === PIPELINE_FN_NAME
  }
  if (stmt.type === 'VariableDeclaration') {
    for (const decl of stmt.declarations ?? []) {
      if (
        decl.id?.name === PIPELINE_FN_NAME &&
        (decl.init?.type === 'ArrowFunctionExpression' ||
          decl.init?.type === 'FunctionExpression')
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * True when a top-level statement RUNS the pipeline — `main()`, `void
 * main()`, `await main()`, or a declarator initialized from it
 * (`export const updateRun = main().catch(…)`).
 */
function runsPipeline(stmt: EstreeNode): boolean {
  if (stmt.type === 'ExpressionStatement') {
    return isPipelineInvocation(stmt.expression)
  }
  if (stmt.type === 'VariableDeclaration') {
    for (const decl of stmt.declarations ?? []) {
      if (isPipelineInvocation(decl.init)) {
        return true
      }
    }
  }
  return false
}

/**
 * True when the module's top-level statements both declare the pipeline and
 * run it — the module starts its own work on import, before anything reads
 * argv. A statement nested in an entry guard belongs to that `IfStatement`'s
 * body, never to the Program body, so a compliant `if (isMainModule(…)) {
 * runMain(main, META) }` can never reach this.
 */
function topLevelRunsPipeline(body: readonly EstreeNode[]): boolean {
  let declared = false
  let ran = false
  for (const raw of body) {
    const stmt = unwrapExport(raw)
    if (declaresPipeline(stmt)) {
      declared = true
    }
    if (runsPipeline(stmt)) {
      ran = true
    }
  }
  return declared && ran
}

/**
 * True when loading `text` as a module would start its own pipeline. Its own
 * walk, not a visitor added to the guard scan below: registering a visitor
 * for a node type PRUNES that subtree in this walker, and there is no descend
 * callback to opt back in — a `Program` visitor sharing the guard walk would
 * silence every `IfStatement`. Pure — exported for tests.
 */
export function runsPipelineOnImport(text: string): boolean {
  let found = false
  walkRecursive(text, {
    Program(node: AcornNode) {
      const body = (node as unknown as EstreeNode).body
      if (Array.isArray(body)) {
        found = topLevelRunsPipeline(body)
      }
    },
  })
  return found
}

// The walker visitors that make the scan top-level: never calling the
// walker's descend callback prunes the whole subtree inside wasm, so the
// bulk of every file never crosses the wasm→JS boundary.
function skipSubtree(): void {}

/**
 * True when the source carries a real top-level entry guard — the scope test
 * this check and its siblings (entry-scripts-are-born-tested) share, so
 * "what counts as an entry script" is decided in exactly one place. Same
 * pruned walk as {@link classifyEntrySource}. Pure — exported for tests and
 * sibling checks.
 */
export function hasTopLevelEntryGuard(text: string): boolean {
  let found = false
  walkRecursive(text, {
    ArrowFunctionExpression: skipSubtree,
    ClassDeclaration: skipSubtree,
    ClassExpression: skipSubtree,
    FunctionDeclaration: skipSubtree,
    FunctionExpression: skipSubtree,
    IfStatement(node: AcornNode) {
      const guard = node as unknown as EstreeNode
      if (guard.test !== undefined && isEntryGuardCondition(guard.test)) {
        found = true
      }
    },
  })
  return found
}

/**
 * Classify one script source: `undefined` when compliant or out of scope (a
 * library that neither guards an entry nor runs its own pipeline, or an
 * unparseable file), else the defect kind. Runs `walkRecursive` with
 * function/class subtrees pruned, per the fleet's top-level entry
 * convention; the parser reads the `.mts` source directly. Pure — exported
 * for tests.
 */
export function classifyEntrySource(
  text: string,
): SelfDescribeDefect | undefined {
  // Running on import outranks the guard verdicts: a module that starts its
  // work at load time never reaches argv, so nothing a guard does downstream
  // can answer --describe.
  if (runsPipelineOnImport(text)) {
    return 'runs-on-import'
  }
  const verdicts: Array<SelfDescribeDefect | undefined> = []
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
    ignore: ['**/node_modules/**'],
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
    if (kind === 'runs-on-import' && RUNS_ON_IMPORT_ALLOWLIST.has(rel)) {
      continue
    }
    if (kind) {
      findings.push({ file: rel, kind })
    }
  }
  return findings
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every fleet/repo CLI entry script answers --describe and --help via runMain(main, meta)',
  help: 'Usage: node scripts/fleet/check/entry-scripts-are-self-describing.mts',
}

export function main(): number {
  const findings = scan()
  if (findings.length === 0) {
    logger.log('✔ every fleet/repo CLI entry self-describes')
    return 0
  }
  const noRunMain = findings.filter(f => f.kind === 'no-run-main')
  const noMeta = findings.filter(f => f.kind === 'no-meta')
  const onImport = findings.filter(f => f.kind === 'runs-on-import')
  if (noRunMain.length > 0) {
    logger.error(
      `entry-scripts-are-self-describing: ${noRunMain.length} entry script(s) never call the shared runner, so --describe/--help run the side effect instead of printing usage.`,
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
      `entry-scripts-are-self-describing: ${noMeta.length} runMain call(s) pass no ScriptMeta, so the runner has nothing to print for --describe/--help.`,
    )
    logger.error(
      '  Pass the second argument: `runMain(main, { describe, help })`.',
    )
    for (let i = 0, { length } = noMeta; i < length; i += 1) {
      logger.error(`  • ${noMeta[i]!.file}`)
    }
  }
  if (onImport.length > 0) {
    logger.error(
      `entry-scripts-are-self-describing: ${onImport.length} entry script(s) start their work at module scope, so --describe/--help never get a turn.`,
    )
    logger.error(
      '  Where: a top-level statement invoking main() — `main()`, `void main()`, `await main()`, or `export const run = main().catch(…)`.',
    )
    logger.error(
      '  Saw: the pipeline running on import; wanted: nothing running until the entry guard does.',
    )
    logger.error(
      '  Fix: export main, delete the module-scope invocation, and end the file with `if (isMainModule(import.meta.url)) { runMain(main, SCRIPT_META) }`.',
    )
    for (let i = 0, { length } = onImport; i < length; i += 1) {
      logger.error(`  • ${onImport[i]!.file}`)
    }
  }
  return 1
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
