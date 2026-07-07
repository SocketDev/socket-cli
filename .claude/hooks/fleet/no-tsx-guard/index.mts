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
// Bypass: `Allow tsx bypass` typed verbatim in a recent user turn.
//
// Fails open on parse / payload errors (exit 0) — a guard bug must not
// wedge every Bash call.

import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'
import { commandsFor } from '../_shared/shell-command.mts'

const BYPASS_PHRASE = 'Allow tsx bypass' as const

interface Payload {
  tool_name?: unknown | undefined
  tool_input?: { command?: unknown | undefined } | undefined
  transcript_path?: unknown | undefined
}

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
      '',
      `  Bypass: type "${BYPASS_PHRASE}" to allow it for this invocation.`,
    ].join('\n') + '\n'
  )
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: Payload
  try {
    payload = JSON.parse(raw) as Payload
  } catch {
    process.exit(0)
  }

  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }

  const command =
    typeof payload.tool_input?.command === 'string'
      ? payload.tool_input.command
      : ''
  if (!command.trim()) {
    process.exit(0)
  }

  const detection = detectTsx(command)
  if (!detection.detected) {
    process.exit(0)
  }

  const transcriptPath =
    typeof payload.transcript_path === 'string'
      ? payload.transcript_path
      : undefined
  if (
    transcriptPath &&
    bypassPhrasePresent(transcriptPath, [BYPASS_PHRASE], 3)
  ) {
    process.exit(0)
  }

  process.stderr.write(formatBlock(detection))
  process.exit(2)
}

// Entrypoint-guarded: run main() only when invoked directly, NOT when the test
// imports this module for its pure helpers (else main() blocks on stdin at
// import and the test file never terminates).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
