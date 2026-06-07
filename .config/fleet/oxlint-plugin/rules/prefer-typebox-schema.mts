/**
 * @file Per CLAUDE.md "Code style": 🚨 `@sinclair/typebox` over zod / valibot /
 *   ajv. The fleet standardizes on TypeBox for runtime schema validation — one
 *   schema lib across the fleet keeps validators consistent and avoids dragging
 *   in a second validation runtime. Flags an `import … from 'zod' | 'valibot' |
 *   'ajv'` (and their subpaths, e.g. `ajv/dist/...`, `zod/lib/...`). Reporting
 *   only — no autofix, because the schema-building APIs differ (`z.object({…})`
 *   vs `Type.Object({…})`), so a mechanical import swap would leave broken call
 *   sites. Bypass: a `socket-lint: allow schema-lib` comment on the import
 *   (rare — e.g. a test fixture that must reproduce a zod-specific bug).
 */

import { makeBypassChecker } from '../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../lib/rule-types.mts'

// socket-lint: allow schema-lib -- opt-out for a genuine need (e.g. a fixture
// reproducing a zod/valibot/ajv-specific behavior).
const BYPASS_RE = /socket-lint:\s*allow\s+schema-lib/

// Banned schema-lib package roots. Matches the exact package or any subpath
// (`<pkg>` or `<pkg>/…`) so `ajv/dist/core` is caught too. `@hapi/joi` / `joi`
// included — same "second validation runtime" concern.
const BANNED_PKGS = ['zod', 'valibot', 'ajv', 'joi', '@hapi/joi', 'yup']

function bannedSpecifier(source: string): string | undefined {
  for (let i = 0, { length } = BANNED_PKGS; i < length; i += 1) {
    const pkg = BANNED_PKGS[i]!
    if (source === pkg || source.startsWith(`${pkg}/`)) {
      return pkg
    }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use @sinclair/typebox for runtime schema validation instead of zod / valibot / ajv / joi / yup. Per CLAUDE.md "Code style".',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        '`{{pkg}}` — the fleet standardizes on @sinclair/typebox for runtime schema validation (Type.Object({…})). A second validation runtime fragments the fleet; port the schema to TypeBox. Bypass: add a `socket-lint: allow schema-lib` comment if this import is genuinely required.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    return {
      ImportDeclaration(node: AstNode) {
        const source = node.source?.value
        if (typeof source !== 'string') {
          return
        }
        const pkg = bannedSpecifier(source)
        if (!pkg) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        context.report({ node, messageId: 'banned', data: { pkg } })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
