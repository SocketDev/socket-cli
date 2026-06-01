/**
 * @file Per fleet "Tooling" rule: don't shell out to `which` / `command -v` /
 *   `where` to locate a project binary. Fleet code spawns binaries that `pnpm
 *   install` links into `node_modules/.bin` — a `which`/`command -v` lookup
 *   searches the GLOBAL PATH instead, which is wrong on two counts:
 *
 *   1. On a normal checkout the binary isn't on the global PATH, so the lookup
 *      returns nothing and the calling code silently degrades (a test harness
 *      skips, a tool falls back, etc.) instead of using the locally-installed
 *      version.
 *   2. If a global binary of a DIFFERENT version happens to exist, the code runs
 *      against the wrong engine. Use `whichSync(name, { path:
 *      <node_modules/.bin dir>, nothrow: true })` from
 *      `@socketsecurity/lib-stable/bin/which` (it validates existence + the
 *      platform `.cmd` wrapper), or resolve the `.bin` path directly. Detects
 *      string literals that invoke the lookup commands — either as a bare
 *      argv[0] (`spawnSync('which', ['oxlint'])`) or as the head of a shell
 *      string (`execSync('which oxlint')`, `'command -v foo'`). Reporting only
 *      (no autofix): the right replacement depends on which `.bin` dir to scope
 *      to and whether the caller is sync/async. Allowed (skipped):
 *
 *   - The plugin's own rules/ + test/ files (this file names the banned commands
 *     as lookup-table data / fixtures).
 *   - Lines carrying a `socket-hook: allow which-lookup` comment — for the rare
 *     case that legitimately needs a global PATH search (e.g. locating the
 *     user's real `git` / system tool, not a project dependency).
 */

import { makeBypassChecker } from '../lib/comment-markers.mts'
import { isPluginSelfFile } from '../lib/fleet-paths.mts'
import type { AstNode, RuleContext } from '../lib/rule-types.mts'

// A full PATH-lookup shell string: a lookup command followed by exactly one
// binary-name token (and nothing more). `command -v` / `command -V` and
// `type -P` are the POSIX-portable forms; `which` / `where` are the direct
// commands. The single-token tail is what separates a real lookup
// (`which oxlint`, `command -v pnpm`) from prose that merely starts with the
// word "which" (`which file do you want?`) — the latter has multiple
// whitespace-separated words after the command and so doesn't match.
//
// We deliberately do NOT flag a bare `'which'` / `'where'` literal (the
// argv[0]-to-spawn form, `spawnSync('which', ['oxlint'])`): the word "which"
// appears too often in ordinary strings to flag from the literal alone without
// dataflow analysis, which would produce constant false positives. The shell-
// string form below carries unambiguous lookup intent.
const SHELL_LOOKUP_RE =
  /^(?:command\s+-[vV]|type\s+-P|where|which)\s+[\w./@+-]+$/

// socket-hook: allow which-lookup -- this marker string is the rule's own bypass token, not a real usage.
const BYPASS_RE = /socket-hook:\s*allow\s+which-lookup/

/**
 * True when `value` is a string that invokes a PATH-lookup command, either as a
 * bare command name (argv[0] form) or as the head of a shell string.
 */
export function isWhichLookup(value: string): boolean {
  return SHELL_LOOKUP_RE.test(value.trim())
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Do not shell out to `which` / `command -v` / `where` to locate a project binary — resolve from `node_modules/.bin` via `whichSync({ path })` from @socketsecurity/lib-stable/bin/which.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      whichLookup:
        '`{{cmd}}` shells out to search the GLOBAL PATH for a binary — fleet binaries live in `node_modules/.bin`. Use `whichSync(name, { path: <binDir>, nothrow: true })` from @socketsecurity/lib-stable/bin/which (handles the `.cmd` wrapper + existence check), or resolve the `.bin` path directly. If you really need a global lookup (system git, etc.), add `// socket-hook: allow which-lookup`.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    // This rule's own source + test fixtures contain the banned command names
    // as data; exempt the plugin's internal dirs.
    if (isPluginSelfFile(context)) {
      return {}
    }

    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)

    function check(node: AstNode, value: unknown): void {
      if (typeof value !== 'string' || !isWhichLookup(value)) {
        return
      }
      if (hasBypassComment(node)) {
        return
      }
      context.report({
        node,
        messageId: 'whichLookup',
        data: { cmd: value.trim().split(/\s+/)[0] ?? value.trim() },
      })
    }

    return {
      Literal(node: AstNode) {
        check(node, (node as { value?: unknown | undefined }).value)
      },
      TemplateElement(node: AstNode) {
        const cooked = (
          node as { value?: { cooked?: string | undefined } | undefined }
        ).value?.cooked
        check(node, cooked)
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
