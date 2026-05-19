/**
 * @file Per fleet "Code style" rule: the fleet has migrated to oxlint / oxfmt.
 *   References to `.eslintrc`, `eslint-config-*`, `biome.json`, or `@biomejs/*`
 *   in scripts / package.json / docs are stale — they'd mis-fire (point at a
 *   config that doesn't exist) or signal an incomplete migration. Detects:
 *   string literals naming the legacy configs / packages. The rule fires on
 *   TS/JS source — package.json + workflow YAML are caught by other tooling
 *   (the SBOM / dep scanners flag the package refs at install time). No
 *   autofix: the right replacement varies (drop the line, swap to
 *   `oxlint`/`oxfmt`, or rewrite a script invocation). Reporting only.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

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
  for (const re of FORBIDDEN_PACKAGE_RES) {
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
        '`{{ref}}` is a stale ESLint/Biome reference — the fleet runs oxlint + oxfmt. Drop the line or swap to the oxlint/oxfmt equivalent. (See `template/.config/oxlintrc.json` / `oxfmtrc.json` for the canonical configs.)',
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      Literal(node: AstNode) {
        const v = (node as { value?: unknown }).value
        if (typeof v !== 'string') return
        const hit = isForbiddenString(v)
        if (!hit) return
        context.report({
          node,
          messageId: 'staleConfig',
          data: { ref: hit },
        })
      },
      TemplateElement(node: AstNode) {
        const v = (node as { value?: { cooked?: string } }).value
        const cooked = v?.cooked
        if (typeof cooked !== 'string') return
        const hit = isForbiddenString(cooked)
        if (!hit) return
        context.report({
          node,
          messageId: 'staleConfig',
          data: { ref: hit },
        })
      },
    }
  },
}

export default rule
