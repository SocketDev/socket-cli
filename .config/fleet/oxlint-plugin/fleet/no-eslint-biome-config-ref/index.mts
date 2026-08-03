/**
 * @file Per fleet "Code style" rule: the fleet has migrated to oxlint / oxfmt.
 *   References to `.eslintrc`, `eslint-config-*`, `biome.json`, or `@biomejs/*`
 *   in scripts / package.json / docs are stale — they'd mis-fire (point at a
 *   config that doesn't exist) or signal an incomplete migration. Detects:
 *   string literals naming the legacy configs / packages. The rule fires on
 *   TS/JS source — package.json + workflow YAML are caught by other tooling
 *   (the SBOM / dep scanners flag the package refs at install time). No
 *   autofix: the right replacement varies (drop the line, swap to
 *   `oxlint`/`oxfmt`, or rewrite a script invocation). Reporting only. **Test
 *   fixtures:** if a pattern-matching test reaches for a real package name that
 *   happens to start with `eslint-` / `biome` / `@biomejs/`, the rule fires on
 *   the test fixture even though it isn't a config ref. Use the documented
 *   neutral placeholder family `acme-*` (`acme-plugin-react`, `acme-foo`,
 *   `@acme/widget`) — same convention as `Acme Inc` for customer-name
 *   placeholders in [`fleet/public-surface-hygiene`]. They keep wildcard
 *   semantics intact without tripping the rule. Reserve the bypass comment for
 *   genuinely irreplaceable cases (e.g. testing the rule itself).
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import { isPluginSelfFile } from '../../lib/fleet-paths.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// socket-lint: allow eslint-biome-ref -- opt-out for a string that names a
// legacy tool as DATA (e.g. an allowlist of popular package names), not as a
// stale config reference.
const BYPASS_RE = /socket-lint:\s*allow\s+eslint-biome-ref/

const FORBIDDEN_REFS = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'biome.json',
  'biome.jsonc',
]

// Package names. Match prefixes for scoped families.
const FORBIDDEN_PACKAGE_RES = [
  /^eslint(?:-|$)/,
  /^@eslint\//,
  /^@biomejs\//,
  /^biome$/,
]

function isForbiddenString(s: string): string | undefined {
  if (FORBIDDEN_REFS.includes(s)) {
    return s
  }
  for (let i = 0, { length } = FORBIDDEN_PACKAGE_RES; i < length; i += 1) {
    const re = FORBIDDEN_PACKAGE_RES[i]!
    if (re.test(s)) {
      return s
    }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'ESLint / Biome config references are stale — the fleet runs oxlint + oxfmt. Drop the reference or swap to the oxlint/oxfmt equivalent.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      staleConfig:
        '`{{ref}}` is a stale ESLint/Biome reference — the fleet runs oxlint + oxfmt. Drop the line or swap to the oxlint/oxfmt equivalent. (See `template/.config/oxlintrc.json` / `oxfmtrc.json` for the canonical configs.) If this is a test fixture, rename to the neutral placeholder family `acme-*` (mirrors the `Acme Inc` convention from `fleet/public-surface-hygiene`).',
    },
    schema: [],
  },

  create(context: RuleContext) {
    // This rule's own source lists the banned config names as lookup-table
    // data and its test file exercises them as fixtures.
    if (isPluginSelfFile(context)) {
      return {}
    }
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    return {
      Literal(node: AstNode) {
        const v = (node as { value?: unknown | undefined }).value
        if (typeof v !== 'string') {
          return
        }
        const hit = isForbiddenString(v)
        if (!hit || hasBypassComment(node)) {
          return
        }
        context.report({
          node,
          messageId: 'staleConfig',
          data: { ref: hit },
        })
      },
      TemplateElement(node: AstNode) {
        const v = (
          node as { value?: { cooked?: string | undefined } | undefined }
        ).value
        const cooked = v?.cooked
        if (typeof cooked !== 'string') {
          return
        }
        const hit = isForbiddenString(cooked)
        if (!hit || hasBypassComment(node)) {
          return
        }
        context.report({
          node,
          messageId: 'staleConfig',
          data: { ref: hit },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
