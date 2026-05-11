/**
 * @fileoverview Shared helper for rule fixers that need to inject
 * an `import { Name } from 'specifier'` statement (and optionally a
 * matching hoisted `const`) into a file.
 *
 * Fixers call `summarizeImportTarget(programNode, specifier, importName)`
 * to learn the file's current shape, then `appendImportFixes(...)`
 * inside their `fix(fixer)` callback to add the missing pieces.
 *
 * ESLint's autofixer dedupes overlapping inserts at the same range,
 * so multiple violations in the same file can each emit the import
 * insertion safely — only one survives.
 */

/**
 * Build the fixer-side inserts for missing import + optional hoist.
 * Returns an array of fixer operations the caller appends to its own
 * fix() return value.
 *
 *   summary       — output of summarizeImportTarget()
 *   fixer         — the fixer passed to context.report({ fix })
 *   importLine    — the literal `import { ... } from '...'` text
 *   hoistLine     — optional; the literal `const x = ...()` text
 */
export function appendImportFixes(summary, fixer, importLine, hoistLine) {
  const ops = []
  if (!summary.hasImport) {
    if (summary.lastImport) {
      ops.push(fixer.insertTextAfter(summary.lastImport, `\n${importLine}`))
    } else {
      ops.push(fixer.insertTextBeforeRange([0, 0], `${importLine}\n`))
    }
  }
  if (hoistLine && !summary.hasLocal) {
    if (summary.lastImport) {
      ops.push(fixer.insertTextAfter(summary.lastImport, `\n\n${hoistLine}`))
    } else {
      ops.push(fixer.insertTextBeforeRange([0, 0], `${hoistLine}\n\n`))
    }
  }
  return ops
}

/**
 * Walk a Program node body once and figure out:
 *   - the last top-level ImportDeclaration node (or undefined)
 *   - whether `importName` is already imported (from ANY source)
 *   - whether a top-level `localName` identifier already exists
 *     (any const/let/var or import-as-local with that name)
 *
 * Import detection ignores the specifier path: a file inside the lib
 * package itself imports `getDefaultLogger` from `'../logger'`, while
 * a downstream repo imports the same name from
 * `'@socketsecurity/lib/logger'`. Both resolve to the same identifier;
 * either should count as "already imported" so the autofix doesn't
 * inject a duplicate (and broken — see issue #64).
 *
 * `specifier` is retained in the signature for backward compatibility
 * but is no longer used for the match decision. Callers may pass any
 * truthy value (typically the canonical package path the rule would
 * inject if the import were missing).
 */
export function summarizeImportTarget(
  program,
  // eslint-disable-next-line no-unused-vars
  specifier,
  importName,
  localName,
) {
  let lastImport
  let hasImport = false
  let hasLocal = false
  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration') {
      lastImport = stmt
      for (const spec of stmt.specifiers) {
        if (
          spec.type === 'ImportSpecifier' &&
          spec.imported &&
          spec.imported.name === importName
        ) {
          hasImport = true
        }
        if (
          localName &&
          spec.local &&
          spec.local.name === localName &&
          (spec.type === 'ImportSpecifier' ||
            spec.type === 'ImportDefaultSpecifier' ||
            spec.type === 'ImportNamespaceSpecifier')
        ) {
          hasLocal = true
        }
      }
      continue
    }
    if (localName && stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (
          decl.id &&
          decl.id.type === 'Identifier' &&
          decl.id.name === localName
        ) {
          hasLocal = true
        }
      }
    }
  }
  return { hasImport, hasLocal, lastImport }
}
