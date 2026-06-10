/**
 * @file Prevent direct imports of platform-specific http-request entry points
 *   (`/node` or `/browser`) from outside the http-request module itself. Why:
 *   `src/http-request/node.ts` and `src/http-request/browser.ts` are platform
 *   implementations. The barrel `src/http-request/index.ts` (or the package
 *   export `http-request`) re-exports the right one via the package.json
 *   `"browser"` condition. Bundlers (rolldown, vite, webpack) and the Node
 *   resolver read that condition at build time; hard-coding `/node` or
 *   `/browser` defeats the condition and ships the wrong platform code in
 *   browser builds. Allowed:
 *
 *   - Any file INSIDE `http-request/` (they implement the barrel and may
 *     reference sibling files directly).
 *   - Importing the barrel itself (`from '...http-request'` or `from
 *     '../http-request/http-request'`) — the platform-agnostic path. Flagged:
 *   - `import { httpJson } from '../http-request/node'`
 *   - `import { httpJson } from '@socketsecurity/lib/http-request/node'`
 *   - `import { httpJson } from '../http-request/browser'` Autofix: rewrites the
 *     specifier to the canonical barrel path.
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Modules that have platform-specific node/browser entry points that
// callers must NOT import directly. Add new modules here when a /node +
// /browser split is introduced.
const PLATFORM_MODULES = ['http-request', 'logger'] as const

// Matches any specifier that ends with /<module>/node or /<module>/browser.
const modulePatternStr = PLATFORM_MODULES.join('|')
const PLATFORM_SUFFIX_RE = new RegExp(
  `\\/(${modulePatternStr})\\/(node|browser)(?:\\.(?:ts|js|mts|mjs|cts|cjs))?$`,
)

function canonicalSpecifier(specifier: string): string {
  return specifier.replace(
    new RegExp(`\\/(${modulePatternStr})\\/(node|browser)(\\..+)?$`),
    '/$1',
  )
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Import from the http-request barrel, not the platform-specific node/browser entry.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      platformImport:
        "Import '{{specifier}}' directly targets the '{{platform}}' platform implementation. " +
        "Use the barrel '{{fix}}' — the bundler resolves the correct platform via the " +
        "package.json 'browser' condition.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.getFilename?.() ?? context.filename ?? ''
    const normalizedFile = filename.replace(/\\/g, '/')
    // Files inside the platform-split module directories are exempt.
    if (PLATFORM_MODULES.some(m => normalizedFile.includes(`/${m}/`))) {
      return {}
    }

    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function hasBypassComment(node: AstNode): boolean {
      const before = sourceCode.getCommentsBefore(node)
      for (const c of before) {
        if (/no-platform-http-import\s*:/.test(c.value)) {
          return true
        }
      }
      return false
    }

    return {
      ImportDeclaration(node: AstNode) {
        const specifier: string = node.source.value
        const m = PLATFORM_SUFFIX_RE.exec(specifier)
        if (!m) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        const platform = m[1]!
        const fix = canonicalSpecifier(specifier)
        context.report({
          node: node.source,
          messageId: 'platformImport',
          data: { specifier, platform, fix },
          fix(fixer: RuleFixer) {
            return fixer.replaceText(node.source, `'${fix}'`)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
