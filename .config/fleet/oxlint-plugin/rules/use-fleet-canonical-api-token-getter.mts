/**
 * @file Per CLAUDE.md "Token hygiene → Socket API token env var" + the v6
 *   `secrets/socket-api-token` helper: reading the Socket API token directly
 *   from `process.env` misses the keychain fallback and the legacy-alias chain.
 *   Use `readSocketApiToken()` / `readSocketApiTokenSync()` from
 *   `@socketsecurity/lib-stable/secrets/socket-api-token`. Detects direct env
 *   reads:
 *
 *   - `process.env.SOCKET_API_TOKEN`
 *   - `process.env['SOCKET_API_TOKEN']`
 *   - `process.env.SOCKET_API_KEY` (legacy alias — also covered by
 *     `socket-api-token-env`, but flagged here for the helper-getter rewrite)
 *     Skipped (allowed):
 *   - Files at `src/secrets/...` — the helper itself + its implementation must
 *     read `process.env`.
 *   - Lines marked with `socket-api-token-getter: allow direct-env` adjacent
 *     comment — the bootstrap/setup hooks that legitimately read env before the
 *     lib helper is available (CI runners, install scripts). No autofix: the
 *     right import-path varies per consumer (`lib-stable` for downstream fleet
 *     repos, `lib` for socket-lib itself), and the right variant
 *     (`readSocketApiToken` vs `readSocketApiTokenSync`) depends on whether the
 *     caller is async-capable. Reporting only.
 */

import { makeBypassChecker } from '../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const FLAGGED_PROPERTIES = new Set(['SOCKET_API_KEY', 'SOCKET_API_TOKEN'])

const BYPASS_RE = /socket-api-token-getter:\s*allow direct-env/

export function isProcessEnv(node: AstNode): boolean {
  if (node.type !== 'MemberExpression') {
    return false
  }
  const obj = (node as { object?: AstNode | undefined }).object
  const prop = (node as { property?: AstNode | undefined }).property
  if (!obj || !prop) {
    return false
  }
  if (
    obj.type !== 'Identifier' ||
    (obj as { name?: string | undefined }).name !== 'process'
  ) {
    return false
  }
  if (
    prop.type !== 'Identifier' ||
    (prop as { name?: string | undefined }).name !== 'env'
  ) {
    return false
  }
  return true
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use readSocketApiToken / readSocketApiTokenSync from @socketsecurity/lib-stable/secrets/socket-api-token instead of process.env reads of SOCKET_API_TOKEN / SOCKET_API_KEY.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      directEnv:
        '`process.env.{{name}}` direct env read — use `readSocketApiToken()` / `readSocketApiTokenSync()` from @socketsecurity/lib-stable/secrets/socket-api-token. Direct env reads skip the keychain fallback. Bootstrap/setup code can suppress with `// socket-api-token-getter: allow direct-env`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename =
      (context as { filename?: string | undefined }).filename ??
      (
        context as { getFilename?: (() => string) | undefined }
      ).getFilename?.() ??
      ''

    if (/[\\/]src[\\/]secrets[\\/]/.test(filename)) {
      return {}
    }

    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)

    function reportName(node: AstNode, name: string) {
      if (hasBypassComment(node)) {
        return
      }
      context.report({
        node,
        messageId: 'directEnv',
        data: { name },
      })
    }

    return {
      MemberExpression(node: AstNode) {
        const obj = (node as { object?: AstNode | undefined }).object
        if (!obj || !isProcessEnv(obj)) {
          return
        }
        const prop = (node as { property?: AstNode | undefined }).property
        if (!prop) {
          return
        }
        const computed = (node as { computed?: boolean | undefined }).computed
        if (!computed && prop.type === 'Identifier') {
          const name = (prop as { name?: string | undefined }).name ?? ''
          if (FLAGGED_PROPERTIES.has(name)) {
            reportName(node, name)
          }
          return
        }
        if (computed && prop.type === 'Literal') {
          const v = (prop as { value?: unknown | undefined }).value
          if (typeof v === 'string' && FLAGGED_PROPERTIES.has(v)) {
            reportName(node, v)
          }
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
