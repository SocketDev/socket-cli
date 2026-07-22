#!/usr/bin/env node
// Claude Code PreToolUse hook — no-tsx-guard.
//
// BLOCKS any Bash command that uses `tsx` (or `ts-node`) to run
// TypeScript — as a standalone runner (`tsx foo.mts`, `tsx watch`), or
// as a Node loader (`node --import tsx`, `node --loader tsx`, `node
// --require ts-node/register`, `node --experimental-loader tsx`).
//
// Why tsx is verboten: the fleet pins Node via `.node-version` to a
// release that strips TypeScript types natively, so a `.mts`/`.ts` file
// runs under `node <file>.mts` with no loader. `tsx`/`ts-node` add a
// dependency, a startup cost, and a second TS-execution semantics that
// drifts from what production Node does. CLAUDE.md already bans
// `--experimental-strip-types` for the same reason — this guard closes
// the loader-shaped hole. (`prefer-vitest-guard` separately steers test
// RUNNERS to vitest; this guard owns the broader "no tsx tool, ever"
// rule.)
//
// The fix the message gives:
//   - run a script:   node path/to/script.mts
//   - hook tests:      node --test test/*.test.mts   (from the hook dir)
//   - src/repo tests:  node_modules/.bin/vitest run path/to/foo.test.mts
//
// Detection (AST-parsed via the shared shell-command helper, not a raw
// regex): the command runs the `tsx`/`ts-node` binary, OR a `node`
// invocation carries a `tsx`/`ts-node` loader flag.
//
// Fails open on parse / payload errors (exit 0) — a guard bug must not
// wedge every Bash call.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Pre-flight triggers: the dispatcher skips importing this guard unless
// the raw payload contains one of these substrings. Every blocking path
// requires the literal binary name (`tsx`/`ts-node` as the command) OR a
// loader value naming one (`--import tsx`, `--require ts-node/register`),
// so a command with neither substring can never block — safe to skip.
export const triggers: readonly string[] = ['tsx', 'ts-node']

// The verboten TS-execution binaries.
const TS_RUNNERS = ['tsx', 'ts-node'] as const

// Node loader flags that pull in a TS loader. `--import`/`--loader`/
// `--require`/`--experimental-loader` each take the loader as the NEXT
// token OR glued with `=`. We check whether the value names tsx/ts-node.
const NODE_LOADER_FLAGS = [
  '--import',
  '--loader',
  '--require',
  '--experimental-loader',
] as const

export interface TsxDetection {
  readonly detected: boolean
  // 'runner' — `tsx`/`ts-node` invoked directly.
  // 'loader' — `node --import tsx` (or sibling loader flag).
  readonly kind: 'loader' | 'runner'
  // The offending tool name (tsx / ts-node) for the message.
  readonly tool: string
}

function valueNamesTsRunner(value: string): string | undefined {
  // A loader value can be a bare name (`tsx`), a subpath
  // (`ts-node/register`, `tsx/esm`), or a path ending in it. Match the
  // leading segment so `tsx`, `tsx/esm`, `ts-node/register` all count,
  // but `my-tsx-helper` does not.
  for (let i = 0, { length } = TS_RUNNERS; i < length; i += 1) {
    const runner = TS_RUNNERS[i]!
    if (value === runner || value.startsWith(`${runner}/`)) {
      return runner
    }
  }
  return undefined
}

export function detectTsx(command: string): TsxDetection {
  // (a) `tsx ...` / `ts-node ...` as the binary.
  for (let i = 0, { length } = TS_RUNNERS; i < length; i += 1) {
    const runner = TS_RUNNERS[i]!
    if (commandsFor(command, runner).length > 0) {
      return { detected: true, kind: 'runner', tool: runner }
    }
  }
  // (b) `node ... --import tsx` (or --loader / --require / --experimental-loader).
  const nodeCmds = commandsFor(command, 'node')
  for (const { args } of nodeCmds) {
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      // Glued form: `--import=tsx`.
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        const flag = arg.slice(0, eq)
        if ((NODE_LOADER_FLAGS as readonly string[]).includes(flag)) {
          const tool = valueNamesTsRunner(arg.slice(eq + 1))
          if (tool) {
            return { detected: true, kind: 'loader', tool }
          }
        }
        continue
      }
      // Separated form: `--import tsx` (value is the next token).
      if ((NODE_LOADER_FLAGS as readonly string[]).includes(arg)) {
        const next = args[i + 1]
        const tool = next ? valueNamesTsRunner(next) : undefined
        if (tool) {
          return { detected: true, kind: 'loader', tool }
        }
      }
    }
  }
  return { detected: false, kind: 'runner', tool: 'tsx' }
}

export function formatBlock(d: TsxDetection): string {
  const what =
    d.kind === 'runner'
      ? `\`${d.tool}\` is running TypeScript directly.`
      : `\`node --import ${d.tool}\` loads TypeScript through ${d.tool}.`
  return (
    [
      `[no-tsx-guard] Blocked: ${what}`,
      '',
      `  ${d.tool} is verboten fleet-wide. The \`.node-version\` Node strips`,
      '  TypeScript types natively — run the file directly, no loader:',
      '',
      '    node path/to/script.mts',
      '',
      '  For tests:',
      '    • hook tests (.claude/hooks/**/test/): node --test test/*.test.mts',
      '    • src/repo tests:  node_modules/.bin/vitest run path/to/foo.test.mts',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard(command => {
  if (!command.trim()) {
    return undefined
  }
  const detection = detectTsx(command)
  if (!detection.detected) {
    return undefined
  }
  return block(formatBlock(detection))
})

export const hook = defineHook({
  bypass: ['tsx'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
