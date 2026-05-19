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
          (node as { source?: { value?: string } }).source?.value !==
          'node:crypto'
        ) {
          return
        }
        const specs = (node as { specifiers?: AstNode[] }).specifiers ?? []
        for (const spec of specs) {
          if (
            spec.type === 'ImportDefaultSpecifier' &&
            (spec as { local?: { name?: string } }).local?.name === 'crypto'
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
        const name = (node as { name?: string }).name
        if (!name || !CRYPTO_NAMED_EXPORTS.has(name)) {
          return
        }
        const parent = (node as unknown as { parent?: AstNode }).parent
        if (!parent) {
          return
        }
        if (parent.type === 'ImportSpecifier') {
          return
        }
        if (
          parent.type === 'MemberExpression' &&
          (parent as { property?: AstNode }).property === node &&
          !(parent as { computed?: boolean }).computed
        ) {
          return
        }
        if (
          parent.type === 'Property' &&
          (parent as { key?: AstNode }).key === node &&
          !(parent as { computed?: boolean }).computed
        ) {
          return
        }
        if (
          parent.type === 'VariableDeclarator' &&
          (parent as { id?: AstNode }).id === node
        ) {
          return
        }
        if (
          (parent.type === 'FunctionDeclaration' ||
            parent.type === 'FunctionExpression' ||
            parent.type === 'ArrowFunctionExpression') &&
          Array.isArray((parent as { params?: AstNode[] }).params) &&
          (parent as { params: AstNode[] }).params.includes(node)
        ) {
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

export default rule
