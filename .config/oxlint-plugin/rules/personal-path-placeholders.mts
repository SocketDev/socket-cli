/**
 * @fileoverview Per CLAUDE.md "Token hygiene → Personal-path
 * placeholders" rule:
 *
 *   When a doc / test / comment needs to show an example user-home
 *   path, use the canonical platform-specific placeholder so the
 *   personal-paths scanner recognizes it as documentation:
 *     /Users/<user>/...     (macOS)
 *     /home/<user>/...      (Linux)
 *     C:\Users\<USERNAME>\... (Windows)
 *
 *   Don't drift to <name> / <me> / <USER> / <u> etc. — the scanner
 *   accepts anything in <...> but a fleet-wide audit relies on the
 *   canonical strings being grep-able.
 *
 * Detects user-home paths in string literals + comments where the
 * placeholder slug isn't the canonical form. The detection is
 * conservative: a string must clearly look like a user-home path
 * before the rule fires.
 *
 * Autofix: replaces the non-canonical placeholder with the canonical
 * one for the platform path prefix:
 *   /Users/<X>/      → /Users/<user>/
 *   /home/<X>/       → /home/<user>/
 *   C:\Users\<X>\    → C:\Users\<USERNAME>\
 *   C:/Users/<X>/    → C:/Users/<USERNAME>/
 *
 * Real personal data (a literal username instead of a placeholder)
 * is also flagged. Two scenarios:
 *
 *   1. Source code / docs / tests — the path was hand-written and
 *      should be replaced with the canonical placeholder, an env-var
 *      form (`$HOME`, `${USER}`, `%USERNAME%`), or deleted entirely.
 *   2. WASM / generated bundles — a literal username inside compiled
 *      output means a build pipeline is leaking the developer's path
 *      into the artifact (typically esbuild / rolldown sourcemaps,
 *      sourceMappingURL, or `__filename` baked at build time).
 *      The fix is the build config, NOT the artifact — chasing the
 *      string in the bundle is treating the symptom.
 *
 * The deterministic linter can't tell scenario 1 from scenario 2,
 * so it reports without an autofix. The AI-fix step (Step 4 of
 * `pnpm run fix`) handles both: rewriting source mentions for #1
 * and tracing back to the build config for #2.
 */

const PLACEHOLDER_RE = /<([^>]+)>/

const PATTERNS = [
  {
    // /Users/<X>/...
    re: /(\/Users\/)<([^>]+)>(\/|$)/,
    canonical: 'user',
    label: '/Users/<user>/',
  },
  {
    // /home/<X>/...
    re: /(\/home\/)<([^>]+)>(\/|$)/,
    canonical: 'user',
    label: '/home/<user>/',
  },
  {
    // C:\Users\<X>\... or C:/Users/<X>/
    re: /([A-Za-z]:[\\/]Users[\\/])<([^>]+)>([\\/]|$)/,
    canonical: 'USERNAME',
    label: 'C:\\Users\\<USERNAME>\\',
  },
]

/**
 * A real-username detection — a path of the same shape but with a
 * non-placeholder username segment. Reported, not fixed.
 */
const REAL_USERNAME_PATTERNS = [
  /(\/Users\/)([a-zA-Z][a-zA-Z0-9_-]{1,31})(\/)/,
  /(\/home\/)([a-zA-Z][a-zA-Z0-9_-]{1,31})(\/)/,
]

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use canonical personal-path placeholders (<user> on Unix, <USERNAME> on Windows). Drift breaks fleet-wide grep audits.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      drift:
        'Personal-path placeholder `<{{actual}}>` should be the canonical `<{{canonical}}>`. Saw `{{path}}`; expected the form `{{label}}`.',
      realUsername:
        'Personal path with literal username `{{name}}`. In source/docs: replace with placeholder `{{label}}`, an env-var form, or delete the path. In WASM / generated bundles: this is a build leak — fix the bundler config, not the artifact.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function checkText(textNode, text, isComment) {
      // First pass: drift detection — replace non-canonical
      // placeholders with the canonical form.
      let mutated = false
      let next = text
      let firstReport
      for (const p of PATTERNS) {
        const reAll = new RegExp(p.re.source, 'g')
        next = next.replace(reAll, (whole, prefix, slug, suffix) => {
          if (slug === p.canonical) {
            return whole
          }
          // Skip env-var forms — already canonical.
          if (/^\$|^%/.test(slug)) {
            return whole
          }
          if (!firstReport) {
            firstReport = {
              actual: slug,
              canonical: p.canonical,
              path: whole,
              label: p.label,
            }
          }
          mutated = true
          return `${prefix}<${p.canonical}>${suffix}`
        })
      }

      if (mutated && firstReport) {
        context.report({
          node: textNode,
          messageId: 'drift',
          data: firstReport,
          fix(fixer) {
            if (isComment) {
              const prefix = textNode.type === 'Line' ? '//' : '/*'
              const suffix = textNode.type === 'Line' ? '' : '*/'
              return fixer.replaceTextRange(
                textNode.range,
                prefix + next + suffix,
              )
            }
            const raw = sourceCode.getText(textNode)
            const quote = raw[0]
            if (quote === '`') {
              return fixer.replaceText(textNode, '`' + next + '`')
            }
            const escaped = next.replace(
              new RegExp(`\\\\|${quote}`, 'g'),
              ch => '\\' + ch,
            )
            return fixer.replaceText(textNode, quote + escaped + quote)
          },
        })
        return
      }

      // Second pass: real-username detection (no autofix).
      for (const re of REAL_USERNAME_PATTERNS) {
        const m = re.exec(text)
        if (!m) {
          continue
        }
        // Skip if the slug is a known placeholder shape (already
        // handled above), env-var, or canonical literal "user".
        const slug = m[2]
        if (slug === 'user' || slug === 'USERNAME') {
          continue
        }
        // Skip platform-canonical literals like "Shared".
        if (slug === 'Shared' || slug === 'Public') {
          continue
        }
        const label =
          re.source.indexOf('Users') !== -1 ? '/Users/<user>/' : '/home/<user>/'
        context.report({
          node: textNode,
          messageId: 'realUsername',
          data: { name: slug, label },
        })
        return
      }
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') {
          return
        }
        checkText(node, node.value, false)
      },
      TemplateLiteral(node) {
        if (node.expressions.length !== 0) {
          // Mixed template — only inspect the static parts.
          for (const q of node.quasis) {
            checkText(node, q.value.cooked, false)
          }
          return
        }
        checkText(node, node.quasis[0].value.cooked, false)
      },
      Program() {
        const comments = sourceCode.getAllComments()
        for (const comment of comments) {
          checkText(comment, comment.value, true)
        }
      },
    }
  },
}

export default rule
