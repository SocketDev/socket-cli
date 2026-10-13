import {
  identifierName,
  isNode,
  nodeArray,
  objectProperties,
  parseModule,
  sourceError,
  stringLiteral,
} from './docs-command-inventory-lib.mts'
import { extractCustomRoutes } from './docs-command-custom-routes.mts'

import type { CustomRouteKind } from './docs-command-custom-routes.mts'

import type {
  AstNode,
  ParsedModule,
  SourceReader,
} from './docs-command-inventory-lib.mts'

export interface CommandAlias {
  alias: string
  target: string
}

export interface CommandInventory {
  commands: string[]
  aliases: CommandAlias[]
}

function objectProperty(
  object: AstNode,
  propertyName: string,
  sourcePath: string,
): AstNode | undefined {
  return objectProperties(object, sourcePath).get(propertyName)
}

function literalStringArray(node: AstNode, sourcePath: string): string[] {
  if (node.type !== 'ArrayExpression') {
    throw sourceError(sourcePath, node, 'expected a literal array')
  }
  const values = nodeArray(
    node['elements'],
    `${sourcePath}: invalid array`,
  ).map(stringLiteral)
  if (values.some(value => value === undefined)) {
    throw sourceError(sourcePath, node, 'expected literal string values')
  }
  return values.filter((value): value is string => value !== undefined)
}

function moduleFor(
  sourcePath: string,
  reader: SourceReader,
  cache: Map<string, ParsedModule>,
): ParsedModule {
  const cached = cache.get(sourcePath)
  if (cached !== undefined) {
    return cached
  }
  const parsed = parseModule(sourcePath, reader)
  cache.set(sourcePath, parsed)
  return parsed
}

function importedExport(
  module: ParsedModule,
  localName: string,
  reader: SourceReader,
  cache: Map<string, ParsedModule>,
): { module: ParsedModule; value: AstNode } {
  const binding = module.imports.get(localName)
  if (binding === undefined) {
    throw new Error(`${module.path}: unresolved command binding ${localName}`)
  }
  const importedModule = moduleFor(binding.path, reader, cache)
  const value = importedModule.exports.get(binding.name)
  if (value === undefined) {
    throw new Error(
      `${module.path}: ${localName} imports missing ${binding.name}`,
    )
  }
  return { module: importedModule, value }
}

function isImportedFrom(
  module: ParsedModule,
  localName: string,
  pathSuffix: string,
  importedName: string,
): boolean {
  const binding = module.imports.get(localName)
  return (
    binding !== undefined &&
    binding.name === importedName &&
    binding.path.endsWith(pathSuffix)
  )
}

function aliasRows(
  aliasesNode: AstNode | undefined,
  sourcePath: string,
  prefix: string[],
): CommandAlias[] {
  if (aliasesNode === undefined) {
    return []
  }
  const rows: CommandAlias[] = []
  for (const [name, definition] of objectProperties(aliasesNode, sourcePath)) {
    const argv = objectProperty(definition, 'argv', sourcePath)
    if (argv === undefined) {
      throw sourceError(sourcePath, definition, `alias ${name} has no argv`)
    }
    rows.push({
      alias: [...prefix, name].join(' '),
      target: [...prefix, ...literalStringArray(argv, sourcePath)].join(' '),
    })
  }
  return rows
}

function runBody(
  module: ParsedModule,
  commandObject: AstNode,
): AstNode | undefined {
  const runProperty = objectProperty(commandObject, 'run', module.path)
  if (runProperty === undefined) {
    return undefined
  }
  const runName = identifierName(runProperty)
  const run =
    runName === undefined ? runProperty : module.declarations.get(runName)
  if (run === undefined) {
    throw sourceError(module.path, runProperty, 'unresolved run handler')
  }
  const body = run['body']
  return isNode(body) ? body : undefined
}

function subcommandConfig(
  module: ParsedModule,
  commandValue: AstNode,
): { subcommands: AstNode | undefined; aliases: AstNode | undefined } {
  if (commandValue.type === 'CallExpression') {
    return factorySubcommandConfig(module, commandValue)
  }
  if (commandValue.type !== 'ObjectExpression') {
    throw sourceError(
      module.path,
      commandValue,
      'unsupported command declaration',
    )
  }
  const body = runBody(module, commandValue)
  if (body === undefined) {
    return { subcommands: undefined, aliases: undefined }
  }
  const calls: AstNode[] = []
  function findCalls(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) {
        findCalls(child)
      }
      return
    }
    if (!isNode(value)) {
      return
    }
    const callee = value['callee']
    if (
      value.type === 'CallExpression' &&
      isNode(callee) &&
      isImportedFrom(
        module,
        identifierName(callee) ?? '',
        'with-subcommands.mts',
        'meowWithSubcommands',
      )
    ) {
      calls.push(value)
    }
    const children = Object.values(value)
    for (let index = 0, { length } = children; index < length; index += 1) {
      const child = children[index]
      if (child === undefined) {
        continue
      }
      findCalls(child)
    }
  }
  findCalls(body)
  const secondCall = calls[1]
  if (secondCall !== undefined) {
    throw sourceError(module.path, secondCall, 'multiple subcommand routers')
  }
  const call = calls[0]
  if (call === undefined) {
    return { subcommands: undefined, aliases: undefined }
  }
  const args = nodeArray(
    call['arguments'],
    `${module.path}: invalid router arguments`,
  )
  const config = args[0]
  const options = args[1]
  if (config === undefined || config.type !== 'ObjectExpression') {
    throw sourceError(module.path, call, 'dynamic subcommand router config')
  }
  if (options !== undefined && options.type !== 'ObjectExpression') {
    throw sourceError(module.path, call, 'dynamic subcommand router options')
  }
  const aliases =
    options === undefined
      ? undefined
      : objectProperty(options, 'aliases', module.path)
  return {
    subcommands: objectProperty(config, 'subcommands', module.path),
    aliases,
  }
}

function factorySubcommandConfig(
  module: ParsedModule,
  commandValue: AstNode,
): { subcommands: AstNode | undefined; aliases: AstNode | undefined } {
  const callee = identifierName(commandValue['callee'])
  if (callee === undefined) {
    throw sourceError(module.path, commandValue, 'unsupported command factory')
  }
  const leafFactories = [
    ['util/cli/define-handoff.mts', 'defineHandoffCommand'],
    ['command/config/config-command-factory.mts', 'createConfigCommand'],
    [
      'command/repository/repository-command-factory.mts',
      'createRepositoryCommand',
    ],
  ]
  if (
    leafFactories.some(
      ([pathSuffix, importedName]) =>
        pathSuffix !== undefined &&
        importedName !== undefined &&
        isImportedFrom(module, callee, pathSuffix, importedName),
    )
  ) {
    return { subcommands: undefined, aliases: undefined }
  }
  if (
    !isImportedFrom(
      module,
      callee,
      'util/cli/define-subcommand-group.mts',
      'defineSubcommandGroup',
    )
  ) {
    throw sourceError(module.path, commandValue, 'unsupported command factory')
  }
  const args = nodeArray(
    commandValue['arguments'],
    `${module.path}: invalid factory arguments`,
  )
  return parseFactoryConfig(module, commandValue, args[0])
}

function parseFactoryConfig(
  module: ParsedModule,
  commandValue: AstNode,
  config: AstNode | undefined,
): { subcommands: AstNode | undefined; aliases: AstNode | undefined } {
  if (config === undefined || config.type !== 'ObjectExpression') {
    throw sourceError(
      module.path,
      commandValue,
      'dynamic command factory config',
    )
  }
  return {
    subcommands: objectProperty(config, 'subcommands', module.path),
    aliases: objectProperty(config, 'aliases', module.path),
  }
}

export function extractCommandInventory(
  sourceReader: SourceReader,
): CommandInventory {
  const modules = new Map<string, ParsedModule>()
  const root = moduleFor('src/commands.mts', sourceReader, modules)
  const rootCommands = root.exports.get('rootCommands')
  const rootAliases = root.exports.get('rootAliases')
  if (rootCommands === undefined || rootAliases === undefined) {
    throw new Error('src/commands.mts: missing root command registries')
  }
  const commands: string[] = []
  const aliases = aliasRows(rootAliases, root.path, [])
  const active = new Set<string>()

  function collectCommand(
    owner: ParsedModule,
    localName: string,
    commandPath: string[],
  ): void {
    const resolved = importedExport(owner, localName, sourceReader, modules)
    const commandId = `${resolved.module.path}#${localName}`
    if (active.has(commandId)) {
      throw new Error(
        `${resolved.module.path}: command routing cycle at ${commandPath.join(' ')}`,
      )
    }
    active.add(commandId)
    commands.push(commandPath.join(' '))
    const config = subcommandConfig(resolved.module, resolved.value)
    aliases.push(
      ...aliasRows(config.aliases, resolved.module.path, commandPath),
    )
    if (config.subcommands !== undefined) {
      const subcommands = objectProperties(
        config.subcommands,
        resolved.module.path,
      )
      for (const [name, value] of subcommands) {
        const childName = identifierName(value)
        if (childName === undefined) {
          throw sourceError(
            resolved.module.path,
            value,
            'dynamic subcommand target',
          )
        }
        collectCommand(resolved.module, childName, [...commandPath, name])
      }
    }
    const customRouteKind = customRouteKindForModule(resolved.module.path)
    if (customRouteKind !== undefined) {
      const customRoutes = extractCustomRoutes(
        sourceReader,
        customRouteKind,
        commandPath,
      )
      commands.push(...customRoutes)
    }
    active.delete(commandId)
  }

  const rootEntries = objectProperties(rootCommands, root.path)
  for (const [name, value] of rootEntries) {
    const localName = identifierName(value)
    if (localName === undefined) {
      throw sourceError(root.path, value, 'dynamic root command target')
    }
    collectCommand(root, localName, [name])
  }

  const commandNames = new Set(commands)
  if (commandNames.size !== commands.length) {
    throw new Error('src/commands.mts: duplicate command route')
  }
  for (const alias of aliases) {
    if (!commandNames.has(alias.target)) {
      throw new Error(
        `src/commands.mts: alias ${alias.alias} targets missing ${alias.target}`,
      )
    }
  }
  return {
    commands: [...commandNames].toSorted(),
    aliases: aliases.toSorted((left, right) =>
      left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0,
    ),
  }
}

function customRouteKindForModule(path: string): CustomRouteKind | undefined {
  if (path.endsWith('command/patch/cmd-patch.mts')) {
    return 'patch'
  }
  if (path.endsWith('command/sfw/cmd-sfw.mts')) {
    return 'sfw'
  }
  return undefined
}
