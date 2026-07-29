#!/usr/bin/env node
// Claude Code PreToolUse hook — use-repo-test-script-guard.
//
// Blocks invoking a test runner DIRECTLY (`npx vitest`, `node --test`,
// `npx jest`, …) when the repo's own package.json already defines a
// script that runs it.
//
// Why this exists: a repo's runner is not inferable from the file
// extension, the directory name, or from a sibling repo. Guessing it
// produces output that reads as a defect in the CODE rather than an
// error in the invocation, which is how it wastes the most time. Real
// incident: `npx vitest run src/**` in a non-fleet repo reported "No
// test suite found in file" — that repo runs `src/**` under node:test
// via `npm run test:unit` and uses vitest only for `test/**`. The file
// was fine; the command was wrong. A fleet convention had been carried
// into a repo that is not a fleet member.
//
// The repo's own scripts are the law. They encode the runner, the
// flags, the config path, the setup files, and the env — none of which
// a hand-written invocation reproduces by accident.
//
// DENIES (only when a matching script exists):
//   - npx vitest run …            → npm run test:unit
//   - node --test 'src/**/*.mts'  → npm run test:unit
//   - pnpm exec jest              → npm run test
//
// ALLOWS:
//   - the package script itself (npm/pnpm run <script>)
//   - a direct run when NO script matches that runner — there is nothing
//     better to point at, and blocking would leave no way to run tests
//   - any non-test command
//
// Bypass: `Allow direct test runner`, typed by the human in a genuine
// user turn.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { parseCommands } from '../_shared/shell-command.mts'

const NAME = 'use-repo-test-script-guard'

export const triggers: readonly string[] = [
  'vitest',
  'jest',
  'mocha',
  '--test',
  'ava',
]

// Runner -> the token that identifies it inside a package script.
export const RUNNERS: ReadonlyArray<{
  readonly id: string
  readonly label: string
}> = [
  { id: 'vitest', label: 'vitest' },
  { id: 'jest', label: 'jest' },
  { id: 'mocha', label: 'mocha' },
  { id: 'ava', label: 'ava' },
  // node's built-in runner is a FLAG, not a binary name.
  { id: '--test', label: 'node --test' },
]

/**
 * Which runner, if any, this argv invokes directly.
 *
 * `npm run x` / `pnpm run x` are the sanctioned path and never match,
 * even though the script they run contains the runner name.
 */
export function directRunner(argv: readonly string[]): string | undefined {
  if (!argv.length) {
    return undefined
  }
  const [bin, ...rest] = argv as [string, ...string[]]
  // Running a package script IS the thing this guard wants; never match it.
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(bin) && rest[0] === 'run') {
    return undefined
  }
  const words = [bin, ...rest]
  for (let i = 0, { length } = RUNNERS; i < length; i += 1) {
    const runner = RUNNERS[i]!
    if (runner.id === '--test') {
      if (bin === 'node' && rest.includes('--test')) {
        return runner.label
      }
      continue
    }
    // `vitest …`, `npx vitest …`, `pnpm exec vitest …`
    if (words.some(w => w === runner.id || w.endsWith(`/${runner.id}`))) {
      return runner.label
    }
  }
  return undefined
}

/**
 * Every package script that runs `runner`.
 *
 * Returns ALL of them rather than guessing one. A repo commonly has
 * `test:unit` for `src/**` and `test:e2e` for `test/**`, and picking by a
 * heuristic (shortest name, first declared) sends the caller to the wrong
 * suite — worse than saying nothing, because it looks authoritative.
 * Verified against a real repo: a `src/` file "suggested" the e2e script.
 */
export function scriptsFor(
  scripts: Readonly<Record<string, string>>,
  runner: string,
): string[] {
  const token = runner === 'node --test' ? '--test' : runner
  return Object.entries(scripts)
    .filter(([, body]) => body.includes(token))
    .map(([name]) => name)
    .toSorted()
}

function readScripts(cwd: string): Record<string, string> {
  const pkgPath = path.join(cwd, 'package.json')
  if (!existsSync(pkgPath)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}
  } catch {
    return {}
  }
}

const check = bashGuard(command => {
  for (const cmd of parseCommands(command)) {
    const runner = directRunner([cmd.binary, ...cmd.args])
    if (!runner) {
      continue
    }
    const scripts = scriptsFor(readScripts(resolveProjectDir()), runner)
    if (!scripts.length) {
      // Nothing better to point at — do not strand the caller.
      continue
    }
    return block(
      [
        `🚨 ${NAME}: refusing a direct \`${runner}\` run — this repo defines its own script for it.`,
        '',
        ...scripts.map(name => `  npm run ${name}`),
        '',
        ...(scripts.length > 1
          ? [
              'Pick the one whose glob covers the files you mean — they differ.',
              '',
            ]
          : []),
        "A repo's runner is not inferable from the file extension, the directory",
        'name, or from a sibling repo, and the script encodes the config path,',
        'setup files, flags and env that a hand-written invocation does not.',
        'Guessing produces output that reads as a defect in the CODE rather than',
        'an error in the command — e.g. vitest reporting "No test suite found"',
        'for a file whose repo runs it under node:test.',
        '',
        'To run a subset, pass the path through the script:',
        `  npm run ${scripts[0]} -- <path>`,
      ].join('\n'),
    )
  }
  return undefined
})

export const hook = defineHook({
  bypass: ['direct-test-runner'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
