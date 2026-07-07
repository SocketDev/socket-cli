/*
 * @file Forbid barrel imports of Socket's cherry-picked packages
 *   (`@socketsecurity/lib`, `@socketsecurity/sdk`, `@socketregistry/packageurl-js`,
 *   and their `-stable` aliases). These publish fine-grained per-submodule leaves
 *   (`./arrays/join`, `./errors/message`, …) — a bare `<pkg>/<area>` that isn't a
 *   real single-segment export does not resolve at runtime
 *   (`ERR_PACKAGE_PATH_NOT_EXPORTED`), and a convenience-barrel alias
 *   (e.g. `./errors`) is being retired in favor of its leaf.
 *
 *   Per package, the ALLOWED bare areas are the package's real single-segment
 *   exports — env-swap routers (`logger`, `http-request`; node↔browser via the
 *   `browser` condition) plus genuine single-file/module leaves (`integrity`,
 *   `native-messaging`, `testing`, `exists`). Multi-segment leaves
 *   (`<area>/<sub>`) are always fine. The bare package (`<pkg>`, its `.` main) is
 *   fine. A convenience-barrel with a known 1:1 leaf autofixes (`errors` →
 *   `errors/message`).
 *
 *   Flagged: `@socketsecurity/lib/errors` (barrel → autofix `/errors/message`),
 *   `@socketsecurity/lib-stable/arrays` (no such bare export), etc.
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Per-owned-package policy. `allowed` = the real single-segment exports that are
// legitimate bare imports (env-swap routers + single-file/module leaves).
// `barrels` = a bare area to forbid mapped to its canonical leaf (autofixable
// because the mapping is 1:1). Keep `allowed` in lockstep with each package's
// actual single-segment `exports` keys (minus the barrels).
const OWNED: Readonly<
  Record<
    string,
    {
      allowed: readonly string[]
      barrels: Readonly<Record<string, string>>
    }
  >
> = {
  __proto__: null,
  '@socketregistry/packageurl-js': { allowed: ['exists'], barrels: {} },
  '@socketsecurity/lib': {
    allowed: ['http-request', 'integrity', 'logger', 'native-messaging'],
    barrels: { errors: 'errors/message' },
  },
  '@socketsecurity/sdk': { allowed: ['testing'], barrels: {} },
} as unknown as Record<
  string,
  { allowed: readonly string[]; barrels: Readonly<Record<string, string>> }
>

// `@scope/name[-stable]` then optional `/rest`.
const SPECIFIER_RE =
  /^(?<scope>@[^/]+)\/(?<name>[^/]+?)(?<stable>-stable)?(?:\/(?<rest>.+))?$/

const rule = {
  meta: {
    type: 'problem',
    docs: {
      category: 'Best Practices',
      description:
        "Import a Socket package's real submodule leaf, not a bare area barrel (these packages are cherry-picked — no aggregation barrels).",
      recommended: true,
    },
    fixable: 'code',
    messages: {
      barrelImport:
        '`{{specifier}}` imports the bare `{{pkg}}` area `{{area}}`, which is not a fine-grained ' +
        'export ({{reason}}). Import a specific submodule leaf (e.g. `{{pkg}}/{{area}}/<name>`). ' +
        'Allowed bare areas for this package: {{allowed}}.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    function check(node: AstNode): void {
      const source = node.source
      if (!source || typeof source.value !== 'string') {
        return
      }
      const specifier: string = source.value
      const match = SPECIFIER_RE.exec(specifier)
      if (!match?.groups) {
        return
      }
      const { name, rest, scope } = match.groups
      const canonical = `${scope}/${name}`
      const policy = OWNED[canonical]
      if (!policy) {
        return
      }
      // Bare package (its `.` main), or a multi-segment leaf (`area/sub`) — fine.
      if (!rest || rest.includes('/')) {
        return
      }
      const area = rest
      if (policy.allowed.includes(area)) {
        return
      }
      const leaf = policy.barrels[area]
      context.report({
        node: source,
        messageId: 'barrelImport',
        data: {
          allowed: policy.allowed.join(', ') || '(none)',
          area,
          pkg: canonical,
          reason: leaf
            ? 'a convenience barrel being retired'
            : 'no such single-segment export',
          specifier,
        },
        ...(leaf
          ? {
              fix(fixer: RuleFixer) {
                return fixer.replaceText(
                  source,
                  `'${specifier.replace(new RegExp(`/${area}$`), `/${leaf}`)}'`,
                )
              },
            }
          : {}),
      })
    }
    return {
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportDeclaration: check,
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
