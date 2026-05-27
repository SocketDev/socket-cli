/**
 * @file Per fleet style: `import crypto from 'node:crypto'` is the canonical
 *   default form (enforced by `prefer-node-builtin-imports`). When a file has
 *   the default import, bare references to named exports (`createHash`,
 *   `randomBytes`, etc.) are undefined identifiers — `ReferenceError` at
 *   runtime. This rule catches the half-converted state that
 *   `prefer-node-builtin-imports` leaves behind when it rewrites the import but
 *   not the call sites. Detects bare references to known `node:crypto` named
 *   exports in a file that imports `crypto` with the default form (`import
 *   crypto from 'node:crypto'`). Autofix: rewrites `createHash(` →
 *   `crypto.createHash(`, etc. Skipped: files that don't import `node:crypto`
 *   at all, files that use the named-import form (`import { createHash } from
 *   'node:crypto'`) — those are caught by `prefer-node-builtin-imports`.
 */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

// Stable subset of node:crypto named exports we want to catch. Add more as
// fleet usage grows; missing entries are silent rather than wrong.
const CRYPTO_NAMED_EXPORTS = new Set([
  'createCipher',
  'createCipheriv',
  'createDecipher',
  'createDecipheriv',
  'createDiffieHellman',
  'createECDH',
  'createHash',
  'createHmac',
  'createPrivateKey',
  'createPublicKey',
  'createSecretKey',
  'createSign',
  'createVerify',
  'diffieHellman',
  'generateKeyPair',
  'generateKeyPairSync',
  'getCiphers',
  'getCurves',
  'getDiffieHellman',
  'getHashes',
  'hash',
  'hkdf',
  'hkdfSync',
  'pbkdf2',
  'pbkdf2Sync',
  'privateDecrypt',
  'privateEncrypt',
  'publicDecrypt',
  'publicEncrypt',
  'randomBytes',
  'randomFillSync',
  'randomInt',
  'randomUUID',
  'scrypt',
  'scryptSync',
  'sign',
  'subtle',
  'timingSafeEqual',
  'verify',
  'webcrypto',
])

/**
 * Collect the names bound by a single statement-list element (a declaration).
 * Covers the forms that can shadow a crypto export name in practice: `const` /
 * `let` / `var` declarators (incl. simple destructuring), function + class
 * declarations. Not exhaustive ESTree binding analysis — just enough to tell a
 * local variable named `hash` apart from a bare `node:crypto` export
 * reference.
 */
export function collectDeclaredNames(stmt: AstNode, out: Set<string>): void {
  if (!stmt || typeof stmt.type !== 'string') {
    return
  }
  if (stmt.type === 'VariableDeclaration') {
    const decls = Array.isArray(stmt.declarations) ? stmt.declarations : []
    for (let i = 0, { length } = decls; i < length; i += 1) {
      const id = decls[i]?.id
      if (id?.type === 'Identifier' && typeof id.name === 'string') {
        out.add(id.name)
      } else if (id?.type === 'ObjectPattern') {
        const props = Array.isArray(id.properties) ? id.properties : []
        for (let j = 0, plen = props.length; j < plen; j += 1) {
          const val = props[j]?.value
          if (val?.type === 'Identifier' && typeof val.name === 'string') {
            out.add(val.name)
          }
        }
      } else if (id?.type === 'ArrayPattern') {
        const els = Array.isArray(id.elements) ? id.elements : []
        for (let j = 0, elen = els.length; j < elen; j += 1) {
          const el = els[j]
          if (el?.type === 'Identifier' && typeof el.name === 'string') {
            out.add(el.name)
          }
        }
      }
    }
    return
  }
  if (
    (stmt.type === 'ClassDeclaration' || stmt.type === 'FunctionDeclaration') &&
    stmt.id?.type === 'Identifier' &&
    typeof stmt.id.name === 'string'
  ) {
    out.add(stmt.id.name)
  }
}

/**
 * Add the parameter names of a function-like node to `out`. Handles plain
 * identifier params and the common `{ a }` / `[a]` / `a = default` / `...rest`
 * wrappers — enough to recognize a param shadowing a crypto export name.
 */
export function collectParamNames(fn: AstNode, out: Set<string>): void {
  const params = Array.isArray(fn?.params) ? fn.params : []
  for (let i = 0, { length } = params; i < length; i += 1) {
    let p = params[i]
    if (p?.type === 'AssignmentPattern') {
      p = p.left
    }
    if (p?.type === 'RestElement') {
      p = p.argument
    }
    if (p?.type === 'Identifier' && typeof p.name === 'string') {
      out.add(p.name)
    }
  }
}

/**
 * Walk the ancestor chain from `node` and return true if `name` resolves to a
 * binding declared in an enclosing scope (a local variable, function/class
 * name, or function parameter) rather than to the bare `node:crypto` export.
 * This is what stops the rule flagging a `const hash = ...; hash.update()`
 * local as if `hash` were the crypto `hash` export.
 */
export function resolvesToLocalBinding(node: AstNode, name: string): boolean {
  let current: AstNode = node
  while (current) {
    const parent: AstNode = current.parent
    if (!parent) {
      break
    }
    // Block / program / module scope: scan sibling statements for a binding.
    if (
      parent.type === 'BlockStatement' ||
      parent.type === 'Program' ||
      parent.type === 'StaticBlock'
    ) {
      const body = Array.isArray(parent.body) ? parent.body : []
      const declared = new Set<string>()
      for (let i = 0, { length } = body; i < length; i += 1) {
        collectDeclaredNames(body[i], declared)
      }
      if (declared.has(name)) {
        return true
      }
    }
    // Function scope: its params bind names for the whole body.
    if (
      parent.type === 'ArrowFunctionExpression' ||
      parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression'
    ) {
      const declared = new Set<string>()
      collectParamNames(parent, declared)
      if (declared.has(name)) {
        return true
      }
    }
    current = parent
  }
  return false
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Bare reference to a node:crypto named export with `import crypto from 'node:crypto'` in scope — runtime ReferenceError. Use `crypto.<name>(...)`.",
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      bareNamed:
        '`{{name}}` is a node:crypto named export but the file imports `crypto` as a default. Either reference as `crypto.{{name}}` (fleet style; auto-fixable) or change the import to a named form.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    let hasDefaultCryptoImport = false

    return {
      ImportDeclaration(node: AstNode) {
        if (
          (node as { source?: { value?: string | undefined } | undefined })
            .source?.value !== 'node:crypto'
        ) {
          return
        }
        const specs =
          (node as { specifiers?: AstNode[] | undefined }).specifiers ?? []
        for (let i = 0, { length } = specs; i < length; i += 1) {
          const spec = specs[i]!
          if (
            spec.type === 'ImportDefaultSpecifier' &&
            (spec as { local?: { name?: string | undefined } | undefined })
              .local?.name === 'crypto'
          ) {
            hasDefaultCryptoImport = true
            return
          }
        }
      },
      Identifier(node: AstNode) {
        if (!hasDefaultCryptoImport) {
          return
        }
        const name = (node as { name?: string | undefined }).name
        if (!name || !CRYPTO_NAMED_EXPORTS.has(name)) {
          return
        }
        const parent = (node as unknown as { parent?: AstNode | undefined })
          .parent
        if (!parent) {
          return
        }
        if (parent.type === 'ImportSpecifier') {
          return
        }
        if (
          parent.type === 'MemberExpression' &&
          (parent as { property?: AstNode | undefined }).property === node &&
          !(parent as { computed?: boolean | undefined }).computed
        ) {
          return
        }
        if (
          parent.type === 'Property' &&
          (parent as { key?: AstNode | undefined }).key === node &&
          !(parent as { computed?: boolean | undefined }).computed
        ) {
          return
        }
        if (
          parent.type === 'VariableDeclarator' &&
          (parent as { id?: AstNode | undefined }).id === node
        ) {
          return
        }
        if (
          (parent.type === 'ArrowFunctionExpression' ||
            parent.type === 'FunctionDeclaration' ||
            parent.type === 'FunctionExpression') &&
          Array.isArray(
            (parent as { params?: AstNode[] | undefined }).params,
          ) &&
          (parent as { params: AstNode[] }).params.includes(node)
        ) {
          return
        }
        // A local variable / param / function named like a crypto export (e.g.
        // `const hash = crypto.createHash(...); hash.update(...)`) is a
        // reference to that binding, not a bare export — don't flag or rewrite.
        if (resolvesToLocalBinding(node, name)) {
          return
        }
        context.report({
          node,
          messageId: 'bareNamed',
          data: { name },
          fix(fixer: RuleFixer) {
            return fixer.replaceText(node, `crypto.${name}`)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
