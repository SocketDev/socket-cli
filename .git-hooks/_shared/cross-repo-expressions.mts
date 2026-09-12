import { fileURLToPath } from 'node:url'

import type { AcornNode } from '../../.claude/hooks/fleet/_shared/ast/core.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import {
  repositoryPathApi,
  resolveRepositoryPath,
} from './repo-containment.mts'

export interface RepositoryExpressionContext {
  root: string
  file: string
  bindings: Map<string, AcornNode | undefined>
}

export function repositoryAstNode(value: unknown): AcornNode | undefined {
  return value !== null &&
    typeof value === 'object' &&
    typeof (value as AcornNode).type === 'string'
    ? (value as AcornNode)
    : undefined
}

export function repositoryExpressionName(node: AcornNode | undefined): string {
  if (!node) {
    return ''
  }
  if (node.type === 'Identifier') {
    return String(node['name'])
  }
  if (node.type === 'MetaProperty') {
    return 'import.meta'
  }
  if (node.type === 'MemberExpression' && !node['computed']) {
    return `${repositoryExpressionName(repositoryAstNode(node['object']))}.${repositoryExpressionName(repositoryAstNode(node['property']))}`
  }
  return ''
}

export function isRepositoryPathExpression(node: AcornNode): boolean {
  const name = repositoryExpressionName(repositoryAstNode(node['callee']))
  return (
    (node.type === 'CallExpression' &&
      // Match path namespace methods and named imports of the same operations.
      /^(?:(?:path|posix|win32)(?:\.(?:posix|win32))?\.)?(?:dirname|fileURLToPath|join|resolve)$/u.test(
        name,
      )) ||
    (node.type === 'NewExpression' && name === 'URL')
  )
}

function evaluateRepositoryName(
  node: AcornNode,
  context: RepositoryExpressionContext,
  visiting: Set<string>,
): string | undefined {
  const name = repositoryExpressionName(node)
  if (name === '__dirname' || name === 'import.meta.dirname') {
    return repositoryPathApi(context.file).dirname(context.file)
  }
  if (name === '__filename' || name === 'import.meta.url') {
    return context.file
  }
  if (node.type !== 'Identifier') {
    return undefined
  }
  if (!context.bindings.has(name)) {
    return name === 'REPO_ROOT' ? context.root : undefined
  }
  if (visiting.has(name)) {
    return undefined
  }
  const next = new Set(visiting)
  next.add(name)
  return evaluateRepositoryValue(context.bindings.get(name), context, next)
}

function evaluateRepositoryTemplate(
  node: AcornNode,
  context: RepositoryExpressionContext,
  visiting: Set<string>,
): string | undefined {
  const expressions = node['expressions'] as AcornNode[]
  const quasis = node['quasis'] as Array<{ value: { cooked: string } }>
  let value = quasis[0]?.value.cooked ?? ''
  for (let index = 0; index < expressions.length; index += 1) {
    const part = evaluateRepositoryValue(expressions[index], context, visiting)
    if (part === undefined) {
      return undefined
    }
    value += part + (quasis[index + 1]?.value.cooked ?? '')
  }
  return value
}

function evaluateRepositoryUrl(args: string[]): string | undefined {
  if (args[0]?.startsWith('file:')) {
    try {
      return fileURLToPath(args[0])
    } catch {
      return undefined
    }
  }
  if (!args[0] || !args[1] || /^[a-z]+:/iu.test(args[1])) {
    return undefined
  }
  return resolveRepositoryPath(
    repositoryPathApi(args[1]).dirname(args[1]),
    args[0],
  )
}

function evaluateRepositoryCall(
  node: AcornNode,
  context: RepositoryExpressionContext,
  visiting: Set<string>,
): string | undefined {
  const callee = repositoryExpressionName(repositoryAstNode(node['callee']))
  if (node.type === 'CallExpression' && callee === 'process.cwd') {
    return context.root
  }
  if (!isRepositoryPathExpression(node)) {
    return undefined
  }
  const values = (node['arguments'] as AcornNode[]).map(argument =>
    evaluateRepositoryValue(argument, context, visiting),
  )
  if (values.some(value => value === undefined)) {
    return undefined
  }
  const args = values as string[]
  if (node.type === 'NewExpression') {
    return evaluateRepositoryUrl(args)
  }
  if (callee.endsWith('fileURLToPath')) {
    return args[0]?.startsWith('file:') ? evaluateRepositoryUrl(args) : args[0]
  }
  const api = repositoryPathApi(context.root)
  if (callee.endsWith('dirname')) {
    return args[0] === undefined ? undefined : api.dirname(args[0])
  }
  const normalized = args.map(argument => normalizePath(argument))
  return callee.endsWith('resolve')
    ? api.resolve(context.root, ...normalized)
    : api.join(...normalized)
}

function evaluateRepositoryValue(
  node: AcornNode | undefined,
  context: RepositoryExpressionContext,
  visiting: Set<string>,
): string | undefined {
  if (!node) {
    return undefined
  }
  if (node.type === 'Literal' && typeof node['value'] === 'string') {
    return node['value']
  }
  if (node.type === 'TemplateLiteral') {
    return evaluateRepositoryTemplate(node, context, visiting)
  }
  if (node.type === 'BinaryExpression' && node['operator'] === '+') {
    const left = evaluateRepositoryValue(
      repositoryAstNode(node['left']),
      context,
      visiting,
    )
    const right = evaluateRepositoryValue(
      repositoryAstNode(node['right']),
      context,
      visiting,
    )
    return left === undefined || right === undefined ? undefined : left + right
  }
  return (
    evaluateRepositoryName(node, context, visiting) ??
    evaluateRepositoryCall(node, context, visiting)
  )
}

export function evaluateRepositoryExpression(
  node: AcornNode | undefined,
  context: RepositoryExpressionContext,
): string | undefined {
  return evaluateRepositoryValue(node, context, new Set())
}
