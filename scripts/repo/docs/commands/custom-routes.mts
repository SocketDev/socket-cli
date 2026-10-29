import {
  identifierName,
  isNode,
  nodeArray,
  parseModule,
  stringLiteral,
  visitAst,
} from './util.mts'

import type { AstNode, ParsedModule, SourceReader } from './util.mts'

export type CustomRouteKind = 'patch' | 'sfw'

function isIndexZero(value: unknown, objectName: string): boolean {
  if (!isNode(value) || value['type'] !== 'MemberExpression') {
    return false
  }
  const property = value['property']
  return (
    value['computed'] === true &&
    isNode(value['object']) &&
    identifierName(value['object']) === objectName &&
    isNode(property) &&
    property['type'] === 'Literal' &&
    property['value'] === 0
  )
}

function isIdentifierIndexZero(value: unknown, identifier: string): boolean {
  return (
    isNode(value) &&
    value['type'] === 'MemberExpression' &&
    value['computed'] === true &&
    isNode(value['object']) &&
    identifierName(value['object']) === identifier &&
    isNode(value['property']) &&
    value['property']['type'] === 'Literal' &&
    value['property']['value'] === 0
  )
}

function hasIndexZeroAssignment(
  node: AstNode,
  variableName: string,
  sourceName: string,
): boolean {
  let found = false
  visitAst(node, candidate => {
    if (
      candidate['type'] === 'VariableDeclarator' &&
      identifierName(candidate['id']) === variableName &&
      isIdentifierIndexZero(candidate['init'], sourceName)
    ) {
      found = true
    }
  })
  return found
}

function hasCall(node: AstNode, functionName: string): boolean {
  let found = false
  visitAst(node, child => {
    if (
      child['type'] === 'CallExpression' &&
      isNode(child['callee']) &&
      identifierName(child['callee']) === functionName
    ) {
      found = true
    }
  })
  return found
}

function importedPatchHandlers(node: AstNode, module: ParsedModule): string[] {
  const handlers: string[] = []
  let unsupportedCall = false
  visitAst(node, child => {
    if (child['type'] !== 'CallExpression') {
      return
    }
    const callee = identifierName(child['callee'])
    const binding =
      callee === undefined ? undefined : module.imports.get(callee)
    if (
      callee === undefined ||
      binding === undefined ||
      !binding.path.includes('/patch-')
    ) {
      unsupportedCall = true
      return
    }
    handlers.push(callee)
  })
  if (unsupportedCall) {
    throw new Error(`${module.path}: unsupported patch route handler`)
  }
  return [...new Set(handlers)]
}

function importedFrom(
  module: ParsedModule,
  localName: string,
  suffix: string,
  importedName: string,
): boolean {
  const binding = module.imports.get(localName)
  return (
    binding !== undefined &&
    binding.name === importedName &&
    binding.path.endsWith(suffix)
  )
}

function functionBody(module: ParsedModule, name: string): AstNode {
  const declaration = module.declarations.get(name)
  if (
    declaration?.['type'] !== 'FunctionDeclaration' ||
    !isNode(declaration['body'])
  ) {
    throw new Error(`${module.path}: missing ${name} function`)
  }
  return declaration['body']
}

function routeCases(
  module: ParsedModule,
  node: AstNode,
  selector: string,
  { requireSkipRollback }: { requireSkipRollback: boolean },
): string[] {
  const found: string[] = []
  visitAst(node, child => {
    if (child['type'] !== 'IfStatement' || !isNode(child['test'])) {
      return
    }
    const test = child['test']
    let value: string | undefined
    visitAst(test, candidate => {
      if (
        candidate['type'] === 'BinaryExpression' &&
        candidate['operator'] === '===' &&
        isNode(candidate['left']) &&
        candidate['left']['type'] === 'Identifier' &&
        identifierName(candidate['left']) === selector
      ) {
        value = stringLiteral(candidate['right'])
      }
    })
    if (value === undefined || !isNode(child['consequent'])) {
      return
    }
    const handlers = importedPatchHandlers(child['consequent'], module)
    if (handlers.length === 0) {
      return
    }
    let skipFlagFound = false
    visitAst(test, candidate => {
      if (
        candidate['type'] === 'CallExpression' &&
        isNode(candidate['callee'])
      ) {
        const callee = candidate['callee']
        if (
          callee['type'] === 'MemberExpression' &&
          isNode(callee['property']) &&
          identifierName(callee['property']) === 'includes' &&
          Array.isArray(candidate['arguments']) &&
          stringLiteral(candidate['arguments'][0]) === '--skip-rollback'
        ) {
          skipFlagFound = true
        }
      }
    })
    if (value === 'remove' && requireSkipRollback && !skipFlagFound) {
      throw new Error(`${module.path}: unsupported remove route condition`)
    }
    found.push(value)
  })
  return [...new Set(found)]
}

function binaryRouteCases(
  node: AstNode,
  selector: string,
  target: string,
  handler: string,
): number {
  let count = 0
  visitAst(node, child => {
    if (
      child['type'] === 'IfStatement' &&
      isNode(child['test']) &&
      child['test']['type'] === 'BinaryExpression' &&
      child['test']['operator'] === '===' &&
      isIndexZero(child['test']['left'], selector) &&
      stringLiteral(child['test']['right']) === target &&
      isNode(child['consequent']) &&
      hasCall(child['consequent'], handler)
    ) {
      count += 1
    }
  })
  return count
}

function isPositionalsFirstFallback(value: unknown): boolean {
  if (
    !isNode(value) ||
    value['type'] !== 'LogicalExpression' ||
    value['operator'] !== '??' ||
    !isIndexZero(value['left'], 'positionals') ||
    !isNode(value['right'])
  ) {
    return false
  }
  return value['right']['type'] === 'Literal' && value['right']['value'] === ''
}

function firewallCaModes(sourceReader: SourceReader): string[] {
  const module = parseModule(
    'src/command/firewall/ca-command.mts',
    sourceReader,
  )
  const validator = module.exports.get('validateFirewallCaArguments')
  if (!validator) {
    throw new Error(`${module.path}: missing exported argument validator`)
  }
  const runner = module.exports.get('runFirewallCaCommand')
  if (runner === undefined) {
    throw new Error(`${module.path}: missing exported CA command`)
  }
  let runnerValidatesArguments = false
  visitAst(runner, node => {
    if (
      node['type'] === 'CallExpression' &&
      identifierName(node['callee']) === 'validateFirewallCaArguments'
    ) {
      runnerValidatesArguments = true
    }
  })
  if (!runnerValidatesArguments) {
    throw new Error(`${module.path}: CA command does not validate positionals`)
  }
  const modes: string[] = []
  let allowlistValidated = false
  visitAst(validator, node => {
    if (
      node['type'] !== 'CallExpression' ||
      !isNode(node['callee']) ||
      node['callee']['type'] !== 'MemberExpression' ||
      !isNode(node['callee']['object']) ||
      node['callee']['object']['type'] !== 'ArrayExpression' ||
      !isNode(node['callee']['property']) ||
      identifierName(node['callee']['property']) !== 'includes'
    ) {
      return
    }
    const args = node['arguments']
    if (!Array.isArray(args) || !isPositionalsFirstFallback(args[0])) {
      return
    }
    allowlistValidated = true
    const values = nodeArray(
      node['callee']['object']['elements'],
      `${module.path}: invalid CA allowlist`,
    ).map(stringLiteral)
    if (values.some(value => value === undefined) || values.length === 0) {
      throw new Error(
        `${module.path}: CA command allowlist must be literal strings`,
      )
    }
    modes.push(
      ...values.filter((value): value is string => value !== undefined),
    )
  })
  if (
    !allowlistValidated ||
    modes.length === 0 ||
    new Set(modes).size !== modes.length
  ) {
    throw new Error(`${module.path}: unsupported CA command allowlist`)
  }
  return modes
}

function extractPatchRoutes(
  sourceReader: SourceReader,
  commandPath: string[],
): string[] {
  const patchModule = parseModule(
    'src/command/patch/cmd-patch.mts',
    sourceReader,
  )
  const patchRun = functionBody(patchModule, 'run')
  if (!hasIndexZeroAssignment(patchRun, 'subcommand', 'forwardArgs')) {
    throw new Error(
      `${patchModule.path}: unsupported patch selector assignment`,
    )
  }
  const patchRoutes = routeCases(patchModule, patchRun, 'subcommand', {
    requireSkipRollback: true,
  })
  if (
    !patchRoutes.includes('list') ||
    !patchRoutes.includes('remove') ||
    !importedFrom(
      patchModule,
      'runPatchList',
      'patch-list-command.mts',
      'runPatchList',
    ) ||
    !importedFrom(
      patchModule,
      'runPatchRemove',
      'patch-removal-command.mts',
      'runPatchRemove',
    )
  ) {
    throw new Error(`${patchModule.path}: unsupported local patch routes`)
  }
  return patchRoutes.map(route => [...commandPath, route].join(' '))
}

function extractFirewallRoutes(
  sourceReader: SourceReader,
  commandPath: string[],
): string[] {
  const sfwModule = parseModule('src/command/sfw/cmd-sfw.mts', sourceReader)
  const sfwRun = functionBody(sfwModule, 'run')
  if (
    binaryRouteCases(sfwRun, 'sfwArgs', 'ca', 'runFirewallCaCommand') !== 1 ||
    !importedFrom(
      sfwModule,
      'runFirewallCaCommand',
      'firewall/ca-command.mts',
      'runFirewallCaCommand',
    )
  ) {
    throw new Error(`${sfwModule.path}: unsupported local CA route`)
  }
  return [
    [...commandPath, 'ca'].join(' '),
    ...firewallCaModes(sourceReader).map(mode =>
      [...commandPath, 'ca', mode].join(' '),
    ),
  ]
}

export function extractCustomRoutes(
  sourceReader: SourceReader,
  kind: CustomRouteKind,
  commandPath: string[],
): string[] {
  return kind === 'patch'
    ? extractPatchRoutes(sourceReader, commandPath)
    : extractFirewallRoutes(sourceReader, commandPath)
}
