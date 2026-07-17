/**
 * @file In `scripts/` and `.claude/hooks/`, forbid importing the fleet package
 *   that the current repo OWNS by its bare name — require the `-stable` alias
 *   instead. Why: a fleet repo that publishes `@socketsecurity/<X>` resolves
 *   the bare `@socketsecurity/<X>` specifier to its own local `src/` (workspace
 *   link), which is work-in-progress and may be mid-edit / broken. Build
 *   scripts and git-hooks must run against a KNOWN-GOOD published copy, so the
 *   fleet pins a `@socketsecurity/<X>-stable` catalog alias
 *   (`npm:@socketsecurity/<X>@<last published>`). Tooling imports the `-stable`
 *   alias; only the package's own source consumers use the bare name. Concrete
 *   failure this prevents: socket-lib's git-hooks imported
 *   `@socketsecurity/lib/logger/default` (bare). In socket-lib that resolves to
 *   local `src/`, so during a version straddle the subpath didn't exist yet and
 *   every commit threw `ERR_PACKAGE_PATH_NOT_EXPORTED`. The `-stable` alias
 *   would have resolved to the published package that has the subpath. Scope:
 *   files under `**∕scripts/**` or `**∕.claude/hooks/**`. The owned package
 *   name is read from the nearest ancestor `package.json` `name` field (walk-up
 *   from the linted file). Only flags imports of THAT exact package — e.g. in
 *   socket-lib, `@socketsecurity/lib/...` is flagged but
 *   `@socketsecurity/registry/...` is not (socket-lib doesn't own registry).
 *   Autofix: rewrite the specifier's package segment from `@scope/name` to
 *   `@scope/name-stable`, preserving the subpath:
 *   `@socketsecurity/lib/logger/default` →
 *   `@socketsecurity/lib-stable/logger/default`. ALSO flags a relative import
 *   that reaches into the repo's own `src/` tree (e.g.
 *   `../../src/packages/read.ts`) from scripts/ + hooks/ — same
 *   WIP-vs-published hazard, just spelled as a relative path instead of the
 *   bare package name. 2026-06-04: a post-build script imported
 *   `../../src/packages/read.ts` during the 6.0.7 straddle; the bundler choked
 *   on the source's extensionless imports. No autofix for the relative form
 *   (the src→stable subpath mapping isn't mechanical); the message points at
 *   the `-stable` equivalent. Per
 *   https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
 *   — give scripted/AI-driven tooling a deterministic, published dependency
 *   surface rather than a moving local-src target, so generated edits build
 *   against a stable contract.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

/**
 * Walk up from `startDir` to find the nearest `package.json` and return its
 * `name` field, or undefined if none is found / it has no name.
 */
function findOwnedPackageName(startDir: string): string | undefined {
  let dir = startDir
  // Stop at filesystem root.
  while (dir && dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (typeof pkg.name === 'string' && pkg.name) {
          return pkg.name
        }
      } catch {
        // Unreadable / malformed package.json — keep walking up.
      }
    }
    dir = path.dirname(dir)
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'In scripts/ + .claude/hooks/, import the repo-owned fleet package via its `-stable` alias, not the bare name (the bare name resolves to local src).',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferStable:
        '`{{specifier}}` imports the repo-owned package `{{owned}}` by its bare name. In scripts/ + .claude/hooks/ use the `{{owned}}-stable` alias — the bare name resolves to local `src/` (WIP), but tooling must run against the published snapshot. Fix: `{{fixed}}`.',
      noRelativeSrc:
        "`{{specifier}}` reaches into the repo's `src/` tree from scripts/ + .claude/hooks/. Tooling must run against the PUBLISHED `-stable` surface, never WIP src/ (a relative src/ import breaks during a version straddle when the file is mid-edit or its subpath is unpublished — ERR_PACKAGE_PATH_NOT_EXPORTED / ERR_MODULE_NOT_FOUND). Import the equivalent helper from `@socketsecurity/<owned>-stable/<subpath>` instead.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    const normalizedFilename = normalizePath(filename)
    // Only enforce on scripts/ + .claude/hooks/ paths. Test files in those
    // dirs are exempt — fixtures may intentionally reference the bare name.
    if (
      !/\/(?:\.claude\/hooks|scripts)\//.test(normalizedFilename) ||
      /\/test\//.test(normalizedFilename) ||
      /\.test\.(?:[mc]?[jt]s)$/.test(normalizedFilename)
    ) {
      return {}
    }

    const owned = findOwnedPackageName(path.dirname(normalizedFilename))
    // No owned name, or the owned name is already a `-stable` alias target
    // (shouldn't happen, but guard anyway) → nothing to enforce.
    if (!owned || owned.endsWith('-stable')) {
      return {}
    }

    // Match `<owned>` exactly or `<owned>/<subpath>` — not `<owned>-foo`.
    const ownedPrefix = `${owned}/`

    const checkSpecifier = (node: AstNode, raw: string): void => {
      // A relative import that climbs (one or more `../`) into a `src/` tree —
      // e.g. `../../src/packages/read.ts`. From a scripts/ or hooks/ file this
      // is a reach into the repo's WIP source. Layout-independent: we match the
      // climb-then-`src/` shape rather than resolving against a package root
      // (the file is already known to be under scripts/ or .claude/hooks/).
      if (/^(?:\.\.\/)+src\//.test(raw)) {
        context.report({
          node,
          messageId: 'noRelativeSrc',
          data: { specifier: raw },
        })
        return
      }
      if (raw !== owned && !raw.startsWith(ownedPrefix)) {
        return
      }
      // Build the `-stable` form: insert `-stable` after the package name,
      // before any subpath.
      const subpath = raw === owned ? '' : raw.slice(owned.length)
      const fixed = `${owned}-stable${subpath}`
      context.report({
        node,
        messageId: 'preferStable',
        data: { specifier: raw, owned, fixed },
        fix(fixer: RuleFixer) {
          // node.source is the string literal; replace its raw text including
          // quotes to preserve the original quote style.
          const quote = node.source.raw?.[0] ?? "'"
          return fixer.replaceText(node.source, `${quote}${fixed}${quote}`)
        },
      })
    }

    return {
      ImportDeclaration(node: AstNode) {
        if (node.source?.type === 'Literal') {
          checkSpecifier(node, String(node.source.value))
        }
      },
      ExportNamedDeclaration(node: AstNode) {
        if (node.source?.type === 'Literal') {
          checkSpecifier(node, String(node.source.value))
        }
      },
      ExportAllDeclaration(node: AstNode) {
        if (node.source?.type === 'Literal') {
          checkSpecifier(node, String(node.source.value))
        }
      },
    }
  },
}

export default rule
