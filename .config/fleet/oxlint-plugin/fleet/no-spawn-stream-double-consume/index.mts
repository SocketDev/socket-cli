/**
 * @file The fleet `spawn` (`@socketsecurity/lib-stable/process/spawn/child`)
 *   BUFFERS the child's stdout/stderr internally — that is how the awaited
 *   result carries `.stdout` / `.stderr`. Calling `.setEncoding(enc)` on one of
 *   those streams flips it to STRING mode globally, so the wrapper's own
 *   internal `data` listener then receives STRINGS, and its close-time
 *   `Buffer.concat([...])` throws `TypeError: list[0] must be a Buffer`. This
 *   is not theoretical — it broke socket-lib's secrets {macos,linux,windows}
 *   backends, which called `.setEncoding('utf8')` on a stream the lib was
 *   concurrently buffering. The fix is to read the captured output from the
 *   AWAITED result instead: `const { stdout } = await spawn(cmd, args, {
 *   stdioString: true })` (wrap in try/catch — the wrapper rejects on a
 *   non-zero exit, the error carrying `.code` + `.stdout` + `.stderr`). If you
 *   genuinely need to stream the output yourself, pass `stdio` options so the
 *   wrapper does not also buffer. This rule flags ONLY `.setEncoding(...)` on
 *   the `.stdout` / `.stderr` of a fleet `spawn(...)` child reached through
 *   `.process` (`const { process } = spawn(...)` then
 *   `process.stdout.setEncoding(...)`, `const c = spawn(...);
 *   c.process.stderr.setEncoding(...)`, an intermediate `const s =
 *   c.process.stdout`, or the inline `spawn(...).process.stdout.setEncoding`).
 *   A plain `.on('data')` / `.pipe()` WITHOUT `setEncoding` keeps the stream in
 *   Buffer mode, so the wrapper's concat still works — that is a legitimate
 *   streaming pattern (a hook test streaming stderr does it) and is NOT
 *   flagged. Accessing the stream off the BARE spawn return (`const c =
 *   spawn(...); c.stdout.on(...)`) is a different bug caught by
 *   `socket/no-bare-spawn-childproc-access`. Report-only: the right fix is
 *   contextual (await the wrapper, or pass `stdio` options), so the human
 *   picks. Bypass: a `socket-lint: allow spawn-stream-double-consume` comment
 *   on or just above the flagged line.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// The crash-triggering method. `.setEncoding(enc)` flips the stream to STRING
// mode globally, so the wrapper's own internal `data` listener then receives
// strings and its close-time `Buffer.concat` throws `list[0] must be a Buffer`.
// A plain `.on('data')` / `.pipe()` WITHOUT setEncoding keeps Buffer mode — the
// wrapper's concat still works, so those are legitimate streaming (a hook test
// that streams stderr and calls `chunk.toString()` does exactly this) and are
// deliberately NOT flagged; only the encoding flip is a deterministic crash.
const CRASH_METHOD = 'setEncoding'

const STREAM_PROPS = new Set(['stderr', 'stdout'])

const ALLOW_RE = /socket-lint:\s*allow\s+spawn-stream-double-consume/

// Is this call expression a `spawn(...)` (bare or `x.spawn(...)`) — the fleet
// wrapper? Mirrors no-bare-spawn-childproc-access: match the callee NAME
// `spawn`; the lib has a single spawn export and node:child_process spawn is
// banned elsewhere (prefer-async-spawn), so a `spawn(` call in fleet code is it.
function isSpawnCall(node: AstNode | undefined): boolean {
  if (!node || node.type !== 'CallExpression') {
    return false
  }
  const callee = node.callee
  if (!callee) {
    return false
  }
  if (callee.type === 'Identifier') {
    return callee.name === 'spawn'
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property?.type === 'Identifier'
  ) {
    return callee.property.name === 'spawn'
  }
  return false
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Do not call `.setEncoding()` on a fleet-spawn child stdout/stderr stream the wrapper already buffers — the encoding flip crashes the lib `Buffer.concat`. Read the awaited result instead (a plain `.on("data")` without setEncoding is fine).',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      spawnStreamDoubleConsume:
        "`.{{method}}()` on a fleet-spawn child stdout/stderr flips a stream the spawn wrapper is already buffering as Buffers into string mode, so the wrapper`s close-time `Buffer.concat` throws `TypeError: list[0] must be a Buffer`. Read the captured output from the awaited result instead: `const { stdout } = await spawn(cmd, args, { stdioString: true })` (try/catch — it rejects on non-zero, the error carrying `.code`/`.stdout`/`.stderr`). To stream raw output yourself, pass `stdio` options so the wrapper does not also buffer (a plain `.on('data')` without setEncoding is fine — only the encoding flip crashes).",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, ALLOW_RE)
    // Identifiers bound to a bare `spawn(...)` call (`const c = spawn(...)`).
    const spawnNames = new Set<string>()
    // Identifiers bound to a spawn child's `.process` (the ChildProcess).
    const procNames = new Set<string>()
    // Identifiers bound to a spawn child's `.stdout`/`.stderr` stream.
    const streamNames = new Set<string>()

    // `<spawnName>.process` or `spawn(...).process` — the ChildProcess expr.
    function isSpawnProcessExpr(node: AstNode | undefined): boolean {
      if (
        !node ||
        node.type !== 'MemberExpression' ||
        node.computed ||
        node.property?.type !== 'Identifier' ||
        node.property.name !== 'process'
      ) {
        return false
      }
      const obj = node.object
      if (!obj) {
        return false
      }
      if (obj.type === 'Identifier') {
        return spawnNames.has(obj.name)
      }
      return isSpawnCall(obj)
    }

    // A reference to a spawn child's ChildProcess: a tracked `procNames` id, or
    // an inline `<spawn>.process` expression.
    function isSpawnProcessRef(node: AstNode | undefined): boolean {
      if (!node) {
        return false
      }
      if (node.type === 'Identifier') {
        return procNames.has(node.name)
      }
      return isSpawnProcessExpr(node)
    }

    // `<spawnProcessRef>.stdout` / `.stderr` — the buffered stream expression.
    function isSpawnStreamExpr(node: AstNode | undefined): boolean {
      if (
        !node ||
        node.type !== 'MemberExpression' ||
        node.computed ||
        node.property?.type !== 'Identifier' ||
        !STREAM_PROPS.has(node.property.name)
      ) {
        return false
      }
      return isSpawnProcessRef(node.object)
    }

    // The receiver of the consuming call is a spawn stdout/stderr stream: a
    // tracked `streamNames` id, or an inline `<spawnProcessRef>.stdout`.
    function isSpawnStream(node: AstNode | undefined): boolean {
      if (!node) {
        return false
      }
      if (node.type === 'Identifier') {
        return streamNames.has(node.name)
      }
      return isSpawnStreamExpr(node)
    }

    return {
      VariableDeclarator(node: AstNode) {
        const id = node.id
        const init = node.init
        if (!id || !init) {
          return
        }
        if (id.type === 'Identifier') {
          if (isSpawnCall(init)) {
            spawnNames.add(id.name)
          } else if (isSpawnProcessExpr(init)) {
            procNames.add(id.name)
          } else if (isSpawnStreamExpr(init)) {
            streamNames.add(id.name)
          }
          return
        }
        if (id.type !== 'ObjectPattern' || !Array.isArray(id.properties)) {
          return
        }
        // Destructuring: `const { process: child } = spawn(...)` adds a proc
        // name; `const { stdout: s } = child` (child a proc ref) adds a stream.
        const fromSpawn =
          isSpawnCall(init) ||
          (init.type === 'Identifier' && spawnNames.has(init.name))
        const fromProc = isSpawnProcessRef(init)
        for (let i = 0, { length } = id.properties; i < length; i += 1) {
          const p = id.properties[i]
          if (
            !p ||
            p.type !== 'Property' ||
            p.computed ||
            p.key?.type !== 'Identifier' ||
            p.value?.type !== 'Identifier'
          ) {
            continue
          }
          if (fromSpawn && p.key.name === 'process') {
            procNames.add(p.value.name)
          } else if (fromProc && STREAM_PROPS.has(p.key.name)) {
            streamNames.add(p.value.name)
          }
        }
      },
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (
          !callee ||
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property?.type !== 'Identifier'
        ) {
          return
        }
        if (callee.property.name !== CRASH_METHOD) {
          return
        }
        if (!isSpawnStream(callee.object)) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        context.report({
          node,
          messageId: 'spawnStreamDoubleConsume',
          data: { method: CRASH_METHOD },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
