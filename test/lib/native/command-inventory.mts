import { readFile } from 'node:fs/promises'
import path from 'node:path'

import parser from '@typescript-eslint/parser'

export type AstNode = {
  type: string
  [key: string]: unknown
}

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
export const SOURCE_ROOT = path.join(REPO_ROOT, 'src')

export const childNodes = (node: AstNode): AstNode[] =>
  Object.values(node)
    .flatMap(value => (Array.isArray(value) ? value : [value]))
    .filter(
      (value): value is AstNode =>
        !!value && typeof value === 'object' && 'type' in value,
    )

export const descendants = (node: AstNode): AstNode[] => {
  const children = childNodes(node)
  return children.flatMap(child => [child, ...descendants(child)])
}

export const literal = (node: AstNode): string => {
  if (node.type === 'Identifier') {
    return String((node as { name: string }).name)
  }
  if (
    node.type === 'Literal' &&
    typeof (node as { value: unknown }).value === 'string'
  ) {
    return String((node as { value: string }).value)
  }
  throw new Error(`Unsupported command registration key: ${node.type}`)
}

export const objectProperties = (node: AstNode): AstNode[] => {
  if (node.type !== 'ObjectExpression') {
    throw new Error(`Unsupported command registration object: ${node.type}`)
  }
  return (node as { properties: AstNode[] }).properties
}

export const propertyName = (node: AstNode): string => {
  if (node.type !== 'Property' || (node as { computed: boolean }).computed) {
    throw new Error(`Unsupported command registration property: ${node.type}`)
  }
  return literal((node as { key: AstNode }).key)
}

export const isNamedProperty = (node: AstNode, name: string): boolean => {
  if (node.type !== 'Property') {
    return false
  }
  const property = node as { computed: boolean; key: AstNode }
  if (property.computed) {
    return false
  }
  return (
    (property.key.type === 'Identifier' &&
      (property.key as { name: string }).name === name) ||
    (property.key.type === 'Literal' &&
      (property.key as { value: unknown }).value === name)
  )
}

export const parse = async (file: string): Promise<AstNode> => {
  const text = await readFile(file, 'utf8')
  return parser.parse(text, {
    sourceType: 'module',
    ecmaVersion: 'latest',
  }) as AstNode
}

export const declarationFor = (ast: AstNode, name: string): AstNode => {
  const statements = (ast as { body: AstNode[] }).body
  for (const statement of statements) {
    if (statement.type !== 'ExportNamedDeclaration') {
      continue
    }
    const decl = (statement as { declaration?: AstNode }).declaration
    if (decl?.type === 'VariableDeclaration') {
      for (const item of (decl as { declarations: AstNode[] }).declarations) {
        if (
          (item as { id: AstNode }).id.type === 'Identifier' &&
          (item as { id: { name: string } }).id.name === name
        ) {
          const init = (item as { init?: AstNode }).init
          if (init) {
            return init
          }
        }
      }
    }
  }
  throw new Error(`Could not resolve registered command ${name}`)
}

export const importedCommands = (
  ast: AstNode,
  file: string,
): Map<string, string> => {
  const imports = new Map<string, string>()
  for (const statement of (ast as { body: AstNode[] }).body) {
    if (statement.type !== 'ImportDeclaration') {
      continue
    }
    const source = (statement as { source: AstNode }).source
    const sourceName = literal(source)
    const resolved = path.resolve(path.dirname(file), sourceName)
    for (const specifier of (statement as { specifiers: AstNode[] })
      .specifiers) {
      if (specifier.type === 'ImportSpecifier') {
        const local = (specifier as { local: { name: string } }).local.name
        imports.set(local, resolved)
      }
    }
  }
  return imports
}

export const resolveCommand = async (
  file: string,
  name: string,
  imports: Map<string, string>,
): Promise<{ ast: AstNode; file: string; name: string }> => {
  const importedFile = imports.get(name)
  if (!importedFile) {
    throw new Error(`Unsupported command registration reference: ${name}`)
  }
  const ast = await parse(importedFile)
  declarationFor(ast, name)
  return { ast, file: importedFile, name }
}

/** Discovers canonical command paths from source registrations without importing commands. */
export const discoverNativeCommandPaths = async (
  sourceRoot = SOURCE_ROOT,
): Promise<string[]> => {
  const entry = path.join(sourceRoot, 'commands.mts')
  const ast = await parse(entry)
  const root = declarationFor(ast, 'rootCommands')
  const paths: string[] = []

  const walk = async (
    file: string,
    name: string,
    prefix: string,
  ): Promise<void> => {
    const command = await resolveCommand(
      file,
      name,
      importedCommands(await parse(file), file),
    )
    const registrations = descendants(command.ast).filter(node =>
      isNamedProperty(node, 'subcommands'),
    )
    if (registrations.length > 1) {
      throw new Error(
        `Ambiguous subcommand registrations for ${prefix}: ${registrations.length}`,
      )
    }
    const subcommands = registrations[0]
    if (!subcommands) {
      return
    }
    const nestedObject = (subcommands as { value: AstNode }).value
    for (const nested of objectProperties(nestedObject)) {
      const nestedName = propertyName(nested)
      const nestedValue = (nested as { value: AstNode }).value
      if (nestedValue.type !== 'Identifier') {
        throw new Error(
          `Unsupported nested command registration for ${prefix} ${nestedName}`,
        )
      }
      const nestedPath = `${prefix} ${nestedName}`
      paths.push(nestedPath)
      // Command tree traversal is intentionally sequential.
      // eslint-disable-next-line no-await-in-loop
      await walk(command.file, literal(nestedValue), nestedPath)
    }
  }

  for (const property of objectProperties(root)) {
    const commandPath = propertyName(property)
    const value = (property as { value: AstNode }).value
    if (value.type !== 'Identifier') {
      throw new Error(
        `Unsupported root command registration for ${commandPath}`,
      )
    }
    paths.push(commandPath)
    // Root command discovery is intentionally sequential.
    // eslint-disable-next-line no-await-in-loop
    await walk(entry, literal(value), commandPath)
  }
  return paths.sort((a, b) => a.localeCompare(b))
}
