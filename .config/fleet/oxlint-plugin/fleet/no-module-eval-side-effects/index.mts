/*
 * @file Import-time hygiene: forbid native-handle capture and I/O at MODULE
 *   EVAL (top-level statements that run the instant a module is `import`ed /
 *   `require`d). Two payoffs, one rule:
 *
 *   1. STARTUP. A module that acquires a TTY stream, an SDK client, an
 *      AbortSignal, or reads a file the moment it loads pays that cost on every
 *      consumer's import — even consumers that never use the handle. Lazy
 *      acquisition (memoized getter, or `options.x ?? getDefault()` at the call
 *      site) defers the cost to first real use.
 *   2. V8-SNAPSHOT SAFETY. The fleet hook dispatcher boots from a V8 startup
 *      snapshot. A native `[Foreign]` handle captured at module-eval CANNOT be
 *      serialized into the blob — V8's snapshot serializer aborts with
 *      `global handle not serialized: [Foreign]` (a fatal native abort, not a
 *      catchable JS error), and `WebAssembly` is `undefined` in the
 *      `--build-snapshot` builder context entirely. So a module-eval
 *      `new SocketSdk()` / `getDefaultSpinner()` / `new WebAssembly.Module()`
 *      silently EXCLUDES that module's whole graph from the snapshot. This rule
 *      keeps the snapshot-safety the fleet bought from rotting back: it is the
 *      exact class four agents just fixed (`getDefaultSpinner()` /
 *      `getAbortSignal()` / `new AsyncLocalStorage()` at module scope).
 *
 *   DETECTION is a SYNTACTIC HEURISTIC — module-scope (a statement NOT inside
 *   any function/class-method body) that matches a DENYLIST entry. It catches
 *   the known blocker classes, not every conceivable handle; the denylists
 *   below are the extension point — a new pattern is a one-line addition.
 *
 *   WHAT IS FLAGGED at module scope (the HYGIENE subset — fires wherever the
 *   rule runs, snapshot-eligible or not, because the startup/handle cost is
 *   real everywhere):
 *   - `new` of a denylisted constructor (`DENYLISTED_CONSTRUCTORS`):
 *     AsyncLocalStorage, SignalExit, SocketSdk, Comparator (semver),
 *     SharedArrayBuffer.
 *   - `WebAssembly.Module` / `.Instance` / `.Memory` via `new`, and
 *     `WebAssembly.compile` / `.instantiate` calls.
 *   - Calls to a denylisted native-handle factory (`DENYLISTED_FACTORIES`):
 *     getDefaultSpinner, getAbortSignal, yoctoSpinner / yocto-spinner default.
 *   - Module-scope I/O: a synchronous `fs` read (`*Sync` member call on a
 *     binding named `fs`), `process.stdin` / `.stdout` / `.stderr` access, and
 *     any `child_process` member access (spawn/exec/fork/…).
 *
 *   SNAPSHOT-ELIGIBLE-ONLY CLAUSES (the second half of this rule — fire ONLY
 *   when the file being linted is part of the V8 dispatch bundle; see
 *   `isSnapshotEligible` below). These are syntax that is PERFECTLY FINE in
 *   ordinary fleet code but cannot survive the synchronous, statically-frozen
 *   snapshot build, so flagging them repo-wide would be wrong:
 *   - TOP-LEVEL `await` (module-scope `await` / `for await`): the snapshot
 *     build pass is synchronous, so a TLA aborts `--build-snapshot`. (Most
 *     fleet hooks legitimately end in `await runHook(...)` — they are entrypoint
 *     scripts, NOT bundle-safe, so they are NOT snapshot-eligible and stay
 *     unflagged.) `socket/no-top-level-await` is OFF in the hooks tree precisely
 *     because TLA there is the normal entrypoint pattern; this clause re-bans it
 *     only for the bundled subset.
 *   - VARIABLE-PATH dynamic `import()`: a non-literal import specifier
 *     (`import(path.join(dir, rel))`) can't be statically resolved by the
 *     bundler and therefore can't be frozen into the snapshot — only a
 *     string-literal `import('node:fs')` is snapshottable.
 *
 *   WHAT "SNAPSHOT-ELIGIBLE" MEANS — the modules that freeze into the dispatch
 *   bundle: the `_dispatch/` + `_shared/` graph (always bundled) and each
 *   BUNDLE-SAFE hook `index.mts` — exactly the maker's criterion in
 *   `scripts/fleet/make-hook-dispatch.mts` (an entrypoint guard
 *   `import.meta.url === \`file://${process.argv[1]}\`` AND `export function
 *   run(`). A hook that runs via top-level `await runHook(...)` lacks the
 *   `export run` marker, so the maker never bundles it and this rule never
 *   snapshot-flags it. Eligibility is computed per-file from the absolute path +
 *   (for hook index files) the file's own source, so it works both in a real
 *   repo and in the RuleTester's tmp-dir fixtures (which control the path tail
 *   via `filename:`).
 *
 *   WHAT IS NOT flagged: the SAME hygiene operation inside a function /
 *   class-method body (i.e. lazy — run on first call, not on import). For the
 *   snapshot-eligible clauses, the same syntax in a NON-eligible module (an
 *   entrypoint hook, a script, src/) is not flagged at all.
 *
 *   ESCAPE: a genuine module-eval construction uses a per-line
 *   `// oxlint-disable-next-line socket/no-module-eval-side-effects -- <reason>`
 *   (line-scoped only — `socket/no-file-scope-oxlint-disable` forbids the
 *   file-scope form). Report-only: the lazy rewrite needs the surrounding
 *   intent, so the human (or the AI-fix step) makes the call.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Snapshot-eligible TLA reuses `socket/no-top-level-await`'s bypass marker:
// an ESM-only entry that never gets bundled to CJS / snapshot can opt out.
const TLA_BYPASS_RE = /socket-lint:\s*allow\s+top-level-await/

// ───────────────────────── extension point ─────────────────────────
// The denylists below are the WHOLE extensible surface. A newly-discovered
// snapshot blocker or import-time handle is a ONE-LINE addition to the relevant
// set — add a trailing note saying WHY the pattern is a handle/IO blocker.
// Seeded from the empirically-found snapshot blockers
// (see template/base/.claude/hooks/fleet/_dispatch/SNAPSHOT-NOTES.md): every
// entry below corresponds to a `[Foreign]`-handle / WASM / circular-init
// failure that actually aborted `--build-snapshot`.

// `new X(...)` at module scope, by constructor NAME, captures a native handle
// (or, for Comparator, trips a circular semver init under the bundled snapshot).
const DENYLISTED_CONSTRUCTORS = new Set<string>([
  // node:async_hooks — captures an async-context [Foreign] handle.
  'AsyncLocalStorage',
  // semver Comparator — circular `comparator → SemVer` init breaks once the
  // semver tree is inlined into the single snapshot chunk.
  'Comparator',
  // SharedArrayBuffer — backing store is not snapshot-serializable.
  'SharedArrayBuffer',
  // signal-exit handler — captures process signal [Foreign] handles.
  'SignalExit',
  // @socketsecurity/sdk client — captures HTTP/abort/timer [Foreign] handles.
  'SocketSdk',
])

// Factory CALLS (`fn(...)`) at module scope that return a native handle. Matched
// by callee name (bare `fn(...)` or `x.fn(...)`).
const DENYLISTED_FACTORIES = new Set<string>([
  // shared AbortSignal — captures an abort [Foreign] handle.
  'getAbortSignal',
  // @socketsecurity/lib spawn default spinner — a yocto-spinner TTY/stdout
  // [Foreign] handle. THE blocker that excluded 57 hooks from the snapshot.
  'getDefaultSpinner',
  // yocto-spinner factory — same TTY/stdout handle, called directly. (The lib
  // imports the default export as `yoctoSpinner`.)
  'yoctoSpinner',
])

// `WebAssembly.<member>` — `new`-able (Module/Instance/Memory) or call
// (compile/instantiate). All instantiate/compile a module at eval time, and
// `WebAssembly` is undefined in the V8 snapshot builder context.
const WEBASSEMBLY_MEMBERS = new Set<string>([
  'compile',
  'Instance',
  'instantiate',
  'Memory',
  'Module',
])

// Identifiers a `process` stream lives under. Accessing any at module scope
// captures a TTY/pipe [Foreign] handle.
const PROCESS_STREAM_PROPS = new Set<string>(['stderr', 'stdin', 'stdout'])
// ──────────────────────── end extension point ──────────────────────

// Node types whose body is "not module scope" — a statement inside any of these
// runs on CALL, not on import, so it is lazy and exempt. Class method bodies are
// FunctionExpression, so the three function shapes cover them.
const FUNCTION_TYPES = new Set<string>([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
])

// Globals whose BARE module-scope reference throws ReferenceError where the
// global is absent — V8's --build-snapshot builder context, and (for
// SharedArrayBuffer) any browser without cross-origin isolation. `new X()`
// is covered by DENYLISTED_CONSTRUCTORS; this catches the reference-capture
// shape (`const XCtor = SharedArrayBuffer`) that slipped the NewExpression
// arm — the exact primordials/globals.ts gap that fed the wheelhouse
// snapshot shim.
const GUARDED_GLOBAL_REFS: ReadonlySet<string> = new Set(['SharedArrayBuffer'])

/**
 * True when `node` is inside a function/class-method body — i.e. lazy, not
 * module-eval. Walks the `.parent` chain (oxlint exposes parents on visited
 * nodes; the sibling `no-top-level-await` rule relies on the same).
 */
function isLazy(node: AstNode): boolean {
  let current = node.parent
  while (current) {
    if (FUNCTION_TYPES.has(current.type)) {
      return true
    }
    current = current.parent
  }
  return false
}

// ─────────────────── snapshot-eligibility (clause scope) ───────────────────
// The two snapshot-eligible-only clauses (top-level await, variable-path
// dynamic import) fire ONLY in modules that freeze into the V8 dispatch bundle.
// That set is the rolldown bundle's input closure — mirror the maker
// (scripts/fleet/make-hook-dispatch.mts), DON'T re-derive a different notion:
//   - the `_dispatch/` + `_shared/` graph (always bundled), and
//   - each BUNDLE-SAFE hook `index.mts` — entrypoint-guarded AND `export run`.
// Matched on the absolute file path (works in a real repo AND the RuleTester,
// which controls the path tail via `filename:`), plus — for a hook index file —
// the file's OWN source carrying the maker's two markers. A hook that runs via
// `await runHook(...)` lacks `export run`, so it is NOT eligible and its TLA
// is never flagged.

// Path is inside the fleet dispatch graph that is unconditionally bundled:
// `.claude/hooks/fleet/_dispatch/**` or `.claude/hooks/fleet/_shared/**`.
const BUNDLED_GRAPH_PATH_RE =
  /[\\/]\.claude[\\/]hooks[\\/]fleet[\\/]_(?:dispatch|shared)[\\/]/

// Path is a fleet hook entry `.claude/hooks/fleet/<name>/index.{mts,ts,…}`
// (NOT an `_`-prefixed support dir). Only a hook index can be a bundle entry.
const HOOK_INDEX_PATH_RE =
  /[\\/]\.claude[\\/]hooks[\\/]fleet[\\/](?!_)[^\\/]+[\\/]index\.[mc]?[jt]s$/

// The maker's bundle-safe markers, byte-for-byte (make-hook-dispatch.mts):
// an entrypoint guard so importing doesn't fire main(), AND an exported run().
const ENTRYPOINT_GUARD_RE =
  /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/
const EXPORT_RUN_RE = /export\s+(?:async\s+)?function\s+run\s*\(/

/**
 * True when the file being linted freezes into the V8 dispatch bundle, so the
 * snapshot-eligible-only clauses apply. The `_dispatch`/`_shared` graph is
 * always eligible; a hook `index` is eligible only when its source carries the
 * maker's bundle-safe markers (so an `await runHook(...)` entrypoint hook,
 * which the maker never bundles, is correctly NOT eligible).
 */
function isSnapshotEligible(filename: string, source: string): boolean {
  if (BUNDLED_GRAPH_PATH_RE.test(filename)) {
    return true
  }
  if (!HOOK_INDEX_PATH_RE.test(filename)) {
    return false
  }
  return ENTRYPOINT_GUARD_RE.test(source) && EXPORT_RUN_RE.test(source)
}
// ─────────────────────── end snapshot-eligibility ──────────────────────────

/**
 * The callee NAME of a CallExpression, for the bare (`fn()`) and member
 * (`x.fn()`) forms. Returns undefined for computed/other callees.
 */
function calleeName(callee: AstNode | undefined): string | undefined {
  if (!callee) {
    return undefined
  }
  if (callee.type === 'Identifier') {
    return callee.name
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property?.type === 'Identifier'
  ) {
    return callee.property.name
  }
  return undefined
}

/**
 * `WebAssembly.<member>` member expression → the member name, else undefined.
 * Matches the `WebAssembly` object by identifier name (the global).
 */
function webAssemblyMember(node: AstNode | undefined): string | undefined {
  if (
    !node ||
    node.type !== 'MemberExpression' ||
    node.computed ||
    node.object?.type !== 'Identifier' ||
    node.object.name !== 'WebAssembly' ||
    node.property?.type !== 'Identifier'
  ) {
    return undefined
  }
  return node.property.name
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid native-handle capture and I/O at module eval (top-level). Import-time hygiene — keeps imports fast and modules V8-snapshot-safe. Acquire lazily at first use instead.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      eagerConstruct:
        "`new {{name}}(...)` at module eval captures a native handle on import — slow startup and not V8-snapshot-safe (the handle can't be serialized into the blob). Construct it lazily at first use (a memoized getter, or `options.x ?? getDefault()` at the call site), not at module scope.",
      eagerWasm:
        '`WebAssembly.{{member}}` at module eval instantiates a WASM module on import — slow startup and not V8-snapshot-safe (`WebAssembly` is undefined in the snapshot builder). Defer it to first call behind a memoized getter.',
      eagerFactory:
        '`{{name}}(...)` at module eval acquires a native handle on import — slow startup and not V8-snapshot-safe. Acquire it lazily at first use (memoized getter, or `options.x ?? {{name}}()` at the call site), not at module scope.',
      eagerFsIo:
        '`{{name}}(...)` reads the filesystem at module eval — every consumer pays this on import. Move the read inside the function that needs it (lazy, memoized on first call).',
      eagerProcessStream:
        '`process.{{prop}}` access at module eval captures a TTY/pipe handle on import — slow startup and not V8-snapshot-safe. Reach for the stream inside the function that uses it, not at module scope.',
      eagerChildProcess:
        '`child_process.{{member}}` at module eval spawns/forks on import — a side effect every consumer pays. Move the spawn inside the function that needs it.',
      snapshotTopLevelAwait:
        'Top-level `await` in a snapshot-eligible module (it freezes into the V8 dispatch bundle). The snapshot build pass is synchronous, so a module-scope `await` aborts `--build-snapshot`. Move it inside `run()` (the dispatcher awaits the hook), or opt out with `// socket-lint: allow top-level-await -- <reason>` if this file is genuinely never bundled.',
      eagerGlobalCapture:
        "Bare `{{name}}` reference at module eval — this global is NOT defined everywhere ({{name}} is absent in the V8 snapshot builder and, for SharedArrayBuffer, in non-cross-origin-isolated browsers), so this line is a module-eval ReferenceError there. Capture it guarded: `typeof {{name}} === 'undefined' ? undefined : {{name}}`, or reference it lazily inside the function that needs it.",
      snapshotDynamicImport:
        "Variable-path dynamic `import()` in a snapshot-eligible module. A non-literal specifier can't be statically resolved or frozen into the snapshot — only a string-literal `import('…')` is snapshottable. Use a static `import` (or a literal-specifier dynamic import).",
    },
    schema: [],
  },

  create(context: RuleContext) {
    // Eligibility is decided once per file (cheap regex tests). The hygiene
    // visitors run unconditionally; the snapshot-eligible-only visitors are
    // registered only when this file freezes into the dispatch bundle.
    const filename = context.physicalFilename || context.filename || ''
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    const source =
      typeof sourceCode?.getText === 'function'
        ? sourceCode.getText()
        : ((sourceCode as { text?: string | undefined })?.text ?? '')
    const eligible = isSnapshotEligible(filename, source)
    const hasTlaBypass = eligible
      ? makeBypassChecker(context, TLA_BYPASS_RE)
      : undefined

    const listener: Record<string, (node: AstNode) => void> = {
      NewExpression(node: AstNode) {
        if (isLazy(node)) {
          return
        }
        const callee = node.callee
        // `new WebAssembly.Module(...)` etc.
        const wasm = webAssemblyMember(callee)
        if (wasm && WEBASSEMBLY_MEMBERS.has(wasm)) {
          context.report({
            node,
            messageId: 'eagerWasm',
            data: { member: wasm },
          })
          return
        }
        if (
          callee?.type === 'Identifier' &&
          DENYLISTED_CONSTRUCTORS.has(callee.name)
        ) {
          context.report({
            node,
            messageId: 'eagerConstruct',
            data: { name: callee.name },
          })
        }
      },

      // Bare global-constructor REFERENCE capture at module scope
      // (`const X = SharedArrayBuffer`): a value read of a global that is
      // absent in the snapshot builder / non-isolated browsers. `typeof`
      // guards are the sanctioned shape and stay silent, as do type
      // positions, member property names, and import/export specifiers.
      Identifier(node: AstNode) {
        const name = (node as { name?: string }).name
        if (!name || !GUARDED_GLOBAL_REFS.has(name)) {
          return
        }
        const parent = node.parent
        if (!parent) {
          return
        }
        if (
          parent.type === 'UnaryExpression' &&
          (parent as { operator?: string }).operator === 'typeof'
        ) {
          return
        }
        // Guarded read: a bare reference inside a conditional whose span
        // carries a `typeof <name>` check is the sanctioned capture shape
        // (`typeof X === 'undefined' ? undefined : X`).
        for (let anc: AstNode | undefined = parent; anc; anc = anc.parent) {
          if (
            anc.type === 'ConditionalExpression' ||
            anc.type === 'IfStatement' ||
            anc.type === 'LogicalExpression'
          ) {
            const { end, start } = anc as {
              end?: number | undefined
              start?: number | undefined
            }
            if (
              typeof start === 'number' &&
              typeof end === 'number' &&
              source.slice(start, end).includes(`typeof ${name}`)
            ) {
              return
            }
          }
        }
        if (parent.type.startsWith('TS')) {
          return
        }
        if (
          parent.type === 'MemberExpression' &&
          (parent as { property?: AstNode }).property === node &&
          !(parent as { computed?: boolean }).computed
        ) {
          return
        }
        if (
          parent.type === 'Property' &&
          (parent as { key?: AstNode }).key === node &&
          !(parent as { computed?: boolean }).computed
        ) {
          return
        }
        if (parent.type.includes('Specifier')) {
          return
        }
        if (isLazy(node)) {
          return
        }
        context.report({
          node,
          messageId: 'eagerGlobalCapture',
          data: { name },
        })
      },

      CallExpression(node: AstNode) {
        if (isLazy(node)) {
          return
        }
        const callee = node.callee
        // `WebAssembly.compile(...)` / `.instantiate(...)`.
        const wasm = webAssemblyMember(callee)
        if (wasm && WEBASSEMBLY_MEMBERS.has(wasm)) {
          context.report({
            node,
            messageId: 'eagerWasm',
            data: { member: wasm },
          })
          return
        }
        // Member-expression callees: `fs.readFileSync(...)`, `cp.spawn(...)`.
        if (
          callee?.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object?.type === 'Identifier' &&
          callee.property?.type === 'Identifier'
        ) {
          const objName = callee.object.name
          const member = callee.property.name
          // Synchronous fs read at module scope: a `*Sync` member call on a
          // binding named `fs`. (Name-based heuristic — the fleet imports the
          // node:fs builtin as `fs`; a non-fs `fooSync()` on a differently-named
          // object isn't matched.)
          if (objName === 'fs' && member.endsWith('Sync')) {
            context.report({
              node,
              messageId: 'eagerFsIo',
              data: { name: `fs.${member}` },
            })
            return
          }
          // Any `child_process` member call (spawn/exec/execSync/fork/…).
          if (objName === 'child_process' || objName === 'cp') {
            context.report({
              node,
              messageId: 'eagerChildProcess',
              data: { member },
            })
            return
          }
        }
        // Native-handle factory call, bare or member form.
        const name = calleeName(callee)
        if (name && DENYLISTED_FACTORIES.has(name)) {
          context.report({
            node,
            messageId: 'eagerFactory',
            data: { name },
          })
        }
      },

      MemberExpression(node: AstNode) {
        if (node.computed || isLazy(node)) {
          return
        }
        // `process.stdin` / `.stdout` / `.stderr` at module scope.
        if (
          node.object?.type === 'Identifier' &&
          node.object.name === 'process' &&
          node.property?.type === 'Identifier' &&
          PROCESS_STREAM_PROPS.has(node.property.name)
        ) {
          context.report({
            node,
            messageId: 'eagerProcessStream',
            data: { prop: node.property.name },
          })
        }
      },
    }

    if (!eligible) {
      return listener
    }

    // ── snapshot-eligible-only clauses ──
    // CLAUSE 1 — top-level await. Module-scope `await` / `for await`. Reuses
    // no-top-level-await's enclosing-function walk (isLazy) + the same bypass
    // marker, so the two rules agree on what "top-level" means.
    listener['AwaitExpression'] = (node: AstNode) => {
      if (isLazy(node) || hasTlaBypass!(node)) {
        return
      }
      context.report({ node, messageId: 'snapshotTopLevelAwait' })
    }
    listener['ForOfStatement'] = (node: AstNode) => {
      if (!node.await || isLazy(node) || hasTlaBypass!(node)) {
        return
      }
      context.report({ node, messageId: 'snapshotTopLevelAwait' })
    }
    // CLAUSE 2 — variable-path dynamic import. An `import(expr)` whose specifier
    // is not a plain string literal can't be statically resolved by the bundler,
    // so it can't be frozen into the snapshot. Lazy/eager is irrelevant — the
    // bundler resolves at BUILD time — so this fires anywhere in the module, not
    // just at module scope. A literal `import('node:fs')` is fine and passes.
    listener['ImportExpression'] = (node: AstNode) => {
      if (node.source?.type === 'Literal') {
        return
      }
      context.report({ node, messageId: 'snapshotDynamicImport' })
    }

    return listener
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
