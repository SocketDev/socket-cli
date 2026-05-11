/* oxlint-disable socket/inclusive-language -- this file IS the rule definition; the legacy terms are lookup-table data, not real usage. */

/**
 * @fileoverview Per CLAUDE.md "Inclusive language" rule (full table
 * in docs/references/inclusive-language.md).
 *
 * Substitutions:
 *
 *   whitelist  → allowlist
 *   blacklist  → denylist
 *   master     → main / primary
 *   slave      → replica / secondary / worker
 *   grandfathered → legacy
 *   sanity check  → quick check
 *   dummy      → placeholder
 *
 * Detects identifiers, string literals, and comments containing the
 * legacy terms. Word-boundary matched on the literal stem so case
 * variants `Whitelist` / `WHITELIST` / `whitelisted` all fire.
 *
 * Autofix:
 *   - Identifiers and string literals: rewrite case-preserving
 *     (e.g. `Whitelist` → `Allowlist`, `WHITELIST` → `ALLOWLIST`,
 *     `whitelistEntry` → `allowlistEntry`).
 *   - Comments: rewrite the comment text in place, same case rules.
 *   - Multi-word terms (`sanity check`, `master branch`): only the
 *     first word is replaced; the rest is left alone (`sanity check`
 *     → `quick check`).
 *
 * Allowed exceptions (skipped — no report, no fix):
 *   - Third-party API field references: comment with
 *     `inclusive-language: external-api` adjacent to the line.
 *   - Vendored / fixture paths: handled at the .config/oxlintrc.json
 *     ignorePatterns level; this rule trusts the include set.
 *   - The literal phrase "main / primary" / etc. inside a doc that
 *     spells out the substitution table — handled by the
 *     `docs/references/inclusive-language.md` ignore pattern in
 *     .config/oxlintrc.json (caller adds the override).
 */

// [legacyStem, replacementStem]. The detector matches the stem
// case-insensitively and word-boundary anchored. Replacement preserves
// case shape.
const SUBSTITUTIONS = [
  ['whitelist', 'allowlist'],
  ['blacklist', 'denylist'],
  ['grandfathered', 'legacy'],
  ['sanity', 'quick'],
  ['dummy', 'placeholder'],
  // master/slave are loaded but rewriting requires more nuance — only
  // flag, never autofix (could mean main/primary/controller; depends
  // on the surrounding domain).
]

const REPORT_ONLY = new Set(['master', 'slave'])
const REPORT_ONLY_TERMS = ['master', 'slave']

const BYPASS_RE = /inclusive-language:\s*external-api/

/** Build a regex matching any legacy stem with word boundaries. */
function buildDetectorRegex() {
  const stems = [
    ...SUBSTITUTIONS.map(([legacy]) => legacy),
    ...REPORT_ONLY_TERMS,
  ]
  return new RegExp(`\\b(${stems.join('|')})\\w*`, 'gi')
}

const DETECTOR_RE = buildDetectorRegex()

/**
 * Replace a single hit `match` (e.g. `Whitelist`, `WHITELIST`,
 * `whitelisted`, `whitelistEntry`) with the case-preserving form of
 * the new stem. Returns undefined when there's no autofix-able
 * substitution (master/slave).
 */
function rewriteHit(match) {
  const lower = match.toLowerCase()
  for (const [legacy, replacement] of SUBSTITUTIONS) {
    if (!lower.startsWith(legacy)) {
      continue
    }
    const tail = match.slice(legacy.length)
    const original = match.slice(0, legacy.length)
    let rebuilt
    if (original === original.toUpperCase()) {
      rebuilt = replacement.toUpperCase()
    } else if (original[0] === original[0].toUpperCase()) {
      rebuilt = replacement[0].toUpperCase() + replacement.slice(1)
    } else {
      rebuilt = replacement
    }
    return rebuilt + tail
  }
  return undefined
}

function findHits(text) {
  const hits = []
  DETECTOR_RE.lastIndex = 0
  let m
  while ((m = DETECTOR_RE.exec(text)) !== null) {
    const stem = m[1].toLowerCase()
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      match: m[0],
      stem,
    })
  }
  return hits
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Use inclusive language. Replace whitelist/blacklist/master/slave/grandfathered/sanity/dummy per the fleet substitution table.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      legacy:
        '`{{match}}` — replace with the inclusive-language equivalent. See docs/references/inclusive-language.md.',
      legacyMaster:
        '`{{match}}` — replace with `main` (branch), `primary` / `controller` (process). Manual rewrite — context decides which fits.',
      legacySlave:
        '`{{match}}` — replace with `replica` / `worker` / `secondary` / `follower`. Manual rewrite — context decides which fits.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function hasBypassComment(node) {
      const before = sourceCode.getCommentsBefore(node)
      const after = sourceCode.getCommentsAfter(node)
      for (const c of [...before, ...after]) {
        if (BYPASS_RE.test(c.value)) {
          return true
        }
      }
      // Fall-back: scan the entire source line containing the node for
      // a trailing bypass comment. AST-level "after" comments stop at
      // the statement boundary, but a chained method call's string
      // literal won't see a trailing comment on the same physical line.
      const loc = node.loc
      if (loc && loc.start.line === loc.end.line) {
        const lineText = sourceCode.lines?.[loc.start.line - 1]
        if (lineText && BYPASS_RE.test(lineText)) {
          return true
        }
      }
      return false
    }

    function reportHit(node, hit, replaceFn) {
      let messageId = 'legacy'
      if (hit.stem === 'master') {
        messageId = 'legacyMaster'
      } else if (hit.stem === 'slave') {
        messageId = 'legacySlave'
      }
      const isReportOnly = REPORT_ONLY.has(hit.stem)
      const replacement = isReportOnly ? undefined : rewriteHit(hit.match)
      if (!replacement) {
        context.report({ node, messageId, data: { match: hit.match } })
        return
      }
      context.report({
        node,
        messageId,
        data: { match: hit.match },
        fix(fixer) {
          return replaceFn(fixer, hit, replacement)
        },
      })
    }

    function checkIdentifier(node) {
      if (!node.name) {
        return
      }
      const hits = findHits(node.name)
      if (hits.length === 0) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }
      // Identifiers can have multiple hits in compound names —
      // process each and merge into a single rewrite.
      let rebuilt = ''
      let cursor = 0
      let mutated = false
      let allReportOnly = true
      for (const h of hits) {
        rebuilt += node.name.slice(cursor, h.start)
        const replacement = REPORT_ONLY.has(h.stem)
          ? undefined
          : rewriteHit(h.match)
        if (replacement) {
          rebuilt += replacement
          mutated = true
          allReportOnly = false
        } else {
          rebuilt += h.match
        }
        cursor = h.end
      }
      rebuilt += node.name.slice(cursor)

      if (!mutated) {
        // All hits are report-only (master/slave) — emit one report
        // for each.
        for (const h of hits) {
          let messageId = 'legacy'
          if (h.stem === 'master') {
            messageId = 'legacyMaster'
          } else if (h.stem === 'slave') {
            messageId = 'legacySlave'
          }
          context.report({ node, messageId, data: { match: h.match } })
        }
        return
      }

      // Emit one report per hit but a single combined fix.
      const firstHit = hits[0]
      let messageId = 'legacy'
      if (firstHit.stem === 'master') {
        messageId = 'legacyMaster'
      } else if (firstHit.stem === 'slave') {
        messageId = 'legacySlave'
      }
      context.report({
        node,
        messageId,
        data: { match: firstHit.match },
        fix(fixer) {
          return fixer.replaceText(node, rebuilt)
        },
      })
    }

    return {
      Identifier: checkIdentifier,

      Literal(node) {
        if (typeof node.value !== 'string') {
          return
        }
        const hits = findHits(node.value)
        if (hits.length === 0) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }

        let rebuilt = ''
        let cursor = 0
        let mutated = false
        for (const h of hits) {
          rebuilt += node.value.slice(cursor, h.start)
          const replacement = REPORT_ONLY.has(h.stem)
            ? undefined
            : rewriteHit(h.match)
          if (replacement) {
            rebuilt += replacement
            mutated = true
          } else {
            rebuilt += h.match
          }
          cursor = h.end
        }
        rebuilt += node.value.slice(cursor)

        if (!mutated) {
          for (const h of hits) {
            let messageId = 'legacy'
            if (h.stem === 'master') {
              messageId = 'legacyMaster'
            } else if (h.stem === 'slave') {
              messageId = 'legacySlave'
            }
            context.report({ node, messageId, data: { match: h.match } })
          }
          return
        }

        const firstHit = hits[0]
        let messageId = 'legacy'
        if (firstHit.stem === 'master') {
          messageId = 'legacyMaster'
        } else if (firstHit.stem === 'slave') {
          messageId = 'legacySlave'
        }
        context.report({
          node,
          messageId,
          data: { match: firstHit.match },
          fix(fixer) {
            const raw = sourceCode.getText(node)
            const quote = raw[0]
            if (quote === '`') {
              return fixer.replaceText(node, '`' + rebuilt + '`')
            }
            const escaped = rebuilt.replace(
              new RegExp(`\\\\|${quote}`, 'g'),
              ch => '\\' + ch,
            )
            return fixer.replaceText(node, quote + escaped + quote)
          },
        })
      },

      Program() {
        // Sweep comments — rewriting comment bodies is harmless even
        // when literal text matches "legacy" examples, because the
        // bypass comment + ignorePatterns handle external-API and
        // vendored cases.
        const comments = sourceCode.getAllComments()
        for (const comment of comments) {
          if (BYPASS_RE.test(comment.value)) {
            continue
          }
          const hits = findHits(comment.value)
          if (hits.length === 0) {
            continue
          }

          let rebuilt = ''
          let cursor = 0
          let mutated = false
          for (const h of hits) {
            rebuilt += comment.value.slice(cursor, h.start)
            const replacement = REPORT_ONLY.has(h.stem)
              ? undefined
              : rewriteHit(h.match)
            if (replacement) {
              rebuilt += replacement
              mutated = true
            } else {
              rebuilt += h.match
            }
            cursor = h.end
          }
          rebuilt += comment.value.slice(cursor)

          if (!mutated) {
            for (const h of hits) {
              let messageId = 'legacy'
              if (h.stem === 'master') {
                messageId = 'legacyMaster'
              } else if (h.stem === 'slave') {
                messageId = 'legacySlave'
              }
              context.report({
                node: comment,
                messageId,
                data: { match: h.match },
              })
            }
            continue
          }

          const firstHit = hits[0]
          let messageId = 'legacy'
          if (firstHit.stem === 'master') {
            messageId = 'legacyMaster'
          } else if (firstHit.stem === 'slave') {
            messageId = 'legacySlave'
          }
          context.report({
            node: comment,
            messageId,
            data: { match: firstHit.match },
            fix(fixer) {
              const prefix = comment.type === 'Line' ? '//' : '/*'
              const suffix = comment.type === 'Line' ? '' : '*/'
              return fixer.replaceTextRange(
                comment.range,
                prefix + rebuilt + suffix,
              )
            },
          })
        }
      },
    }
  },
}

export default rule
