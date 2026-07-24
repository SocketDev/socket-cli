#!/usr/bin/env node
/**
 * @file Prove a submodule's `sparse-checkout` pattern is build-sufficient by
 *   running the thing that consumes it. A too-narrow pattern (a missing build
 *   header, an unwalked fixture dir) only breaks at use; static analysis can
 *   miss it. This makes the determine→VERIFY step of `optimizing-submodules`
 *   enforceable code instead of a habit: the pattern isn't trusted until the
 *   declared consumer runs green against a sparse checkout. Each submodule
 *   declares its consumer in `.gitmodules` as a `verify =` field: verify = pnpm
 *   --filter @x/parser test # the command that uses it verify = none #
 *   reference-only — nothing builds against it A submodule that has a
 *   `sparse-checkout` but no `verify` is a gap: the pattern was set without
 *   declaring how it's proven. `--check` fails on that. Modes: --check
 *   [<.gitmodules>] every sparse submodule has a `verify =`; exit 1 on a gap
 *   --run <name|path> [<.gitmodules>] sparse-populate one submodule + run its
 *   `verify =`; exit 1 on failure --run-all [<.gitmodules>] run every
 *   non-`none` verify (CI / on-cadence; heavy). `--run*` sparse-populates the
 *   submodule IN PLACE at its repo path (via git-partial-submodule clone, which
 *   honors the sparse-checkout field) and runs the consumer FROM THE REPO ROOT,
 *   so a superproject `pnpm --filter` test sees the submodule + the workspace
 *   around it. (Running from an isolated temp clone matches no workspace
 *   project and exits 0 — a false green.)
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const USAGE = `verify-submodule-sparse — prove a sparse-checkout pattern is build-sufficient

Usage:
  verify-submodule-sparse.mts --check [<.gitmodules>]            every sparse block declares a \`verify =\`
  verify-submodule-sparse.mts --run <name|path> [<.gitmodules>]  clone sparse + run that block's \`verify =\`
  verify-submodule-sparse.mts --run-all [<.gitmodules>]          run every non-\`none\` verify

Declare the consumer in .gitmodules:  verify = <command>   |   verify = none
`

export interface SubmoduleBlock {
  // Quoted name from `[submodule "<name>"]`.
  name: string
  // `path =` value.
  path: string | undefined
  // `url =` value.
  url: string | undefined
  // `sparse-checkout =` patterns (space-separated), else undefined.
  sparse: string | undefined
  // `verify =` consumer command, the literal `none`, or undefined when absent.
  verify: string | undefined
}

// Parse `.gitmodules` into blocks with the fields this tool reads. Uses git's
// own config reader semantics (one section per `[submodule "<name>"]`).
export function parseBlocks(text: string): SubmoduleBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: SubmoduleBlock[] = []
  let current: SubmoduleBlock | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const open = /^\s*\[submodule\s+"([^"]+)"\s*\]\s*$/.exec(lines[i]!)
    if (open) {
      current = {
        name: open[1]!,
        path: undefined,
        url: undefined,
        sparse: undefined,
        verify: undefined,
      }
      blocks.push(current)
      continue
    }
    if (!current) {
      continue
    }
    // A `key = value` config line: captures (1) the key token, (2) the value
    // (trimmed of surrounding whitespace).
    const kv = /^\s*([\w-]+)\s*=\s*(.*?)\s*$/.exec(lines[i]!)
    if (!kv) {
      continue
    }
    const [, key, value] = kv
    if (key === 'path') {
      current.path = value
    } else if (key === 'url') {
      current.url = value
    } else if (key === 'sparse-checkout' && value) {
      current.sparse = value
    } else if (key === 'verify' && value) {
      current.verify = value
    }
  }
  return blocks
}

// `--check`: every block with a sparse-checkout must declare a `verify =`
// (a real command or `none`). A sparse pattern with no verify is unproven.
function runCheck(blocks: SubmoduleBlock[]): number {
  const gaps = blocks.filter(b => b.sparse && !b.verify)
  if (gaps.length === 0) {
    const declared = blocks.filter(b => b.verify).length
    logger.success(
      `verify-submodule-sparse: ${declared} sparse block(s) declare a \`verify =\` consumer.`,
    )
    return 0
  }
  for (let i = 0, { length } = gaps; i < length; i += 1) {
    const g = gaps[i]!
    logger.fail(
      `[submodule "${g.name}"] has a \`sparse-checkout\` but no \`verify =\` — declare the command that consumes it (so the pattern can be build-proven), or \`verify = none\` for a reference-only checkout.`,
    )
  }
  logger.fail(
    `verify-submodule-sparse: ${gaps.length} sparse block(s) with no declared consumer — the pattern is unproven until one is named.`,
  )
  return 1
}

// Populate the submodule IN PLACE (sparse, per its recorded pattern) at its
// real repo path, then run its `verify =` consumer FROM THE REPO ROOT — the
// consumer is a superproject build/test (`pnpm --filter @x test`), so it must
// see the submodule at its path with the workspace around it, not an isolated
// temp clone (which would match no workspace project and exit 0 — false green).
// Returns 0 on a green consumer, 1 otherwise. Leaves the submodule populated
// (caller's working tree); a fresh `git-partial-submodule.mts clone` is
// idempotent and the repo's own checkout state is the operator's to manage.
async function runOne(
  block: SubmoduleBlock,
  repoRoot: string,
): Promise<number> {
  if (!block.verify || block.verify === 'none') {
    logger.log(
      `${block.name}: verify = ${block.verify ?? '<unset>'} — nothing to run.`,
    )
    return 0
  }
  if (!block.path) {
    logger.fail(`${block.name}: no \`path =\` to populate.`)
    return 1
  }
  // Sparse-populate the submodule at its real path via the fleet helper, which
  // honors the `.gitmodules` sparse-checkout field.
  const populated = await spawn(
    'node',
    ['scripts/fleet/git-partial-submodule.mts', 'clone', block.path],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (populated.code !== 0) {
    logger.fail(
      `${block.name}: sparse populate (git-partial-submodule clone) failed.`,
    )
    return 1
  }
  logger.log(
    `${block.name}: running \`${block.verify}\` from the repo root against the sparse submodule…`,
  )
  // prefer-shell-win32: intentional — `verify =` is an operator-declared
  // command LINE (e.g. `pnpm --filter @x/parser test`), so sh/cmd parsing of
  // the string IS the feature; it must shell-wrap on every platform, not just
  // Windows. Trusted repo config, same trust level as a build script.
  const ran = await spawn(block.verify, [], {
    cwd: repoRoot,
    shell: true,
    stdio: 'inherit',
  })
  if (ran.code !== 0) {
    logger.fail(
      `${block.name}: consumer FAILED against sparse \`${block.sparse ?? '<full>'}\` — the pattern is too narrow (a needed path isn't checked out) or the consumer is broken. Widen the pattern and re-run.`,
    )
    return 1
  }
  logger.success(
    `${block.name}: verified — sparse \`${block.sparse ?? '<full>'}\` is build-sufficient.`,
  )
  return 0
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const mode = argv.find(
    a => a === '--check' || a === '--run' || a === '--run-all',
  )
  if (!mode) {
    process.stderr.write(USAGE)
    process.exit(2)
  }
  const consumed = new Set<number>()
  const runIdx = argv.indexOf('--run')
  const selector = runIdx >= 0 ? argv[runIdx + 1] : undefined
  if (runIdx >= 0) {
    consumed.add(runIdx)
    consumed.add(runIdx + 1)
  }
  // Anchor on the script's own location (scripts/fleet/verify-submodule-sparse.mts),
  // not process.cwd() — the repo root is two directories up. The verify
  // consumer runs from here and .gitmodules lives here.
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  )
  const fileArg = argv.find(
    (a, idx) => !a.startsWith('--') && !consumed.has(idx),
  )
  const gitmodulesPath = fileArg
    ? path.resolve(fileArg)
    : path.join(repoRoot, '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    // No .gitmodules means no submodules — nothing to verify. For --check and
    // --run-all that's a clean pass (the same way submodules-are-sparse-or-
    // annotated treats an absent file). Only --run, which targets a specific
    // named submodule the caller asked to verify, is a real error here.
    if (mode === '--run') {
      logger.fail(
        `verify-submodule-sparse --run: no .gitmodules at ${gitmodulesPath} — there are no submodules to verify.`,
      )
      process.exit(1)
    }
    logger.success(
      'verify-submodule-sparse: no .gitmodules — no submodules to verify.',
    )
    process.exit(0)
  }
  const blocks = parseBlocks(readFileSync(gitmodulesPath, 'utf8'))

  if (mode === '--check') {
    process.exitCode = runCheck(blocks)
    return
  }
  if (mode === '--run') {
    if (!selector || selector.startsWith('--')) {
      logger.fail('verify-submodule-sparse --run: needs a <name|path>.')
      process.exit(2)
    }
    const block = blocks.find(b => b.name === selector || b.path === selector)
    if (!block) {
      logger.fail(
        `verify-submodule-sparse --run: no submodule matching \`${selector}\`.`,
      )
      process.exit(1)
    }
    process.exitCode = await runOne(block, repoRoot)
    return
  }
  // --run-all
  let failures = 0
  for (let i = 0, { length } = blocks; i < length; i += 1) {
    failures += await runOne(blocks[i]!, repoRoot)
  }
  if (failures > 0) {
    logger.fail(
      `verify-submodule-sparse: ${failures} submodule(s) failed verification.`,
    )
    process.exitCode = 1
    return
  }
  process.exitCode = 0
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`verify-submodule-sparse: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
