#!/usr/bin/env node
/**
 * @file `check --all` gate: keep detection logic that runs in BOTH hook trees
 *   single-source, so the two gates can't drift. Some matchers run at
 *   commit-time (`.git-hooks/`) AND edit-time (`.claude/hooks/fleet/`); if a
 *   `_shared/` module is imported by both trees, that module is the single
 *   source — no tree may ALSO re-define one of its exported symbols inline (a
 *   re-fork that silently lets the two gates diverge; audit finding 11). The
 *   shared set is DERIVED from the import graph, not a hand-maintained list or
 *   a header: walk both trees, AST-parse each file ONCE, and any `_shared/`
 *   module imported from both the `.git-hooks` and `.claude/hooks` trees is
 *   "shared". For each, assert no file re-declares one of its exported symbols
 *   at top level. Nothing to keep in sync — adding/renaming a shared module is
 *   picked up automatically from the code. AST-based (the vendored acorn, after
 *   stripping type-space TS the partial parser can't handle) so a symbol in a
 *   string / comment / a same-named local in a nested scope is never mistaken
 *   for a re-fork; files the wasm parser still rejects fall to a complete
 *   line-extractor — never silently skipped. Exit codes: 0 — no cross-tree
 *   shared module is re-forked; 1 — a re-fork was found.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Dirent } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  tryParse,
  walkSimple,
} from '../../../.claude/hooks/fleet/_shared/acorn/index.mts'
import type { AcornNode } from '../../../.claude/hooks/fleet/_shared/acorn/index.mts'

const logger = getDefaultLogger()

const TEMPLATE = path.resolve(import.meta.dirname, '../../..')
const GIT_HOOKS = path.join(TEMPLATE, '.git-hooks')
const CLAUDE_HOOKS = path.join(TEMPLATE, '.claude/hooks')

// One file's parsed facts — gathered in a SINGLE AST walk, reused for both
// "what does it import" and "what does it declare at top level".
interface FileFacts {
  // Absolute path.
  file: string
  // Which tree it belongs to.
  tree: 'git-hooks' | 'claude-hooks'
  // Resolved absolute paths of every `_shared` module it imports (import + a
  // re-export `export … from`). Only `.mts` under a `_shared/` dir are kept.
  sharedImports: Set<string>
  // Top-level declared symbol names (function / const / let / var / class) —
  // including non-exported privates. The consumer side: a re-fork shadows the
  // import by re-declaring, exported or not.
  declared: Set<string>
  // The EXPORTED subset of `declared` — a module's public, fork-able surface.
  // Only re-declaring an EXPORTED symbol of an imported module is a re-fork;
  // a private helper name (e.g. a module-local `splitLines`) coincidentally
  // shared is independent, not a fork.
  exported: Set<string>
  // How the facts were gathered — 'ast' when acorn parsed the (type-stripped)
  // file, else 'regex' (the partial-TS wasm parser rejected a form even after
  // `stripTypeSpace`). Surfaced so a parse-coverage regression is visible
  // rather than a silent blind spot.
  parsedBy: 'ast' | 'regex'
}

export function listMtsFiles(dir: string): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { encoding: 'utf8', withFileTypes: true })
  } catch {
    return out
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'test') {
        continue
      }
      out.push(...listMtsFiles(full))
    } else if (e.name.endsWith('.mts')) {
      out.push(full)
    }
  }
  return out
}

// Resolve an import specifier to an absolute path, keeping only relative
// imports of a `.mts` living under some `_shared/` dir (the shareable kind).
export function resolveSharedImport(
  fromFile: string,
  spec: string,
): string | undefined {
  if (!spec.startsWith('.')) {
    return undefined
  }
  const resolved = path.resolve(path.dirname(fromFile), spec)
  if (
    !resolved.endsWith('.mts') ||
    !resolved.includes(`${path.sep}_shared${path.sep}`)
  ) {
    return undefined
  }
  return resolved
}

// Top-level binding names introduced by a declaration node — a Function/Class
// declaration's `id`, or each Identifier binding of a VariableDeclaration.
// `undefined` (e.g. `export default …`, `export { … }`) yields nothing.
export function declaredNames(node: AcornNode | undefined): string[] {
  if (!node) {
    return []
  }
  const type = node['type'] as string | undefined
  if (type === 'ClassDeclaration' || type === 'FunctionDeclaration') {
    const id = node['id'] as { name?: unknown | undefined } | undefined
    return typeof id?.name === 'string' ? [id.name] : []
  }
  if (type === 'VariableDeclaration') {
    const names: string[] = []
    const decls = (node['declarations'] as AcornNode[] | undefined) ?? []
    for (const d of decls) {
      const id = d['id'] as
        | { name?: unknown | undefined; type?: string | undefined }
        | undefined
      if (id?.type === 'Identifier' && typeof id.name === 'string') {
        names.push(id.name)
      }
    }
    return names
  }
  return []
}

// Neutralize the type-space TS constructs the vendored acorn-wasm can't parse —
// `as const`, top-level `interface X {…}`, and `type X = …` aliases — by
// overwriting each with spaces (newlines kept, so byte offsets + line numbers
// are preserved). All three are type-space: they introduce no runtime binding
// and can't be a runtime matcher, so blanking them never changes the import /
// export / top-level-declaration facts this check reads. Strings, templates,
// and comments are skipped so a keyword inside one isn't mistaken for a decl.
//
// This widens AST coverage but does NOT make it total: the wasm parser is a
// partial TS parser and still rejects assorted annotated forms (some generic
// type-argument and arrow-parameter shapes). Those fall to the regex extractor
// in readFacts — complete for the three facts we need, never silently skipped.
export function stripTypeSpace(src: string): string {
  const n = src.length
  const out = src.split('')
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b; k += 1) {
      if (out[k] !== '\n' && out[k] !== '\r') {
        out[k] = ' '
      }
    }
  }
  let i = 0
  // Last non-whitespace, non-comment char before `i` — used to tell a
  // statement-start `interface`/`type` from the same word mid-expression.
  let prevSignificant = ''
  while (i < n) {
    const c = src[i]!
    if (c === '/' && src[i + 1] === '/') {
      let j = i + 2
      while (j < n && src[j] !== '\n') {
        j += 1
      }
      i = j
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2
      while (j < n - 1 && !(src[j] === '*' && src[j + 1] === '/')) {
        j += 1
      }
      i = j + 2
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && src[j] !== c) {
        j += src[j] === '\\' ? 2 : 1
      }
      i = j + 1
      prevSignificant = c
      continue
    }
    if (c === '`') {
      let j = i + 1
      while (j < n && src[j] !== '`') {
        j += src[j] === '\\' ? 2 : 1
      }
      i = j + 1
      prevSignificant = c
      continue
    }
    if (
      c === 'a' &&
      src.startsWith('as const', i) &&
      !/[\w$]/.test(src[i - 1] ?? ' ') &&
      !/[\w$]/.test(src[i + 8] ?? ' ')
    ) {
      blank(i, i + 8)
      i += 8
      continue
    }
    const atStmtStart =
      prevSignificant === '' ||
      prevSignificant === ';' ||
      prevSignificant === '{' ||
      prevSignificant === '}'
    if (atStmtStart && /[A-Za-z]/.test(c)) {
      // Matches an optional `export ` then optional `declare ` then captures the
      // keyword `interface` or `type` at a statement start.
      const head = /^(?:export\s+)?(?:declare\s+)?(interface|type)\b/.exec(
        src.slice(i),
      )
      if (head) {
        let j = i + head[0].length
        if (head[1] === 'interface') {
          while (j < n && src[j] !== '{') {
            j += 1
          }
          let depth = 0
          for (; j < n; j += 1) {
            if (src[j] === '{') {
              depth += 1
            } else if (src[j] === '}') {
              depth -= 1
              if (depth === 0) {
                j += 1
                break
              }
            }
          }
        } else {
          // `type X = …` — to the terminating `;`, or a newline at brace /
          // paren / angle / bracket depth 0 that isn't a `| & . ,` continuation.
          let depth = 0
          for (; j < n; j += 1) {
            const ch = src[j]!
            if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
              depth += 1
            } else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
              depth -= 1
            } else if (ch === ';' && depth <= 0) {
              j += 1
              break
            } else if (ch === '\n' && depth <= 0) {
              let p = j + 1
              while (p < n && /\s/.test(src[p]!)) {
                p += 1
              }
              const next = src[p]
              if (
                next === ',' ||
                next === '.' ||
                next === '&' ||
                next === '|'
              ) {
                j = p
                continue
              }
              break
            }
          }
        }
        blank(i, j)
        i = j
        prevSignificant = '}'
        continue
      }
    }
    if (!/\s/.test(c)) {
      prevSignificant = c
    }
    i += 1
  }
  return out.join('')
}

// Parse one file ONCE; collect its shared imports + top-level declarations
// (and which of those are exported — the module's fork-able public surface).
export function readFacts(file: string, tree: FileFacts['tree']): FileFacts {
  const facts: FileFacts = {
    file,
    tree,
    sharedImports: new Set<string>(),
    declared: new Set<string>(),
    exported: new Set<string>(),
    parsedBy: 'ast',
  }
  let src: string
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    return facts
  }

  const addImportSource = (source: unknown): void => {
    if (typeof source !== 'string') {
      return
    }
    const resolved = resolveSharedImport(file, source)
    if (resolved) {
      facts.sharedImports.add(resolved)
    }
  }

  // Prefer the AST (no false positives on a symbol inside a string / comment /
  // nested scope). First neutralize the type-space forms the vendored acorn
  // can't parse (`stripTypeSpace`); the parser is still partial-TS and rejects
  // assorted other annotated shapes, so on a parse failure we DON'T silently
  // skip the file — we fall back to a conservative regex extractor. A silent
  // skip would be a blind spot (the exact drift this check guards against).
  const parseSrc = stripTypeSpace(src)
  const ast = tryParse(parseSrc)
  if (ast) {
    walkSimple(parseSrc, {
      ImportDeclaration(node: AcornNode) {
        addImportSource(
          (node['source'] as { value?: unknown | undefined })?.value,
        )
      },
      // `export { x } from '…'` is an import-with-source, not a local decl.
      // `export function f(){}` / `export const C = …` is BOTH a top-level
      // declaration (caught below) and an export — its name is the module's
      // fork-able surface. `export { x }` (no source) re-exports a local name.
      ExportNamedDeclaration(node: AcornNode) {
        if (node['source']) {
          addImportSource(
            (node['source'] as { value?: unknown | undefined }).value,
          )
          return
        }
        for (const name of declaredNames(
          node['declaration'] as AcornNode | undefined,
        )) {
          facts.exported.add(name)
        }
        const specs = (node['specifiers'] as AcornNode[] | undefined) ?? []
        for (const s of specs) {
          const local = s['local'] as { name?: unknown | undefined } | undefined
          if (typeof local?.name === 'string') {
            facts.exported.add(local.name)
          }
        }
      },
      FunctionDeclaration(node: AcornNode) {
        for (const name of declaredNames(node)) {
          facts.declared.add(name)
        }
      },
      ClassDeclaration(node: AcornNode) {
        for (const name of declaredNames(node)) {
          facts.declared.add(name)
        }
      },
      VariableDeclaration(node: AcornNode) {
        for (const name of declaredNames(node)) {
          facts.declared.add(name)
        }
      },
    })
    return facts
  }

  // Fallback: line-oriented extraction. Imports/exports are regular enough to
  // read without a full parse; top-level declarations are matched at column 0
  // (or after `export `) so a nested-scope local doesn't masquerade as a
  // top-level re-fork. Coarser than the AST but COMPLETE — never silent.
  facts.parsedBy = 'regex'
  // Line start (`\n` or BOF), optional whitespace, an `import`/`export` stmt,
  // then `from '<source>'` — captures the quoted module specifier. Alternations
  // sorted (`\n` before `^`; `export` before `import`) per sort-regex-alternations.
  const importFromRe =
    /(?:\n|^)\s*(?:export\b[^;]*?|import\b[^;]*?)\bfrom\s*['"]([^'"]+)['"]/g // socket-lint: allow uncommented-regex
  let m: RegExpExecArray | null
  while ((m = importFromRe.exec(src)) !== null) {
    addImportSource(m[1])
  }
  // At line start: optional `export `, optional `async `, then a top-level
  // declaration — captures the name from a `const|let|var`/`class`/`function`.
  // Alternatives sorted by leading char (`(?:const…` < `class` < `function`)
  // per sort-regex-alternations; the name is read order-agnostically below.
  const declRe =
    /^(export\s+)?(?:async\s+)?(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]|class\s+([A-Za-z_$][\w$]*)|function\s+([A-Za-z_$][\w$]*))/gm // socket-lint: allow uncommented-regex
  while ((m = declRe.exec(src)) !== null) {
    const name = m[2] ?? m[3] ?? m[4]
    if (name) {
      facts.declared.add(name)
      if (m[1]) {
        facts.exported.add(name)
      }
    }
  }
  // Bare `export { a, b }` re-exports — names on the export-list are part of
  // the public surface even when the declaration matched without the keyword.
  const exportListRe = /^export\s*\{([^}]*)\}\s*;?\s*$/gm
  while ((m = exportListRe.exec(src)) !== null) {
    const parts = m[1]!.split(',')
    for (let i = 0, { length } = parts; i < length; i += 1) {
      const local = parts[i]!.trim()
        .split(/\s+as\s+/)[0]
        ?.trim()
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) {
        facts.exported.add(local)
      }
    }
  }
  return facts
}

function main(): void {
  // Parse every file in both trees once. A _shared module's fork-able surface is
  // its EXPORTED symbols (what a consumer can import); a re-fork is a consumer
  // re-declaring one of those exported names. A module's PRIVATE helper (e.g. a
  // local `splitLines`) coincidentally sharing a name with another file's private
  // helper is independent, not a fork — so private names never trigger the gate.
  const allFacts: FileFacts[] = [
    ...listMtsFiles(GIT_HOOKS).map(f => readFacts(f, 'git-hooks')),
    ...listMtsFiles(CLAUDE_HOOKS).map(f => readFacts(f, 'claude-hooks')),
  ]

  const factsByFile = new Map(allFacts.map(f => [f.file, f]))

  // A _shared module is "cross-tree shared" when files from BOTH trees import it.
  const importTrees = new Map<string, Set<FileFacts['tree']>>()
  for (let i = 0, { length } = allFacts; i < length; i += 1) {
    const f = allFacts[i]!
    for (const mod of f.sharedImports) {
      let trees = importTrees.get(mod)
      if (!trees) {
        trees = new Set()
        importTrees.set(mod, trees)
      }
      trees.add(f.tree)
    }
  }

  const crossTreeModules = [...importTrees]
    .filter(([, trees]) => trees.size >= 2)
    .map(([mod]) => mod)

  let errors = 0

  // A re-fork is precise (no symbol-NAME-collision noise): a file that IMPORTS a
  // cross-tree-shared module AND ALSO top-level re-declares one of that module's
  // EXPORTED symbols. You imported it — re-declaring the same exported name
  // shadows the import and is the copy-instead-of-reuse the shared module exists
  // to prevent. Two signals must both hold, so neither a coincidental same-named
  // local in a file that does NOT import the module, nor a private helper name
  // the module never exported (e.g. a module-local `splitLines`), is flagged.
  for (const mod of crossTreeModules) {
    const modFacts = factsByFile.get(mod)
    if (!modFacts) {
      // Imported from both trees but not in the walked dirs — can't verify.
      continue
    }
    for (let i = 0, { length } = allFacts; i < length; i += 1) {
      const f = allFacts[i]!
      if (f.file === mod || !f.sharedImports.has(mod)) {
        continue
      }
      for (const sym of f.declared) {
        if (modFacts.exported.has(sym)) {
          logger.fail(
            `scanner-parity: ${path.relative(TEMPLATE, f.file)} imports ${path.relative(TEMPLATE, mod)} yet re-declares \`${sym}\` — use the import, don't re-fork it (both hook trees must run one matcher).`,
          )
          errors++
        }
      }
    }
  }

  const regexFallbacks = allFacts.filter(f => f.parsedBy === 'regex').length

  if (errors === 0) {
    const astParsed = allFacts.length - regexFallbacks
    const coverage =
      regexFallbacks === 0
        ? 'all AST-parsed'
        : `${astParsed} AST-parsed, ${regexFallbacks} via regex extractor (partial-TS wasm parser couldn't parse them even after type-stripping)`
    logger.log(
      `scanner-parity: ${crossTreeModules.length} cross-tree shared module(s); none re-forked (${coverage}).`,
    )
    process.exitCode = 0
  } else {
    logger.error('')
    logger.fail(
      `scanner-parity: ${errors} re-fork(s). A matcher imported by both hook trees must live in ONE _shared module; don't re-declare its symbols elsewhere.`,
    )
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
