/**
 * @file Shared helper for rule fixers that need to inject an `import { Name }
 *   from 'specifier'` statement (and optionally a matching hoisted `const`)
 *   into a file. Fixers call `summarizeImportTarget(programNode, importName)`
 *   to learn the file's current shape, then `appendImportFixes(...)` inside
 *   their `fix(fixer)` callback to add the missing pieces. ESLint's autofixer
 *   dedupes overlapping inserts at the same range, so multiple violations in
 *   the same file can each emit the import insertion safely — only one
 *   survives.
 */

import type { AstNode, RuleFixer } from '../lib/rule-types.mts'

export interface ImportSummary {
  hasImport: boolean
  hasLocal: boolean
  lastImport: AstNode | undefined
}

export type FixerOp = unknown

/**
 * Walk a Program node body once and figure out: - the last top-level
 * ImportDeclaration node (or undefined) - whether `importName` is already
 * imported (from ANY source) - whether a top-level `localName` identifier
 * already exists (any const/let/var or import-as-local with that name)
 *
 * Import detection ignores the specifier path: a file inside the lib package
 * itself imports `getDefaultLogger` from `'../logger'`, while a downstream repo
 * imports the same name from `'@socketsecurity/lib-stable/logger/default'`.
 * Both resolve to the same identifier; either should count as "already
 * imported" so the autofix doesn't inject a duplicate (and broken — see issue
 * #64). The match is by `importName` + `localName`, so the specifier path is
 * not a parameter.
 */
export function summarizeImportTarget(
  program: AstNode,
  importName: string,
  localName?: string | undefined,
): ImportSummary {
  let lastImport: AstNode | undefined
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
          (spec.type === 'ImportDefaultSpecifier' ||
            spec.type === 'ImportNamespaceSpecifier' ||
            spec.type === 'ImportSpecifier')
        ) {
          hasLocal = true
        }
      }
      continue
    }
    if (!localName) {
      continue
    }
    // A top-level `function localName(){}` / `class localName{}` (with or
    // without `export`) is also a binding that collides with an injected
    // import — e.g. a file with its own `function existsSync(){}` must not get
    // `import { existsSync } from 'node:fs'` hoisted above it (TS2440).
    const declNode =
      stmt.type === 'ExportDefaultDeclaration' ||
      stmt.type === 'ExportNamedDeclaration'
        ? (stmt.declaration ?? stmt)
        : stmt
    if (
      (declNode.type === 'ClassDeclaration' ||
        declNode.type === 'FunctionDeclaration') &&
      declNode.id &&
      declNode.id.type === 'Identifier' &&
      declNode.id.name === localName
    ) {
      hasLocal = true
      continue
    }
    // A top-level `const localName = ...` (with or without `export`).
    // The legacy walk only looked at bare `VariableDeclaration`; an
    // `export const logger = ...` is an `ExportNamedDeclaration`
    // whose `.declaration` is the VariableDeclaration. Missing that
    // branch caused the autofix to inject a duplicate
    // `const logger = ...` hoist into files that already exported
    // their own `logger` (see scripts/fleet/logger.mts
    // pre-fix — `export const logger = {...}` got an extra
    // `const logger = getDefaultLogger()` hoisted above it).
    const varDecl =
      stmt.type === 'VariableDeclaration'
        ? stmt
        : stmt.type === 'ExportNamedDeclaration' &&
            stmt.declaration &&
            stmt.declaration.type === 'VariableDeclaration'
          ? stmt.declaration
          : undefined
    if (!varDecl) {
      continue
    }
    for (const decl of varDecl.declarations) {
      if (
        decl.id &&
        decl.id.type === 'Identifier' &&
        decl.id.name === localName
      ) {
        hasLocal = true
      }
    }
  }
  return { hasImport, hasLocal, lastImport }
}

/**
 * Build the fixer-side inserts for missing import + optional hoist. Returns an
 * array of fixer operations the caller appends to its own fix() return value.
 *
 * Summary — output of summarizeImportTarget() fixer — the fixer passed to
 * context.report({ fix }) importLine — the literal `import { ... } from '...'`
 * text hoistLine — optional; the literal `const x = ...()` text.
 */
export function appendImportFixes(
  summary: ImportSummary,
  fixer: RuleFixer,
  importLine: string,
  hoistLine?: string | undefined,
): FixerOp[] {
  const ops: FixerOp[] = []
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
