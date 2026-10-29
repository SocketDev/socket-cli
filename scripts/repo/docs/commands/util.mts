import path from 'node:path'

import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import { parseAst } from 'rolldown/parseAst'

export interface AstNode extends Record<string, unknown> {
  type: string
  arguments?: unknown | undefined
  body?: unknown | undefined
  callee?: unknown | undefined
  computed?: unknown | undefined
  consequent?: unknown | undefined
  declaration?: unknown | undefined
  declarations?: unknown | undefined
  elements?: unknown | undefined
  id?: unknown | undefined
  imported?: unknown | undefined
  init?: unknown | undefined
  key?: unknown | undefined
  kind?: unknown | undefined
  left?: unknown | undefined
  local?: unknown | undefined
  loc?: unknown | undefined
  name?: unknown | undefined
  object?: unknown | undefined
  operator?: unknown | undefined
  properties?: unknown | undefined
  property?: unknown | undefined
  right?: unknown | undefined
  source?: unknown | undefined
  specifiers?: unknown | undefined
  start?: unknown | undefined
  test?: unknown | undefined
  value?: unknown | undefined
}

export type SourceReader = (sourcePath: string) => string

export interface ParsedModule {
  path: string
  ast: AstNode
  imports: Map<string, { path: string; name: string }>
  declarations: Map<string, AstNode>
  exports: Map<string, AstNode>
}

export const isRecord = isPlainObject

export function isNode(value: unknown): value is AstNode {
  return isRecord(value) && typeof value['type'] === 'string'
}

export function nodeArray(value: unknown, message: string): AstNode[] {
  if (!Array.isArray(value) || !value.every(isNode)) {
    throw new Error(message)
  }
  return value
}

export function objectProperties(
  node: AstNode,
  sourcePath: string,
): Map<string, AstNode> {
  if (node['type'] !== 'ObjectExpression') {
    throw sourceError(sourcePath, node, 'expected a literal object')
  }
  const result = new Map<string, AstNode>()
  const properties = nodeArray(
    node['properties'],
    `${sourcePath}: invalid object`,
  )
  for (let index = 0, { length } = properties; index < length; index += 1) {
    const property = properties[index]
    if (property === undefined) {
      throw new Error(`${sourcePath}: invalid object property`)
    }
    if (
      property['type'] !== 'Property' ||
      property['computed'] === true ||
      property['kind'] !== 'init'
    ) {
      throw sourceError(sourcePath, property, 'dynamic object entry')
    }
    const key = staticPropertyKey(property['key'])
    if (key === undefined || result.has(key) || !isNode(property['value'])) {
      throw sourceError(sourcePath, property, 'invalid object entry')
    }
    result.set(key, property['value'])
  }
  return result
}

export function staticPropertyKey(value: unknown): string | undefined {
  if (!isNode(value)) {
    return undefined
  }
  if (value['type'] === 'Identifier' && typeof value['name'] === 'string') {
    return value['name']
  }
  if (value['type'] === 'Literal' && typeof value['value'] === 'string') {
    return value['value']
  }
  return undefined
}

export function stringLiteral(value: unknown): string | undefined {
  return isNode(value) &&
    value['type'] === 'Literal' &&
    typeof value['value'] === 'string'
    ? value['value']
    : undefined
}

export function identifierName(value: unknown): string | undefined {
  return isNode(value) &&
    value['type'] === 'Identifier' &&
    typeof value['name'] === 'string'
    ? value['name']
    : undefined
}

export function sourceError(
  sourcePath: string,
  node: AstNode,
  reason: string,
): Error {
  const loc =
    isRecord(node['loc']) && isRecord(node['loc']['start'])
      ? node['loc']['start']
      : undefined
  const line = loc && typeof loc['line'] === 'number' ? loc['line'] : 1
  return new Error(`${sourcePath}:${line}: ${reason}`)
}

export function visitAst(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      visitAst(child, visit)
    }
    return
  }
  if (!isNode(value)) {
    return
  }
  visit(value)
  const children = Object.values(value)
  for (let index = 0, { length } = children; index < length; index += 1) {
    const child = children[index]
    if (child === undefined) {
      continue
    }
    visitAst(child, visit)
  }
}

export function parseModule(
  sourcePath: string,
  sourceReader: SourceReader,
): ParsedModule {
  let source: string
  try {
    source = sourceReader(sourcePath)
  } catch {
    throw new Error(`${sourcePath}: source file is missing`)
  }
  let parsed: unknown
  try {
    parsed = parseAst(source, { lang: 'ts' }, sourcePath)
  } catch {
    throw new Error(`${sourcePath}: unable to parse source`)
  }
  if (!isNode(parsed) || parsed['type'] !== 'Program') {
    throw new Error(`${sourcePath}: unable to parse source`)
  }
  annotateSourceLocations(parsed, source)
  const imports = new Map<string, { path: string; name: string }>()
  const declarations = new Map<string, AstNode>()
  const exports = new Map<string, AstNode>()
  const body = nodeArray(parsed['body'], `${sourcePath}: invalid source body`)
  const context = { sourcePath, sourceReader, imports, declarations, exports }
  for (let index = 0, { length } = body; index < length; index += 1) {
    const statement = body[index]
    if (statement !== undefined) {
      collectStatement(statement, context)
    }
  }
  return { path: sourcePath, ast: parsed, imports, declarations, exports }
}

function annotateSourceLocations(root: AstNode, source: string): void {
  const lineOffsets = [0]
  for (let index = 0, { length } = source; index < length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      lineOffsets.push(index + 1)
    }
  }
  visitAst(root, node => {
    const loc = isRecord(node['loc']) ? node['loc'] : undefined
    const start =
      loc !== undefined && isRecord(loc['start']) ? loc['start'] : undefined
    const offset = node['start']
    if (
      (start !== undefined && typeof start['line'] === 'number') ||
      typeof offset !== 'number'
    ) {
      return
    }
    node['loc'] = { start: { line: lineForOffset(lineOffsets, offset) } }
  })
}

function lineForOffset(lineOffsets: number[], offset: number): number {
  let low = 0
  let high = lineOffsets.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const lineOffset = lineOffsets[middle]
    if (lineOffset !== undefined && lineOffset <= offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

interface ParseContext {
  sourcePath: string
  sourceReader: SourceReader
  imports: Map<string, { path: string; name: string }>
  declarations: Map<string, AstNode>
  exports: Map<string, AstNode>
}

function collectStatement(statement: AstNode, context: ParseContext): void {
  if (statement['type'] === 'ImportDeclaration') {
    collectImports(statement, context)
    return
  }
  collectDeclarations(statement, context)
}

function collectImports(statement: AstNode, context: ParseContext): void {
  const specifier = isNode(statement['source'])
    ? stringLiteral(statement['source'])
    : undefined
  if (specifier === undefined || !specifier.startsWith('.')) {
    return
  }
  let importedPath: string
  try {
    importedPath = resolveSourcePath(
      context.sourcePath,
      specifier,
      context.sourceReader,
    )
  } catch {
    throw sourceError(
      context.sourcePath,
      statement,
      `unresolved local import ${specifier}`,
    )
  }
  const importedBindings = nodeArray(
    statement['specifiers'],
    `${context.sourcePath}: invalid imports`,
  )
  for (
    let index = 0, { length } = importedBindings;
    index < length;
    index += 1
  ) {
    const imported = importedBindings[index]
    if (imported === undefined) {
      throw new Error(`${context.sourcePath}: invalid import binding`)
    }
    const local = identifierName(imported['local'])
    const importedName =
      imported['type'] === 'ImportDefaultSpecifier'
        ? 'default'
        : isNode(imported['imported'])
          ? staticPropertyKey(imported['imported'])
          : undefined
    if (local === undefined || importedName === undefined) {
      throw sourceError(
        context.sourcePath,
        imported,
        'unsupported import binding',
      )
    }
    context.imports.set(local, { path: importedPath, name: importedName })
  }
}

function collectDeclarations(statement: AstNode, context: ParseContext): void {
  const isExported = statement['type'] === 'ExportNamedDeclaration'
  const declaration = isExported ? statement['declaration'] : statement
  if (!isNode(declaration)) {
    return
  }
  if (declaration['type'] === 'VariableDeclaration') {
    const items = nodeArray(
      declaration['declarations'],
      `${context.sourcePath}: invalid declarations`,
    )
    for (let index = 0, { length } = items; index < length; index += 1) {
      const item = items[index]
      if (item === undefined) {
        throw new Error(`${context.sourcePath}: invalid declaration`)
      }
      const name = identifierName(item['id'])
      if (name !== undefined && isNode(item['init'])) {
        context.declarations.set(name, item['init'])
        if (isExported) {
          context.exports.set(name, item['init'])
        }
      }
    }
    return
  }
  if (declaration['type'] === 'FunctionDeclaration') {
    const name = identifierName(declaration['id'])
    if (name !== undefined) {
      context.declarations.set(name, declaration)
      if (isExported) {
        context.exports.set(name, declaration)
      }
    }
  }
}

export function resolveSourcePath(
  importer: string,
  specifier: string,
  sourceReader: SourceReader,
): string {
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  )
  const candidates = [resolved]
  if (resolved.endsWith('.mjs')) {
    candidates.push(`${resolved.slice(0, -4)}.mts`)
  } else if (resolved.endsWith('.js')) {
    candidates.push(`${resolved.slice(0, -3)}.ts`)
  } else if (!path.posix.extname(resolved)) {
    candidates.push(
      `${resolved}.mts`,
      `${resolved}.ts`,
      `${resolved}.mjs`,
      `${resolved}.js`,
    )
  }
  for (let index = 0, { length } = candidates; index < length; index += 1) {
    const candidate = candidates[index]
    if (candidate === undefined) {
      continue
    }
    try {
      sourceReader(candidate)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(`${importer}: unresolved local import ${specifier}`)
}
