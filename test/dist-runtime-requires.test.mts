import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAst } from 'rollup/parseAst'
import { describe, expect, it } from 'vitest'

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const distPath = path.join(rootPath, 'dist')

type AstNode = { type: string } & Record<string, unknown>

// Node lists some builtins twice, bare and 'node:' prefixed. Normalize to bare
// so a lookup only has to strip the prefix once.
const builtinNames = new Set(
  builtinModules.map(name =>
    name.startsWith('node:') ? name.slice('node:'.length) : name,
  ),
)

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function walkAst(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      walkAst(child, visit)
    }
    return
  }
  if (typeof value !== 'object' || value === null) {
    return
  }
  if (isAstNode(value)) {
    visit(value)
  }
  for (const key of Object.keys(value)) {
    if (key === 'type') {
      continue
    }
    walkAst((value as Record<string, unknown>)[key], visit)
  }
}

// Matches the callee of a createRequire() call in any of the shapes the bundler
// emits: a bare `createRequire(...)`, a namespaced `mod.createRequire(...)`, and
// the sequence form `(0, mod.createRequire)(...)` used to drop the `this` binding.
function isCreateRequireCallee(value: unknown): boolean {
  if (!isAstNode(value)) {
    return false
  }
  if (value.type === 'SequenceExpression') {
    const expressions = value['expressions']
    return (
      Array.isArray(expressions) &&
      isCreateRequireCallee(expressions[expressions.length - 1])
    )
  }
  if (value.type === 'Identifier') {
    return value['name'] === 'createRequire'
  }
  if (value.type === 'MemberExpression') {
    const property = value['property']
    return isAstNode(property) && property['name'] === 'createRequire'
  }
  return false
}

function isCreateRequireCall(value: unknown): boolean {
  return (
    isAstNode(value) &&
    value.type === 'CallExpression' &&
    isCreateRequireCallee(value['callee'])
  )
}

// Every local name a createRequire() result was stored under, plus plain
// `require` itself. Calling one of these with a string literal is a runtime
// module load that a consumer's install has to be able to satisfy.
function collectRequireAliases(ast: unknown): Set<string> {
  const aliases = new Set<string>(['require'])
  walkAst(ast, node => {
    if (node.type === 'VariableDeclarator') {
      const id = node['id']
      if (
        isAstNode(id) &&
        id.type === 'Identifier' &&
        typeof id['name'] === 'string' &&
        isCreateRequireCall(node['init'])
      ) {
        aliases.add(id['name'])
      }
      return
    }
    if (node.type === 'AssignmentExpression') {
      const left = node['left']
      if (
        isAstNode(left) &&
        left.type === 'Identifier' &&
        typeof left['name'] === 'string' &&
        isCreateRequireCall(node['right'])
      ) {
        aliases.add(left['name'])
      }
    }
  })
  return aliases
}

function collectRequiredSpecifiers(source: string): string[] {
  const ast = parseAst(source)
  const aliases = collectRequireAliases(ast)
  const specifiers: string[] = []
  walkAst(ast, node => {
    if (node.type !== 'CallExpression') {
      return
    }
    const callee = node['callee']
    const callsRequire =
      (isAstNode(callee) &&
        callee.type === 'Identifier' &&
        typeof callee['name'] === 'string' &&
        aliases.has(callee['name'])) ||
      isCreateRequireCall(callee)
    if (!callsRequire) {
      return
    }
    const args = node['arguments']
    if (!Array.isArray(args) || !args.length) {
      return
    }
    const first = args[0]
    if (
      isAstNode(first) &&
      first.type === 'Literal' &&
      typeof first['value'] === 'string'
    ) {
      specifiers.push(first['value'])
    }
  })
  return specifiers
}

// The installable package a specifier resolves to, or undefined when the
// specifier is relative, absolute, or a subpath import that never hits a
// consumer's node_modules.
function packageNameFromSpecifier(specifier: string): string | undefined {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('#') ||
    specifier.startsWith('/') ||
    path.isAbsolute(specifier)
  ) {
    return undefined
  }
  const bare = specifier.startsWith('node:')
    ? specifier.slice('node:'.length)
    : specifier
  const segments = bare.split('/')
  return bare.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

function findDistScripts(dirPath: string): string[] {
  const scriptPaths: string[] = []
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      scriptPaths.push(...findDistScripts(entryPath))
    } else if (entry.name.endsWith('.js')) {
      scriptPaths.push(entryPath)
    }
  }
  return scriptPaths.sort()
}

// A bundled dependency that is loaded with require() at runtime instead of being
// inlined still has to be installed on the consumer's machine, so it must be a
// Node builtin or a package.json "dependencies" entry. When it is neither, a
// fresh `npm i -g socket` throws "Cannot find module" the first time that code
// path runs — the dev tree hides it because devDependencies fill the gap.
describe('dist runtime requires', () => {
  it('name a Node builtin or a declared dependency', () => {
    if (!existsSync(distPath)) {
      throw new Error(
        `Missing build output at ${distPath}.\n` +
          `→ This test checks what ships, so it needs a built dist.\n` +
          `→ Run: pnpm build:dist:src`,
      )
    }
    const pkgJson = JSON.parse(
      readFileSync(path.join(rootPath, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const declared = new Set([
      ...Object.keys(pkgJson.dependencies ?? {}),
      ...Object.keys(pkgJson.optionalDependencies ?? {}),
    ])

    const scriptPaths = findDistScripts(distPath)
    expect(scriptPaths.length).toBeGreaterThan(0)

    const undeclared: string[] = []
    for (const scriptPath of scriptPaths) {
      const relPath = path.relative(rootPath, scriptPath).replace(/\\/g, '/')
      for (const specifier of collectRequiredSpecifiers(
        readFileSync(scriptPath, 'utf8'),
      )) {
        const pkgName = packageNameFromSpecifier(specifier)
        if (!pkgName || builtinNames.has(pkgName) || declared.has(pkgName)) {
          continue
        }
        const finding = `${relPath} requires "${specifier}" (package "${pkgName}")`
        if (!undeclared.includes(finding)) {
          undeclared.push(finding)
        }
      }
    }

    expect(undeclared).toEqual([])
  })
})
