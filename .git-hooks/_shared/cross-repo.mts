import { repositorySourceRoot } from './repository-source-root.mts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import {
  offsetToLineCol,
  tryParse,
} from '../../.claude/hooks/fleet/_shared/ast/core.mts'
import type { AcornNode } from '../../.claude/hooks/fleet/_shared/ast/core.mts'
import {
  evaluateRepositoryExpression,
  repositoryAstNode,
  repositoryExpressionName,
} from './cross-repo-expressions.mts'
import type { RepositoryExpressionContext } from './cross-repo-expressions.mts'
import {
  containsRepositoryPath,
  findRepositoryRoot,
  repositoryContainsTarget,
  repositoryPathApi,
  repositoryRealPath,
  resolveRepositoryPath,
} from './repo-containment.mts'

export interface CrossRepositoryHit {
  lineNumber: number
  line: string
  matched: string
}

export interface CrossRepositoryAnalysis {
  hits: CrossRepositoryHit[]
  unproven: number[]
}

function repositoryPathLiteral(value: string): boolean {
  const normalized = normalizePath(value)
  return (
    value.startsWith('./') ||
    value.startsWith('.\\') ||
    // Recognize drive, relative, absolute, and local dependency prefixes.
    /^(?:[a-z]:\/|\.\.?\/|\/|file:|link:)/iu.test(normalized)
  )
}

function isRepositorySourceRead(name: string): boolean {
  const separator = name.indexOf('.')
  if (
    separator !== -1 &&
    !['fs', 'fsp', 'fsPromises', 'promises'].includes(name.slice(0, separator))
  ) {
    return false
  }
  const qualifiedMethod = name.slice(separator + 1)
  const method = qualifiedMethod.endsWith('Sync')
    ? qualifiedMethod.slice(0, -4)
    : qualifiedMethod
  return ['createReadStream', 'readFile', 'readlink'].includes(method)
}

function isKernelRuntimePath(value: string): boolean {
  // Match the two virtual kernel roots and every path below them.
  return /^\/(?:proc|sys)(?:\/|$)/u.test(normalizePath(value))
}

function repositoryAstChildren(node: AcornNode): AcornNode[] {
  const children: AcornNode[] = []
  const values = Object.values(node)
  for (let index = 0, { length } = values; index < length; index += 1) {
    const value = values[index]
    for (const candidate of Array.isArray(value) ? value : [value]) {
      const child = repositoryAstNode(candidate)
      if (child) {
        children.push(child)
      }
    }
  }
  return children
}

function collectRepositoryBindings(
  node: AcornNode,
  context: RepositoryExpressionContext,
): void {
  if (node.type === 'VariableDeclarator') {
    const id = repositoryAstNode(node['id'])
    if (id?.type === 'Identifier') {
      const name = String(id['name'])
      context.bindings.set(
        name,
        context.bindings.has(name)
          ? undefined
          : repositoryAstNode(node['init']),
      )
    }
  }
  if (
    node.type === 'AssignmentExpression' ||
    node.type === 'UpdateExpression'
  ) {
    const target = repositoryAstNode(node['left'] ?? node['argument'])
    if (target?.type === 'Identifier') {
      context.bindings.set(String(target['name']), undefined)
    }
  }
  if (/^(?:ArrowFunction|Function)/u.test(node.type)) {
    for (const parameter of (node['params'] ?? []) as AcornNode[]) {
      if (parameter.type === 'Identifier') {
        context.bindings.set(String(parameter['name']), undefined)
      }
    }
  }
  for (const child of repositoryAstChildren(node)) {
    collectRepositoryBindings(child, context)
  }
}

function repositoryReferenceEscapes(
  value: string,
  base: string,
  root: string,
  physicalRoot: string,
): boolean {
  const target = resolveRepositoryPath(
    base,
    value.replace(/^(?:file:|link:)/u, ''),
  )
  const modules = resolveRepositoryPath(root, 'node_modules')
  if (containsRepositoryPath(modules, target)) {
    return false
  }
  if (base !== root) {
    const resolvedPhysicalRoot = repositoryRealPath(physicalRoot)
    const resolvedTarget = repositoryRealPath(target)
    if (
      resolvedPhysicalRoot !== undefined &&
      resolvedTarget !== undefined &&
      containsRepositoryPath(resolvedPhysicalRoot, resolvedTarget)
    ) {
      return false
    }
  }
  if (root === physicalRoot) {
    return !repositoryContainsTarget(root, target)
  }
  const resolvedRoot = repositoryRealPath(root)
  const resolvedTarget = repositoryRealPath(target)
  return (
    resolvedRoot === undefined ||
    resolvedTarget === undefined ||
    !containsRepositoryPath(resolvedRoot, resolvedTarget)
  )
}

export function analyzeCrossRepositoryPaths(
  source: string,
  fileAbsPath: string,
  options?: { root?: string | undefined } | undefined,
): CrossRepositoryAnalysis {
  const settings = { __proto__: null, ...options }
  const file = resolveRepositoryPath(
    settings.root ??
      findRepositoryRoot(fileURLToPath(import.meta.url)) ??
      path.dirname(fileURLToPath(import.meta.url)),
    fileAbsPath,
  )
  const physicalRoot =
    settings.root ??
    findRepositoryRoot(file) ??
    repositoryPathApi(file).dirname(file)
  const root = repositorySourceRoot(physicalRoot, file)
  const context: RepositoryExpressionContext = {
    root,
    file,
    bindings: new Map(),
  }
  const analysis: CrossRepositoryAnalysis = { hits: [], unproven: [] }
  const lines = source.split(/\r?\n/u)
  const seen = new Set<number>()
  const unproven = new Set<number>()
  function recordUnproven(start: number): void {
    const line = offsetToLineCol(source, start).line
    if (!unproven.has(line)) {
      unproven.add(line)
      analysis.unproven.push(line)
    }
  }
  function record(value: string, start: number, base: string): void {
    if (
      !repositoryPathLiteral(value) ||
      isKernelRuntimePath(value) ||
      !repositoryReferenceEscapes(value, base, root, physicalRoot) ||
      seen.has(start)
    ) {
      return
    }
    seen.add(start)
    const lineNumber = offsetToLineCol(source, start).line
    analysis.hits.push({
      lineNumber,
      line: lines[lineNumber - 1] ?? '',
      matched: value,
    })
  }
  function visitRepositorySink(node: AcornNode, base: string): boolean {
    if (node.type.startsWith('Import') || node.type.startsWith('Export')) {
      const target = repositoryAstNode(node['source'])
      if (target) {
        visitPathSink(target, base)
        return true
      }
    }
    if (node.type === 'CallExpression') {
      const name = repositoryExpressionName(repositoryAstNode(node['callee']))
      if (name === 'require' || isRepositorySourceRead(name)) {
        const argument = repositoryAstNode(
          (node['arguments'] as unknown[] | undefined)?.[0],
        )
        if (argument) {
          visitPathSink(argument, name === 'require' ? base : root)
        }
        return true
      }
    }
    return false
  }
  function visitPathSink(node: AcornNode, base: string): void {
    const value = evaluateRepositoryExpression(node, context)
    if (value === undefined) {
      recordUnproven(node.start)
    } else {
      record(value, node.start, base)
    }
  }
  function visit(node: AcornNode, base: string): void {
    if (visitRepositorySink(node, base)) {
      return
    }
    for (const child of repositoryAstChildren(node)) {
      visit(child, base)
    }
  }
  const ast = parseRepositorySource(source)
  if (ast) {
    collectRepositoryBindings(ast, context)
    visit(ast, repositoryPathApi(file).dirname(file))
  } else if (
    // Dependency manifests carry quoted paths and file/link values.
    /\.(?:json|toml|ya?ml)$/iu.test(file) ||
    path.basename(file) === '.gitmodules'
  ) {
    let offset = 0
    for (
      let lineIndex = 0, { length } = lines;
      lineIndex < length;
      lineIndex += 1
    ) {
      const line = lines[lineIndex]!
      if (!line.trimStart().startsWith('#')) {
        for (const match of line.matchAll(
          // Capture each local dependency value or quoted filesystem path.
          /(?:file:|link:)(?:[/\\]|[a-z]:[/\\]|\.\.?[/\\])[^\s'",}]+|(?:["'])(?:[a-z]:[/\\](?![*?"<>|:])|\.\.?[/\\])[^"'\r\n]+["']/giu,
        )) {
          // Remove only the opening and closing quote delimiters.
          const value = match[0].replace(/^["']|["']$/gu, '')
          record(
            value,
            Buffer.byteLength(source.slice(0, offset + match.index)),
            repositoryPathApi(file).dirname(file),
          )
        }
      }
      offset += line.length + 1
    }
  } else if (source.trim()) {
    recordUnproven(0)
  }
  analysis.hits.sort((left, right) => left.lineNumber - right.lineNumber)
  return analysis
}

export function scanRepositoryReferences(
  source: string,
  file: string,
): CrossRepositoryHit[] {
  return analyzeCrossRepositoryPaths(source, file).hits
}

const repositoryAstCache = new Map<string, ReturnType<typeof tryParse>>()
function parseRepositorySource(source: string): ReturnType<typeof tryParse> {
  if (repositoryAstCache.has(source)) {
    return repositoryAstCache.get(source)
  }
  const ast = tryParse(source)
  if (source.length <= 262_144) {
    if (repositoryAstCache.size >= 32) {
      repositoryAstCache.clear()
    }
    repositoryAstCache.set(source, ast)
  }
  return ast
}
