/* oxlint-disable socket/no-package-manager-auto-update-reenable -- this file IS the rule definition; the re-enable strings are lookup-table data, not real usage. */

/**
 * @file Flag committed code / config that RE-ENABLES a package manager's
 *   auto-update — the inverse of the `package-manager-auto-update` hardening
 *   the fleet just landed. Auto-update is a supply-chain risk: it fetches and
 *   runs new package-manager versions outside the soak window and outside
 *   lockfile verification, so the fleet pins the disable knob ON. Re-enabling
 *   it (often slipped in via a setup script, dotfile, npmrc, or CI step)
 *   silently undoes that protection. Detected re-enable shapes, in tracked
 *   shell / script / config string literals:
 *
 *   - `HOMEBREW_NO_AUTO_UPDATE=0` / `=false` / `=no` / `=off` — Homebrew's
 *     disable env var negated back to a falsy value re-enables `brew update` on
 *     every install. Generalized: any `*_NO_AUTO_UPDATE` / `*_NO_UPDATE_CHECK`
 *     / `*_NO_UPDATE_NOTIFIER` env var set to a falsy value (covers
 *     `DENO_NO_UPDATE_CHECK=0`, `GATSBY_TELEMETRY_DISABLED`-style siblings).
 *   - npm / npmrc: `update-notifier=true` or `"update-notifier": true` — turns
 *     the version-check-and-prompt machinery back on.
 *   - Chocolatey: `choco feature enable -n autoUpdate` (any `-n` / `-n=` /
 *     `--name` spelling) re-enables the auto-update feature. Report-only — NO
 *     autofix. The disable knob can be re-enabled deliberately in a few
 *     legitimate places (a teardown that restores prior state, a doc example),
 *     and the deterministic linter can't tell "remove this line" from "flip it
 *     back to the hardened value" without the surrounding intent. The human
 *     picks: delete the re-enable, or restore the disable
 *     (`HOMEBREW_NO_AUTO_UPDATE=1`, `update-notifier=false`, `choco feature
 *     disable -n autoUpdate`). Scans plain string literals and expression-free
 *     template literals; mixed templates are inspected per static quasi.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

export interface ReenableMatch {
  knob: string
  hardened: string
}

const FALSY_VALUE = '(?:0|false|no|off)'

export const PATTERNS: ReadonlyArray<{
  re: RegExp
  knob: string
  hardened: string
}> = [
  {
    // HOMEBREW_NO_AUTO_UPDATE=0 / =false, and any *_NO_AUTO_UPDATE /
    // *_NO_UPDATE_CHECK / *_NO_UPDATE_NOTIFIER disable env var negated to a
    // falsy value. `export FOO=0`, `FOO=false cmd`, `FOO: "0"` all match.
    re: new RegExp(
      `\\b([A-Z][A-Z0-9_]*_NO_(?:AUTO_UPDATE|UPDATE_CHECK|UPDATE_NOTIFIER))\\b\\s*[:=]\\s*["']?${FALSY_VALUE}\\b`,
    ),
    knob: 'a *_NO_AUTO_UPDATE / *_NO_UPDATE_CHECK disable env var set to a falsy value',
    hardened: 'set it back to a truthy value (e.g. HOMEBREW_NO_AUTO_UPDATE=1)',
  },
  {
    // npmrc line form: update-notifier=true
    re: /\bupdate-notifier\s*=\s*true\b/,
    knob: 'update-notifier=true',
    hardened: 'update-notifier=false',
  },
  {
    // npm / JSON config form: "update-notifier": true
    re: /["']update-notifier["']\s*:\s*true\b/,
    knob: '"update-notifier": true',
    hardened: '"update-notifier": false',
  },
  {
    // choco feature enable -n autoUpdate / -n=autoUpdate / --name autoUpdate.
    // No `\b` around the `-n` / `--name` flag: a word boundary fails next to a
    // hyphen (`-` is a non-word char), so anchor the flag on whitespace and a
    // following `=` or space instead.
    re: /\bchoco\s+feature\s+enable\b[^\n]*(?:^|\s)(?:-n|--name)(?:\s+|\s*=\s*)["']?autoUpdate\b/i,
    knob: 'choco feature enable -n autoUpdate',
    hardened: 'choco feature disable -n autoUpdate',
  },
]

/**
 * Return the first re-enable pattern that matches anywhere in `value`, or
 * undefined when none do.
 */
export function findReenable(value: string): ReenableMatch | undefined {
  for (let i = 0, { length } = PATTERNS; i < length; i += 1) {
    const pattern = PATTERNS[i]!
    if (pattern.re.test(value)) {
      return { knob: pattern.knob, hardened: pattern.hardened }
    }
  }
  return undefined
}

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Flag config / code that re-enables a package manager's auto-update — the inverse of the package-manager-auto-update hardening. Auto-update fetches new versions outside the soak window and lockfile verification.",
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      reenabled:
        'Re-enables package-manager auto-update: {{knob}}. This undoes the package-manager-auto-update hardening — auto-update fetches new versions outside the soak window and lockfile verification. Fix: delete the line, or restore the disable ({{hardened}}).',
    },
    schema: [],
  },

  create(context: RuleContext) {
    function checkText(node: AstNode, value: string): void {
      const match = findReenable(value)
      if (!match) {
        return
      }
      context.report({
        node,
        messageId: 'reenabled',
        data: { hardened: match.hardened, knob: match.knob },
      })
    }

    return {
      Literal(node: AstNode) {
        if (typeof node.value !== 'string') {
          return
        }
        checkText(node, node.value)
      },
      TemplateLiteral(node: AstNode) {
        if (node.expressions.length !== 0) {
          // Mixed template — inspect each static quasi independently. An
          // interpolated value can't be statically scanned, so a knob whose
          // VALUE is interpolated escapes this rule by design.
          for (let i = 0, { length } = node.quasis; i < length; i += 1) {
            checkText(node, node.quasis[i]!.value.cooked)
          }
          return
        }
        checkText(node, node.quasis[0].value.cooked)
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
