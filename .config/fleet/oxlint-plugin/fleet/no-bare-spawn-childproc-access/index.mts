/*
 * @file The fleet `spawn` (`@socketsecurity/lib-stable/process/spawn/child`)
 *   does NOT return a bare `ChildProcess`. It returns `{ process: ChildProcess
 *   } & Promise<{ code, stdout, stderr, … }>` — an enriched Promise that ALSO
 *   rejects on a non-zero exit. So the ChildProcess surface (`.stdin` /
 *   `.stdout` / `.stderr` / `.on` / `.kill` / `.pid` / …) lives on `.process`,
 *   and the resolved value carries `.code` / `.stdout` / `.stderr`. Reaching
 *   for those members on the spawn return value DIRECTLY (`const c =
 *   spawn(...); c.stderr.on(...)`) hits `undefined` — a `TypeError: Cannot read
 *   properties of undefined`. This is not theoretical: it silently broke all 22
 *   git-hook ENTRY tests (pre-commit / pre-push / commit-msg) fleet-wide — each
 *   captured exit via `child.stderr.on` / `child.on('exit')` on a bare
 *   `spawn(...)` result (2026-06-06). The correct forms:
 *
 *   - stream/event surface: `const { process: child } = spawn(...)` then
 *     `child.stderr.on(...)`; or `const c = spawn(...); c.process.stderr`.
 *   - exit code / captured output: `const { code, stderr } = await spawn(...)`
 *     (wrap in try/catch — it rejects on non-zero exit, the error carrying
 *     `.code` + `.stderr`). This rule flags ChildProcess-only member access
 *     (`.stdin` / `.stdout` / `.stderr` / `.on` / `.once` / `.kill` / `.pid` /
 *     `.stdio` / `.disconnect` / `.ref` / `.unref` / `.send` / `.connected` /
 *     `.exitCode` / `.killed`) on an identifier bound to a bare `spawn(...)`
 *     call — i.e. NOT `spawn(...).process` and NOT a destructured `const {
 *     process } = spawn(...)`. Report-only: the fix is contextual (route
 *     through `.process`, or `await` the wrapper), so the human picks. Bypass:
 *     a `socket-lint: allow bare-spawn-access` comment.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Members that live on the ChildProcess (i.e. on `.process`), not on the
// spawn-wrapper Promise. Accessing any of these on the bare return is the bug.
const CHILDPROC_MEMBERS = new Set([
  'connected',
  'disconnect',
  'exitCode',
  'kill',
  'killed',
  'on',
  'once',
  'pid',
  'ref',
  'send',
  'stderr',
  'stdin',
  'stdio',
  'stdout',
  'unref',
])

const ALLOW_RE = /socket-lint:\s*allow\s+bare-spawn-access/

// Is this call expression a `spawn(...)` (bare or `x.spawn(...)`) — the fleet
// wrapper? We match the callee NAME `spawn`; the lib has a single spawn export
// and the fleet bans node:child_process spawn elsewhere (prefer-async-spawn), so
// a `spawn(` call in fleet code is the wrapper.
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
        'The fleet spawn returns `{ process } & Promise`, not a bare ChildProcess — access streams/events via `.process` (or `await` for `.code`/`.stdout`), never directly.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      bareSpawnAccess:
        '`{{name}}` is the fleet spawn return (`process` + Promise), so `.{{member}}` is undefined — it lives on `{{name}}.process`. Destructure `const { process: child } = spawn(...)` for streams/events, or `await spawn(...)` (try/catch — it rejects on non-zero) for `.code`/`.stdout`/`.stderr`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, ALLOW_RE)
    // Identifiers bound to a bare `spawn(...)` call this file. `const c =
    // spawn(...)` adds `c`; `const c = spawn(...).process` and
    // `const { process } = spawn(...)` do NOT (those already route correctly).
    const bareSpawnNames = new Set<string>()
    return {
      VariableDeclarator(node: AstNode) {
        const id = node.id
        const init = node.init
        if (!id || id.type !== 'Identifier' || !init) {
          return
        }
        if (isSpawnCall(init)) {
          bareSpawnNames.add(id.name)
        }
      },
      MemberExpression(node: AstNode) {
        if (node.computed) {
          return
        }
        const obj = node.object
        const prop = node.property
        if (
          !obj ||
          obj.type !== 'Identifier' ||
          !bareSpawnNames.has(obj.name) ||
          !prop ||
          prop.type !== 'Identifier' ||
          !CHILDPROC_MEMBERS.has(prop.name)
        ) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        context.report({
          node,
          messageId: 'bareSpawnAccess',
          data: { name: obj.name, member: prop.name },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
