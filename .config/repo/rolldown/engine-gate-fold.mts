/**
 * @file Rolldown plugin: precompute semver-vs-runtime engine gates in bundled
 *   code from the `engines.node` of the package being built. Vendored deps
 *   ship gates like `useNative = node.satisfies('>=16.7.0')` (the @npmcli/fs
 *   `lib/common/node.js` shape) that pick between a native API and a polyfill
 *   at require-time. Under a package whose `engines.node` floor already
 *   decides the gate, the check is constant — and the losing branch (usually
 *   the polyfill) is pure dead weight the bundler can't drop because the gate
 *   looks dynamic to the static analyzer. Motivating incident:
 *   socket-packageurl-js's bundled `dist/exists.js` crashed at require-time on
 *   exactly that vendored gate, whose false-branch polyfill never runs on the
 *   fleet floor. This plugin folds ONLY statically-safe shapes with
 *   string-literal ranges: `satisfies(process.version, 'R')` /
 *   `semver.satisfies(process.version, 'R')` and the comparator forms
 *   `gte|gt|lte|lt(process.version, 'V')` when the callee provably binds to
 *   the `semver` package, plus `helper.satisfies('R')` when the callee binding
 *   resolves to a vendored node-version helper module that is structurally
 *   verified to wrap `semver.satisfies(process.version, range)`. Verdicts come
 *   from semver interval math against `engines.node` (read once at plugin
 *   creation; the factory REFUSES to construct without a valid range):
 *   engines ⊆ gate-range → literal `true`; no intersection → literal `false`;
 *   partial overlap or any dynamic/non-literal input → untouched. Note the
 *   interval math is honest about unbounded floors: engines `>=18` admits a
 *   future node 99, so a `>=99` gate is a PARTIAL overlap (untouched), not a
 *   false fold — provable false verdicts come from upper-bounded gates
 *   (`lt(process.version, '18.0.0')` under `>=18`) or bounded engines unions
 *   (`^18 || ^20` vs `>=99`). The literal
 *   lets rolldown's DCE eliminate the dead branch and its polyfill imports.
 *   Silent transforms are banned: every folded site is logged (module id +
 *   gate source + verdict + the engines range that decided it).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import MagicString from 'magic-string'
import { parseAst } from 'rolldown/parseAst'
// socket-lint: allow bare-semver -- the fold verdicts are range ALGEBRA
// (validRange / subset / intersects), which the lib versions/* surface does
// not expose; this build-time plugin needs the upstream package directly.
import semver from 'semver'

import { langForId, matchesChain, memberPropName } from './define-guarded.mts'

import type { Plugin } from 'rolldown'

const logger = getDefaultLogger()

type AstNode = Record<string, unknown>

type ComparatorFn = 'gt' | 'gte' | 'lt' | 'lte'

// How a local binding participates in a gate, derived from top-level
// imports/requires only — nested or re-assigned bindings never classify, so a
// shadowed name can at worst leave a gate untouched, never mis-fold it.
type GateBinding =
  | { readonly kind: 'helper-module'; readonly spec: string }
  | { readonly kind: 'helper-satisfies'; readonly spec: string }
  | { readonly kind: 'semver-fn'; readonly fn: ComparatorFn | 'satisfies' }
  | { readonly kind: 'semver-module' }

type GateSite = {
  readonly end: number
  // Set when the verdict additionally requires the callee's source module to
  // verify as a node-version helper (resolved + checked lazily, cached).
  readonly helperSpec: string | undefined
  readonly range: string
  readonly start: number
}

const COMPARATOR_OPS = new Map<string, string>([
  ['gt', '>'],
  ['gte', '>='],
  ['lt', '<'],
  ['lte', '<='],
])
const SEMVER_GATE_FNS = new Set(['satisfies', ...COMPARATOR_OPS.keys()])
// Deep-function entry points: `require('semver/functions/satisfies')` etc.
const SEMVER_FUNCTION_SPEC =
  /^semver\/functions\/(satisfies|gte|gt|lte|lt)(?:\.js)?$/
const PROCESS_VERSION_SEGMENTS = ['process', 'version']

export type EngineGateFoldOptions = {
  /**
   * Directory holding the package.json of the package BEING BUILT — its
   * `engines.node` decides every fold verdict. Defaults to process.cwd()
   * builds run from the repo root.
   */
  readonly packageDir?: string | undefined
}

/**
 * Read the target package's engines.node once. The fold verdicts are only
 * meaningful relative to a declared runtime floor, so a missing or invalid
 * range is a hard refusal, not a silent no-op.
 */
export function readEnginesNode(packageDir: string): string {
  const pkgPath = path.join(packageDir, 'package.json')
  let engines: unknown
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<
      string,
      unknown
    >
    engines = (parsed['engines'] as Record<string, unknown> | undefined)?.[
      'node'
    ]
  } catch (e) {
    throw new Error(
      `engine-gate-fold: cannot read ${pkgPath} — fold verdicts are computed from engines.node, refusing to run without it`,
      { cause: e },
    )
  }
  if (typeof engines !== 'string' || !semver.validRange(engines)) {
    throw new Error(
      `engine-gate-fold: ${pkgPath} declares no valid engines.node range — fold verdicts are computed from it, refusing to run without one`,
    )
  }
  return engines
}

/**
 * Interval math for one gate: every version allowed by engines satisfies the
 * gate range → constant true; no allowed version satisfies it → constant
 * false; partial overlap, or an unparsable range → undefined = untouched.
 */
export function foldVerdict(
  enginesRange: string,
  gateRange: string,
): boolean | undefined {
  if (!semver.validRange(gateRange)) {
    return undefined
  }
  if (semver.subset(enginesRange, gateRange)) {
    return true
  }
  if (!semver.intersects(enginesRange, gateRange)) {
    return false
  }
  return undefined
}

// oxc emits `MemberExpression` in ESTree mode but older/native shapes use the
// Static/Computed split — tolerate all three, same posture as define-guarded.
function isMemberType(type: unknown): boolean {
  return (
    type === 'ComputedMemberExpression' ||
    type === 'MemberExpression' ||
    type === 'StaticMemberExpression'
  )
}

function stringLiteral(node: AstNode | undefined): string | undefined {
  if (node && node['type'] === 'Literal' && typeof node['value'] === 'string') {
    return node['value']
  }
  return undefined
}

// `require('<spec>')` with a single string-literal argument → the spec.
function requireSpec(node: AstNode | undefined): string | undefined {
  if (!node || node['type'] !== 'CallExpression') {
    return undefined
  }
  const callee = node['callee'] as AstNode | undefined
  if (
    !callee ||
    callee['type'] !== 'Identifier' ||
    callee['name'] !== 'require'
  ) {
    return undefined
  }
  const args = node['arguments'] as AstNode[] | undefined
  if (!Array.isArray(args) || args.length !== 1) {
    return undefined
  }
  return stringLiteral(args[0])
}

// A binding that holds a whole module's value (default/namespace import,
// `const x = require(spec)`).
function moduleBindingForSpec(spec: string): GateBinding | undefined {
  if (spec === 'semver') {
    return { kind: 'semver-module' }
  }
  const deepFn = SEMVER_FUNCTION_SPEC.exec(spec)
  if (deepFn) {
    return {
      fn: deepFn[1] as ComparatorFn | 'satisfies',
      kind: 'semver-fn',
    }
  }
  // Only relative specs are node-version-helper candidates: a vendored helper
  // lives next to its consumer; bare package specs stay unclassified.
  if (spec.startsWith('.')) {
    return { kind: 'helper-module', spec }
  }
  return undefined
}

// A binding that holds one named export, named import, destructured require.
function namedBindingForSpec(
  spec: string,
  importedName: string,
): GateBinding | undefined {
  if (spec === 'semver' && SEMVER_GATE_FNS.has(importedName)) {
    return {
      fn: importedName as ComparatorFn | 'satisfies',
      kind: 'semver-fn',
    }
  }
  if (spec.startsWith('.') && importedName === 'satisfies') {
    return { kind: 'helper-satisfies', spec }
  }
  return undefined
}

/**
 * Collect the module's top-level import/require bindings that can feed a gate.
 * Top-level only, on purpose: the classification is a whole-module fact, and
 * scanning nested scopes would let a local `const semver = somethingElse`
 * inside a function body masquerade as the package.
 */
export function collectGateBindings(
  program: AstNode,
): Map<string, GateBinding> {
  const bindings = new Map<string, GateBinding>()
  const body = program['body']
  if (!Array.isArray(body)) {
    return bindings
  }
  for (const rawStmt of body as AstNode[]) {
    // Unwrap `export const x = …` so ESM helper modules classify too.
    const stmt =
      rawStmt['type'] === 'ExportNamedDeclaration' && rawStmt['declaration']
        ? (rawStmt['declaration'] as AstNode)
        : rawStmt
    if (stmt['type'] === 'ImportDeclaration') {
      const spec = stringLiteral(stmt['source'] as AstNode | undefined)
      const specifiers = stmt['specifiers']
      if (spec === undefined || !Array.isArray(specifiers)) {
        continue
      }
      for (const s of specifiers as AstNode[]) {
        const local = (s['local'] as AstNode | undefined)?.['name']
        if (typeof local !== 'string') {
          continue
        }
        if (
          s['type'] === 'ImportDefaultSpecifier' ||
          s['type'] === 'ImportNamespaceSpecifier'
        ) {
          const binding = moduleBindingForSpec(spec)
          if (binding) {
            bindings.set(local, binding)
          }
        } else if (s['type'] === 'ImportSpecifier') {
          const imported = s['imported'] as AstNode | undefined
          const importedName =
            imported?.['type'] === 'Identifier'
              ? (imported['name'] as string)
              : stringLiteral(imported)
          if (typeof importedName !== 'string') {
            continue
          }
          const binding = namedBindingForSpec(spec, importedName)
          if (binding) {
            bindings.set(local, binding)
          }
        }
      }
      continue
    }
    if (stmt['type'] !== 'VariableDeclaration') {
      continue
    }
    const decls = stmt['declarations']
    if (!Array.isArray(decls)) {
      continue
    }
    for (const d of decls as AstNode[]) {
      if (d['type'] !== 'VariableDeclarator') {
        continue
      }
      const spec = requireSpec(d['init'] as AstNode | undefined)
      if (spec === undefined) {
        continue
      }
      const id = d['id'] as AstNode | undefined
      if (!id) {
        continue
      }
      if (id['type'] === 'Identifier') {
        const binding = moduleBindingForSpec(spec)
        if (binding) {
          bindings.set(id['name'] as string, binding)
        }
        continue
      }
      if (id['type'] !== 'ObjectPattern') {
        continue
      }
      const props = id['properties']
      if (!Array.isArray(props)) {
        continue
      }
      for (const p of props as AstNode[]) {
        // `const { satisfies } = require(spec)` / `{ satisfies: local }`.
        if (p['type'] !== 'Property' || p['computed'] === true) {
          continue
        }
        const key = p['key'] as AstNode | undefined
        const keyName =
          key?.['type'] === 'Identifier'
            ? (key['name'] as string)
            : stringLiteral(key)
        const value = p['value'] as AstNode | undefined
        if (typeof keyName !== 'string' || value?.['type'] !== 'Identifier') {
          continue
        }
        const binding = namedBindingForSpec(spec, keyName)
        if (binding) {
          bindings.set(value['name'] as string, binding)
        }
      }
    }
  }
  return bindings
}

// Classify one CallExpression against the collected bindings. Returns a gate
// site only for the statically-safe shapes; anything else is left alone.
function classifyGateCall(
  node: AstNode,
  bindings: Map<string, GateBinding>,
): GateSite | undefined {
  const callee = node['callee'] as AstNode | undefined
  const args = node['arguments'] as AstNode[] | undefined
  if (!callee || !Array.isArray(args)) {
    return undefined
  }
  let binding: GateBinding | undefined
  if (callee['type'] === 'Identifier') {
    binding = bindings.get(callee['name'] as string)
  } else if (isMemberType(callee['type'])) {
    const obj = callee['object'] as AstNode | undefined
    if (obj?.['type'] !== 'Identifier') {
      return undefined
    }
    const objBinding = bindings.get(obj['name'] as string)
    const prop = memberPropName(callee)
    if (!objBinding || prop === undefined) {
      return undefined
    }
    // Re-point a module binding at the member actually called.
    if (objBinding.kind === 'semver-module' && SEMVER_GATE_FNS.has(prop)) {
      binding = { fn: prop as ComparatorFn | 'satisfies', kind: 'semver-fn' }
    } else if (objBinding.kind === 'helper-module' && prop === 'satisfies') {
      binding = { kind: 'helper-satisfies', spec: objBinding.spec }
    } else {
      return undefined
    }
  } else {
    return undefined
  }
  if (!binding) {
    return undefined
  }
  const start = node['start'] as number
  const end = node['end'] as number
  if (binding.kind === 'helper-satisfies') {
    // `helper.satisfies('R')` — one literal arg, range semantics supplied by
    // the (verified) helper wrapping semver.satisfies(process.version, R).
    if (args.length !== 1) {
      return undefined
    }
    const range = stringLiteral(args[0])
    if (range === undefined) {
      return undefined
    }
    return { end, helperSpec: binding.spec, range, start }
  }
  if (binding.kind !== 'semver-fn') {
    return undefined
  }
  // Direct semver forms: exactly (process.version, 'literal'). An options
  // argument, or any extra, leaves the gate untouched — its prerelease
  // semantics aren't worth modeling here.
  if (
    args.length !== 2 ||
    !matchesChain(args[0] as AstNode, PROCESS_VERSION_SEGMENTS)
  ) {
    return undefined
  }
  const literal = stringLiteral(args[1])
  if (literal === undefined) {
    return undefined
  }
  if (binding.fn === 'satisfies') {
    return { end, helperSpec: undefined, range: literal, start }
  }
  // Comparator forms take a VERSION, not a range — normalize to the
  // equivalent range for the interval math.
  const version = semver.valid(literal)
  if (version === null) {
    return undefined
  }
  return {
    end,
    helperSpec: undefined,
    range: `${COMPARATOR_OPS.get(binding.fn)}${version}`,
    start,
  }
}

function collectGateSites(
  program: AstNode,
  bindings: Map<string, GateBinding>,
): GateSite[] {
  const sites: GateSite[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child)
      }
      return
    }
    const n = node as AstNode
    if (n['type'] === 'CallExpression') {
      const site = classifyGateCall(n, bindings)
      if (site) {
        sites.push(site)
        // Don't descend into a matched call — its arguments are part of the
        // span being replaced.
        return
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'end' || key === 'start') {
        continue
      }
      walk(n[key])
    }
  }
  walk(program)
  return sites
}

/**
 * Structurally verify a candidate node-version helper module (the @npmcli/fs
 * `lib/common/node.js` shape): it must define a single-purpose wrapper — one
 * parameter, whose whole body is `return semver.satisfies(process.version,
 * <param>, …)` with `semver` provably imported from the semver package — and
 * export that wrapper under the name `satisfies`. Anything looser (a range
 * transformed before the call, extra statements, a different export) fails
 * verification and the gate stays untouched.
 */
export function isNodeVersionHelperSource(code: string, id: string): boolean {
  let program: AstNode
  try {
    program = parseAst(code, { lang: langForId(id) }) as unknown as AstNode
  } catch {
    // Unparseable candidate — not a helper we can verify.
    return false
  }
  const bindings = collectGateBindings(program)
  const body = program['body']
  if (!Array.isArray(body)) {
    return false
  }
  const wrappers = new Set<string>()
  for (const rawStmt of body as AstNode[]) {
    const stmt =
      rawStmt['type'] === 'ExportNamedDeclaration' && rawStmt['declaration']
        ? (rawStmt['declaration'] as AstNode)
        : rawStmt
    if (stmt['type'] === 'FunctionDeclaration') {
      const name = (stmt['id'] as AstNode | undefined)?.['name']
      if (typeof name === 'string' && isSatisfiesWrapper(stmt, bindings)) {
        wrappers.add(name)
      }
      continue
    }
    if (stmt['type'] !== 'VariableDeclaration') {
      continue
    }
    const decls = stmt['declarations']
    if (!Array.isArray(decls)) {
      continue
    }
    for (const d of decls as AstNode[]) {
      const id2 = d['id'] as AstNode | undefined
      const init = d['init'] as AstNode | undefined
      if (
        id2?.['type'] === 'Identifier' &&
        init &&
        (init['type'] === 'ArrowFunctionExpression' ||
          init['type'] === 'FunctionExpression') &&
        isSatisfiesWrapper(init, bindings)
      ) {
        wrappers.add(id2['name'] as string)
      }
    }
  }
  if (wrappers.size === 0) {
    return false
  }
  return exportsSatisfiesWrapper(program, wrappers)
}

function isSatisfiesWrapper(
  fn: AstNode,
  bindings: Map<string, GateBinding>,
): boolean {
  const params = fn['params'] as AstNode[] | undefined
  const first = Array.isArray(params) ? params[0] : undefined
  if (first?.['type'] !== 'Identifier') {
    return false
  }
  const paramName = first['name'] as string
  const body = fn['body'] as AstNode | undefined
  if (!body) {
    return false
  }
  let returned: AstNode | undefined
  if (body['type'] === 'BlockStatement') {
    const stmts = body['body'] as AstNode[] | undefined
    // The whole body must be the one return — extra statements could rewrite
    // the range before the call.
    if (
      !Array.isArray(stmts) ||
      stmts.length !== 1 ||
      stmts[0]?.['type'] !== 'ReturnStatement'
    ) {
      return false
    }
    returned = stmts[0]?.['argument'] as AstNode | undefined
  } else {
    returned = body
  }
  if (!returned || returned['type'] !== 'CallExpression') {
    return false
  }
  const callee = returned['callee'] as AstNode | undefined
  if (!callee) {
    return false
  }
  let calleeIsSemverSatisfies = false
  if (callee['type'] === 'Identifier') {
    const b = bindings.get(callee['name'] as string)
    calleeIsSemverSatisfies = b?.kind === 'semver-fn' && b.fn === 'satisfies'
  } else if (isMemberType(callee['type'])) {
    const obj = callee['object'] as AstNode | undefined
    const b =
      obj?.['type'] === 'Identifier'
        ? bindings.get(obj['name'] as string)
        : undefined
    calleeIsSemverSatisfies =
      b?.kind === 'semver-module' && memberPropName(callee) === 'satisfies'
  }
  if (!calleeIsSemverSatisfies) {
    return false
  }
  const args = returned['arguments'] as AstNode[] | undefined
  if (!Array.isArray(args) || args.length < 2) {
    return false
  }
  if (!matchesChain(args[0] as AstNode, PROCESS_VERSION_SEGMENTS)) {
    return false
  }
  const rangeArg = args[1] as AstNode
  return rangeArg['type'] === 'Identifier' && rangeArg['name'] === paramName
}

// The helper must export the verified wrapper under the name `satisfies` —
// CJS (`module.exports = { satisfies }`, `exports.satisfies = fn`) or ESM
// (`export const satisfies = …`, `export { fn as satisfies }`).
function exportsSatisfiesWrapper(
  program: AstNode,
  wrappers: Set<string>,
): boolean {
  const body = program['body'] as AstNode[]
  for (const stmt of body) {
    if (stmt['type'] === 'ExportNamedDeclaration') {
      const decl = stmt['declaration'] as AstNode | undefined
      if (
        decl?.['type'] === 'FunctionDeclaration' &&
        (decl['id'] as AstNode | undefined)?.['name'] === 'satisfies' &&
        wrappers.has('satisfies')
      ) {
        return true
      }
      if (decl?.['type'] === 'VariableDeclaration') {
        for (const d of decl['declarations'] as AstNode[]) {
          if (
            (d['id'] as AstNode | undefined)?.['name'] === 'satisfies' &&
            wrappers.has('satisfies')
          ) {
            return true
          }
        }
      }
      const specs = stmt['specifiers'] as AstNode[] | undefined
      if (Array.isArray(specs)) {
        for (const s of specs) {
          const localName = (s['local'] as AstNode | undefined)?.['name']
          const exported = s['exported'] as AstNode | undefined
          const exportedName =
            exported?.['type'] === 'Identifier'
              ? (exported['name'] as string)
              : stringLiteral(exported)
          if (
            exportedName === 'satisfies' &&
            typeof localName === 'string' &&
            wrappers.has(localName)
          ) {
            return true
          }
        }
      }
      continue
    }
    if (stmt['type'] !== 'ExpressionStatement') {
      continue
    }
    const expr = stmt['expression'] as AstNode | undefined
    if (expr?.['type'] !== 'AssignmentExpression' || expr['operator'] !== '=') {
      continue
    }
    const left = expr['left'] as AstNode | undefined
    const right = expr['right'] as AstNode | undefined
    if (!left || !right) {
      continue
    }
    if (isModuleExports(left) && right['type'] === 'ObjectExpression') {
      for (const p of right['properties'] as AstNode[]) {
        if (p['type'] !== 'Property' || p['computed'] === true) {
          continue
        }
        const key = p['key'] as AstNode | undefined
        const keyName =
          key?.['type'] === 'Identifier'
            ? (key['name'] as string)
            : stringLiteral(key)
        const value = p['value'] as AstNode | undefined
        if (
          keyName === 'satisfies' &&
          value?.['type'] === 'Identifier' &&
          wrappers.has(value['name'] as string)
        ) {
          return true
        }
      }
      continue
    }
    if (isMemberType(left['type']) && memberPropName(left) === 'satisfies') {
      const obj = left['object'] as AstNode | undefined
      const objIsExports =
        obj?.['type'] === 'Identifier' && obj['name'] === 'exports'
      if (
        (objIsExports || (obj !== undefined && isModuleExports(obj))) &&
        right['type'] === 'Identifier' &&
        wrappers.has(right['name'] as string)
      ) {
        return true
      }
    }
  }
  return false
}

function isModuleExports(node: AstNode): boolean {
  if (!isMemberType(node['type'])) {
    return false
  }
  const obj = node['object'] as AstNode | undefined
  return (
    obj?.['type'] === 'Identifier' &&
    obj['name'] === 'module' &&
    memberPropName(node) === 'exports'
  )
}

// The slice of rolldown's TransformPluginContext the helper verification
// needs — kept structural so unit tests can hand in a stub resolver.
type HelperResolveCtx = {
  resolve?:
    | ((
        source: string,
        importer?: string | undefined,
      ) => Promise<{ external?: unknown; id: string } | null | undefined>)
    | undefined
}

async function verifyHelper(
  ctx: HelperResolveCtx | undefined,
  cache: Map<string, boolean>,
  spec: string,
  importer: string,
): Promise<boolean> {
  if (typeof ctx?.resolve !== 'function') {
    return false
  }
  let resolvedId: string | undefined
  try {
    const resolved = await ctx.resolve(spec, importer)
    if (resolved && !resolved.external) {
      resolvedId = resolved.id
    }
  } catch {
    // Unresolvable helper spec — the gate stays untouched.
    return false
  }
  if (resolvedId === undefined) {
    return false
  }
  // Strip any query suffix before touching the filesystem.
  const cleanPath = resolvedId.split('?')[0] ?? resolvedId
  const cached = cache.get(cleanPath)
  if (cached !== undefined) {
    return cached
  }
  let verified = false
  try {
    verified = isNodeVersionHelperSource(
      readFileSync(cleanPath, 'utf8'),
      cleanPath,
    )
  } catch {
    // Virtual / unreadable module id — can't verify, leave the gate alone.
    verified = false
  }
  cache.set(cleanPath, verified)
  return verified
}

/**
 * Build the engine-gate-fold rolldown plugin. Reads `engines.node` from
 * `packageDir`, default cwd, once and throws when it is missing or invalid —
 * the transform never runs against an undeclared runtime floor.
 */
export function createEngineGateFoldPlugin(
  options?: EngineGateFoldOptions | undefined,
): Plugin {
  const { packageDir = process.cwd() } = {
    __proto__: null,
    ...options,
  } as EngineGateFoldOptions
  const engines = readEnginesNode(packageDir)
  // One structural verification per vendored helper file per build.
  const helperCache = new Map<string, boolean>()
  return {
    name: 'engine-gate-fold',
    async transform(code, id, meta) {
      // Cheap bail: no gate shape can exist without one of these substrings.
      if (!code.includes('satisfies') && !code.includes('process.version')) {
        return undefined
      }
      let program: AstNode
      try {
        program = parseAst(code, { lang: langForId(id) }) as unknown as AstNode
      } catch {
        // Unparseable — leave the module to the main pipeline, which will
        // surface the real error.
        return undefined
      }
      const bindings = collectGateBindings(program)
      if (bindings.size === 0) {
        return undefined
      }
      const sites = collectGateSites(program, bindings)
      if (sites.length === 0) {
        return undefined
      }
      // Same native-MagicString handoff as define-guarded: rolldown passes a
      // Rust-backed instance on meta.magicString when the build opts into
      // experimental.nativeMagicString; fall back to the npm package.
      const native = (
        meta as unknown as { magicString?: MagicString | undefined } | undefined
      )?.magicString
      const ms = native ?? new MagicString(code)
      let folded = false
      for (const site of sites) {
        const verdict = foldVerdict(engines, site.range)
        if (verdict === undefined) {
          // Partial overlap or unparsable range — the gate stays a runtime
          // decision.
          continue
        }
        if (
          site.helperSpec !== undefined &&
          !(await verifyHelper(this, helperCache, site.helperSpec, id))
        ) {
          continue
        }
        ms.overwrite(site.start, site.end, String(verdict))
        folded = true
        // Silent transforms are banned: every folded gate is visible in the
        // build output.
        logger.info(
          `engine-gate-fold: ${id}: ${code.slice(site.start, site.end)} → ${verdict} (engines.node "${engines}")`,
        )
      }
      if (!folded) {
        return undefined
      }
      if (native) {
        return { code: ms as unknown as string }
      }
      return {
        code: ms.toString(),
        map: ms.generateMap({ hires: true }).toString(),
      }
    },
  }
}
