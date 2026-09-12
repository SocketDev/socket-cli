/**
 * Extract every static import/require specifier from one source file, via a
 * real AST (`@babel/parser` + `@babel/traverse`) rather than a regex scan.
 * A regex-based extractor is what let wheelhouse's own deleted
 * scan-phantom-deps.mts, and independently pnpm/pnpm#13970, mistake a
 * type-only reference for a runtime one.
 *
 * Ported from nub's `nub-phantom-core::extract` (jdx/nub, MIT). Marks each
 * occurrence `typeOnly` when the import/export itself carries the `type`
 * keyword (`import type ...`, `import { type X }`, `export type { X }`);
 * a whole-file type surface (a `.d.ts` reached via the Types entry point)
 * is a graph-level concern, not an extract-level one - see graph.mts.
 */

import { parse } from '@babel/parser'
import babelTraverseImport from '@babel/traverse'

export type TraverseFn = (
  ast: unknown,
  visitors: Record<string, unknown>,
) => void

// `@babel/traverse`'s CJS default export lands nested under `.default` when
// required through Node's ESM/CJS interop - the imported binding's own
// `default` property is the traversal function, not the module itself.
const traverseModule: unknown = babelTraverseImport
const traverseCandidate =
  (typeof traverseModule === 'object' ||
    typeof traverseModule === 'function') &&
  traverseModule !== null &&
  'default' in traverseModule
    ? (traverseModule.default ?? traverseModule)
    : traverseModule

/**
 * The minimal slice of a source position this module needs. `@babel/traverse`
 * has no published types package in this workspace, so the AST is walked
 * against this local shape instead of `any` - narrow, but real.
 */
export interface Ranged {
  start: number | null
  end: number | null
}

export interface StringLiteralNode extends Ranged {
  type: 'StringLiteral'
  value: string
}

export interface SourceNode {
  source: Ranged & { type: string; value?: string | undefined }
}

export interface KindNode {
  importKind?: string | undefined
  exportKind?: string | undefined
}

export interface TryBlockNode {
  type: 'TryStatement'
  block: Ranged
}

export interface WalkPath<TNode> {
  node: TNode & Ranged
  findParent: (
    predicate: (path: WalkPath<unknown>) => boolean,
  ) => WalkPath<TryBlockNode> | null
  isTryStatement: () => boolean
}

export interface Occurrence {
  spec: string
  /**
   * Every occurrence of this specifier in the file is inside a try block.
   */
  soft: boolean
  /**
   * The import/export itself is type-only (`import type`, `export type`).
   */
  typeOnly: boolean
}

export interface OccurrenceInput {
  spec: string
  soft: boolean
  typeOnly: boolean
}

/**
 * Parse `content` (the file at `filePath`, used only to pick TS/JSX parser
 * plugins) and return every static import/require occurrence. Returns an
 * empty array on a parse failure - a file this scanner cannot read is a
 * miss, never a crash.
 */
export function extract(filePath: string, content: string): Occurrence[] {
  const occurrences: Occurrence[] = []
  const isTsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
  let ast
  try {
    ast = parse(content, {
      plugins: ['typescript', ...(isTsx ? (['jsx'] as const) : [])],
      sourceType: 'unambiguous',
    })
  } catch {
    return occurrences
  }

  const push = (input: OccurrenceInput): void => {
    occurrences.push(input)
  }

  const fromSource = (
    path: WalkPath<Partial<SourceNode> & KindNode>,
    kindField: 'importKind' | 'exportKind',
  ): void => {
    const { source } = path.node
    if (source?.type === 'StringLiteral' && typeof source.value === 'string') {
      push({
        soft: isInsideTryBlock(path),
        spec: source.value,
        typeOnly: path.node[kindField] === 'type',
      })
    }
  }

  traverse(ast, {
    CallExpression(
      path: WalkPath<{
        callee: { type: string; name?: string | undefined }
        arguments: unknown[]
      }>,
    ) {
      const { arguments: args, callee } = path.node
      const first = args[0]
      if (
        callee.type === 'Identifier' &&
        callee.name === 'require' &&
        args.length === 1 &&
        typeof first === 'object' &&
        first !== null &&
        'type' in first &&
        first.type === 'StringLiteral' &&
        'value' in first &&
        typeof first.value === 'string'
      ) {
        push({
          soft: isInsideTryBlock(path),
          spec: first.value,
          typeOnly: false,
        })
      }
    },
    ExportAllDeclaration(path: WalkPath<SourceNode & KindNode>) {
      fromSource(path, 'exportKind')
    },
    ExportNamedDeclaration(path: WalkPath<Partial<SourceNode> & KindNode>) {
      if (path.node.source) {
        fromSource(path, 'exportKind')
      }
    },
    ImportDeclaration(path: WalkPath<SourceNode & KindNode>) {
      fromSource(path, 'importKind')
    },
    ImportExpression(path: WalkPath<SourceNode>) {
      const { source } = path.node
      if (
        source?.type === 'StringLiteral' &&
        typeof source.value === 'string'
      ) {
        push({
          soft: isInsideTryBlock(path),
          spec: source.value,
          typeOnly: false,
        })
      }
    },
  })

  return occurrences
}

export function isInsideTryBlock(path: WalkPath<unknown>): boolean {
  const tryParent = path.findParent(p => p.isTryStatement())
  if (!tryParent) {
    return false
  }
  const { block } = tryParent.node
  const { end, start } = path.node
  return (
    start !== null &&
    end !== null &&
    block.start !== null &&
    block.end !== null &&
    start >= block.start &&
    end <= block.end
  )
}

export function traverse(
  ast: unknown,
  visitors: Record<string, unknown>,
): void {
  if (typeof traverseCandidate !== 'function') {
    throw new TypeError(
      'Cannot traverse source in phantom dependency extraction: expected a Babel traversal function. Reinstall dependencies.',
    )
  }
  Reflect.apply(traverseCandidate, undefined, [ast, visitors])
}
