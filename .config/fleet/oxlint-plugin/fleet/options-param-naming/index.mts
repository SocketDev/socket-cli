/*
 * @file The fleet options convention has two names, one per role: the PARAM
 *   that receives a caller's options bag is `options`, and the normalized local
 *   it produces is `opts` (`const opts = { __proto__: null, ...options }`).
 *   Keeping the two distinct makes the data flow legible — `options` is the raw
 *   untrusted input, `opts` is the null-proto-safe value every later line
 *   reads. The widespread anti-pattern this rule kills is naming the PARAM
 *   `opts` (so the raw input wears the "safe" name) and then often reassigning
 *   it in place (`function f(opts) { opts = { __proto__: null, ...opts } }`),
 *   which conflates the two roles under one name and reads as if the input were
 *   already normalized. `options-null-proto` is blind to this: it sees the
 *   `...opts` spread and passes. This rule is the naming half of the same
 *   convention — it flags a function whose options-bag param is named `opts`
 *   and renames the param (and its in-body reads) to `options`. After the
 *   rename, `options-null-proto` independently requires the `{ __proto__: null,
 *   ...options }` normalization, and the canonical local name `opts` is freed
 *   up for it. The two rules compose: naming here, prototype-safety there.
 *   Scope + exemptions:
 *
 *   - Only the param name `opts` is flagged (the established near-miss of
 *     `options`); other names like `cfg` / `settings` are out of scope — this
 *     enforces ONE convention, not a synonym hunt.
 *   - `.d.ts` files are skipped: they mirror external-package signatures
 *     (`pacote`, `tar-fs`, …) verbatim, and renaming a declared param there
 *     would diverge from the upstream type it documents.
 *   - Test files (`*.test.*`, `/test/`) are skipped: they author throwaway
 *     option-shaped helpers, not production option readers.
 *   - The rename is suppressed (report-only, no suggestion either) when the
 *     same function ALSO has a param literally named `options` — renaming
 *     `opts`→`options` there would collide. The author must resolve the
 *     two-name clash by hand. Bypass: a `socket-lint: allow
 *     options-param-naming` comment.
 *
 *   The remaining rename is `suggest`-only (`meta.hasSuggestions`, no
 *   `meta.fixable`) — `--fix` / `pnpm run fix` never auto-applies it.
 *   `hasCanonicalParam` only sees a SIBLING PARAM named `options`; it's blind
 *   to a pre-existing LOCAL `options` binding elsewhere in the same function
 *   body, which the mechanical param-only rename can't detect. A rollout that
 *   auto-applied this rewrite hit exactly that shape in acorn-style code —
 *   `export function getOptions(opts) { const options: any = {}; ... }` — and
 *   renamed the param `opts` → `options`, colliding with the function's own
 *   `const options` and producing `TS2300: Duplicate identifier 'options'`.
 *   Proving no such local exists anywhere in the function (including inside
 *   nested scopes the mechanical rename also walks) is a whole-function
 *   binding-resolution problem this per-param check doesn't do, so the safe
 *   default is report-only: the rewrite lands via an explicit
 *   `--fix-suggestions` pass or an editor code action, after a human confirms
 *   there's no colliding `options` binding in scope.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { makeBypassChecker } from '../../lib/comment-markers.mts'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const BYPASS_RE = /socket-lint:\s*allow\s+options-param-naming/

const BANNED_PARAM_NAME = 'opts'
const CANONICAL_PARAM_NAME = 'options'

// The param-name slot of a function param node. A plain `Identifier` (`opts`,
// `opts?`) yields its name; a param with a TS type annotation still surfaces as
// an `Identifier` with `.name`. Patterns (ObjectPattern/ArrayPattern) and rest
// elements have no single name and are ignored. Returns the Identifier node so
// the caller can both read `.name` and target it for a fix.
function bannedParamIdentifier(params: AstNode[]): AstNode | undefined {
  for (let i = 0, { length } = params; i < length; i += 1) {
    const p = params[i]
    if (p?.type === 'Identifier' && p.name === BANNED_PARAM_NAME) {
      return p
    }
  }
  return undefined
}

// True when a param literally named `options` already exists — renaming `opts`
// to `options` would collide, so the fix is suppressed and only a report fires.
function hasCanonicalParam(params: AstNode[]): boolean {
  for (let i = 0, { length } = params; i < length; i += 1) {
    const p = params[i]
    if (p?.type === 'Identifier' && p.name === CANONICAL_PARAM_NAME) {
      return true
    }
  }
  return false
}

// Type-position keys whose subtrees describe TYPES, not runtime values. An
// `opts` that appears inside one of these (e.g. the `opts` key of a
// `{ opts: number }` type literal, or `: typeof opts` ... ) names a TYPE
// member, never the value variable — renaming it would corrupt an unrelated
// type. Prune these subtrees entirely while walking.
const TYPE_SUBTREE_KEYS = new Set([
  'returnType',
  'typeAnnotation',
  'typeArguments',
  'typeParameters',
])

// Collect every `opts` Identifier USE inside a function: the param binding
// itself plus every read/write that references it. NOT references to the
// variable, so skipped: a `MemberExpression`'s non-computed property
// (`x.opts`), an object-literal key (`{ opts: 1 }`), and anything inside a
// TYPE annotation subtree (a `{ opts: number }` type literal, a `TSPropertySignature`
// key, etc.) — renaming those corrupts a property/type name that merely shares
// the spelling.
function collectOptsIdentifiers(root: AstNode): AstNode[] {
  const found: AstNode[] = []
  const visit = (n: AstNode | undefined, parent: AstNode | undefined): void => {
    if (!n || typeof n !== 'object') {
      return
    }
    // `x as T` / `x satisfies T` (`TSAsExpression` / `TSSatisfiesExpression`)
    // are NOT pure type contexts: the `.expression` is a runtime value (the
    // `...opts` in `{ ...opts } as typeof opts` is a real spread of the value),
    // while only `.typeAnnotation` is the type. Descend into BOTH — the
    // typeAnnotation because of the TSTypeQuery case below — so neither the
    // value spread nor the `typeof` operand is left dangling.
    if (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression') {
      visit(n.expression as AstNode, n)
      visit(n.typeAnnotation as AstNode, n)
      return
    }
    // `typeof opts` (a `TSTypeQuery`) is a type-position node BUT its operand
    // (`exprName`) references the runtime VALUE binding, not a type member — so
    // when the param `opts` is renamed, a `… as typeof opts` (the shape
    // options-null-proto emits) MUST follow or it dangles (`Cannot find name
    // 'opts'`). Descend into the exprName so that one `opts` gets renamed; the
    // generic `TS*` skip below still prunes genuine type members.
    if (n.type === 'TSTypeQuery') {
      visit(n.exprName as AstNode, n)
      return
    }
    // Any other `TS*` node introduces a pure type context; nothing inside is a
    // value ref.
    if (typeof n.type === 'string' && n.type.startsWith('TS')) {
      return
    }
    if (
      n.type === 'Identifier' &&
      n.name === BANNED_PARAM_NAME &&
      // Skip `x.opts` (a property name, not our variable).
      !(
        parent?.type === 'MemberExpression' &&
        parent.property === n &&
        !parent.computed
      ) &&
      // Skip `{ opts: ... }` shorthand-or-keyed property KEYS.
      !(parent?.type === 'Property' && parent.key === n && !parent.computed)
    ) {
      found.push(n)
    }
    const keyList = Object.keys(n)
    for (let j = 0, { length: jlen } = keyList; j < jlen; j += 1) {
      const key = keyList[j]!
      if (key === 'parent' || TYPE_SUBTREE_KEYS.has(key)) {
        continue
      }
      const child = (n as Record<string, unknown>)[key]
      if (Array.isArray(child)) {
        for (let i = 0, { length } = child; i < length; i += 1) {
          visit(child[i] as AstNode, n)
        }
      } else if (child && typeof child === 'object') {
        visit(child as AstNode, n)
      }
    }
  }
  visit(root, undefined)
  return found
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'The options-bag PARAM must be named `options` (the normalized local stays `opts`); `opts` as a param name conflates input with its null-proto-safe form.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: undefined,
    hasSuggestions: true,
    messages: {
      banned:
        'name the options-bag param `options`, not `opts` — `opts` is reserved for the normalized local (`const opts = { __proto__: null, ...options }`). Bypass: add a `socket-lint: allow options-param-naming` comment.',
      bannedNoFix:
        'name the options-bag param `options`, not `opts`, but a param named `options` already exists here — rename by hand to resolve the clash. Bypass: add a `socket-lint: allow options-param-naming` comment.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)

    // `.d.ts` mirrors external signatures; test files author throwaway helpers.
    // Neither is a production options reader the convention governs.
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (
      /\.d\.[cm]?ts$/.test(filename) ||
      /\.test\.[cm]?[jt]sx?$/.test(filename) ||
      /\/test\//.test(normalizePath(filename))
    ) {
      return {}
    }

    function check(node: AstNode): void {
      const params = node.params
      if (!Array.isArray(params)) {
        return
      }
      const banned = bannedParamIdentifier(params)
      if (!banned) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }

      // A clash with an existing `options` param means a mechanical rename would
      // shadow/collide — report without a fix and let the author resolve it.
      if (hasCanonicalParam(params)) {
        context.report({ node: banned, messageId: 'bannedNoFix' })
        return
      }

      // Rename the param binding plus every in-function reference uniformly.
      // After this the function reads `options`; `options-null-proto` then
      // independently demands the `{ __proto__: null, ...options }` spread, and
      // the freed name `opts` becomes that normalized local.
      //
      // Replace only the NAME token, not the whole node: a typed binding param
      // (`opts?: { cwd?: string }`) reports an Identifier whose range spans the
      // optional marker + type annotation, so a node-wide `replaceText` would
      // eat the type. The name always occupies `[start, start + 'opts'.length]`
      // — a reference use (`opts.a`) has that exact range, and a typed binding
      // has the annotation trailing past it. Clamp to the name length both ways.
      const refs = collectOptsIdentifiers(node)
      context.report({
        node: banned,
        messageId: 'banned',
        // `suggest`, not `fix` — see the file-level doc. `hasCanonicalParam`
        // only rules out a sibling PARAM named `options`; it can't see a
        // pre-existing LOCAL `options` binding in the function body, and
        // renaming into that collides (`TS2300: Duplicate identifier`).
        suggest: [
          {
            messageId: 'banned',
            fix(fixer: RuleFixer) {
              return refs.map(ref => {
                const start = ref.range?.[0] ?? ref.start
                return fixer.replaceTextRange(
                  [start, start + BANNED_PARAM_NAME.length],
                  CANONICAL_PARAM_NAME,
                )
              })
            },
          },
        ],
      })
    }

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
