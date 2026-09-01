#!/usr/bin/env node
/**
 * @file Accrue one note under CHANGELOG.md's `## [Unreleased]` heading from the
 *   command line, so automation that bumps a dependency here writes its note
 *   the way a human does. The counterpart to `bump.mts`, which promotes the
 *   block at release time.
 *
 *   This exists so a caller never has to reimplement the shape.
 *
 *   Usage:
 *     node scripts/release/add-unreleased.mts [flags] <entry>
 *
 *   Example — the Coana bump, which reruns on every Coana release:
 *     node scripts/release/add-unreleased.mts \
 *       --replace '^Updated the Coana CLI to v ' \
 *       'Updated the Coana CLI to v `15.10.28`.'
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { addUnreleasedEntry } from './changelog.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { ScriptMeta } from '../lib/run-main.mts'

const DEFAULT_FILE = 'CHANGELOG.md'
const DEFAULT_SECTION = 'Changed'

export interface AddUnreleasedArgs {
  readonly entry: string
  readonly file: string
  readonly replace: RegExp | undefined
  readonly section: string
}

/**
 * Parse the script's argv. Pure — exported for tests.
 *
 * `--` never reaches here: `runMain` refuses a bare one, because the truncation
 * it causes drops flags silently.
 */
export function parseArgs(argv: readonly string[]): AddUnreleasedArgs {
  const positional: string[] = []
  let file = DEFAULT_FILE
  let replace: RegExp | undefined
  let section = DEFAULT_SECTION
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const value = argv[i + 1]
      if (value === undefined) {
        throw new Error(
          `[add-unreleased] ${arg} needs a value.\n` +
            `  Fix: pass one, e.g. \`${arg} <value>\`.`,
        )
      }
      i += 1
      if (arg === '--file') {
        file = value
      } else if (arg === '--replace') {
        // Unicode mode for parity with the patterns in changelog.mts. Not
        // global: `addUnreleasedEntry` matches once per bullet, and a lastIndex
        // carried between bullets would skip every other one.
        replace = new RegExp(value, 'u')
      } else if (arg === '--section') {
        section = value
      } else {
        throw new Error(
          `[add-unreleased] unknown flag ${arg}.\n` +
            '  Known: --file, --replace, --section.',
        )
      }
    } else {
      positional.push(arg)
    }
  }
  if (positional.length !== 1) {
    throw new Error(
      `[add-unreleased] expected exactly one entry, saw ${positional.length}.\n` +
        '  Where: the argv for add-unreleased.\n' +
        '  Fix: quote the entry as a single argument, e.g. ' +
        "`node scripts/release/add-unreleased.mts 'Updated the Coana CLI to v `15.10.28`.'`.",
    )
  }
  // A leading `- ` is how the line reads in the file, so a caller passing one
  // is quoting the changelog rather than misusing the script. Accept it.
  const entry = positional[0]!.replace(/^-\s+/, '').trim()
  if (!entry) {
    throw new Error('[add-unreleased] the entry is empty.')
  }
  return { entry, file, replace, section }
}

function log(message: string): void {
  process.stdout.write(`[add-unreleased] ${message}\n`)
}

function main(): void {
  const { entry, file, replace, section } = parseArgs(process.argv.slice(2))
  const changelog = readFileSync(file, 'utf8')
  const updated = addUnreleasedEntry({ changelog, entry, replace, section })
  if (updated === changelog) {
    log(`${file} already reads "${entry}" under ## [Unreleased] / ${section}.`)
    return
  }
  writeFileSync(file, updated)
  log(`${file}, under ## [Unreleased] / ${section}:`)
  process.stdout.write(`  - ${entry}\n`)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "adds one note under CHANGELOG.md's ## [Unreleased] heading, leaving the version and the release headings to the release workflow",
  help: `Usage: node scripts/release/add-unreleased.mts [flags] <entry>

  --file <path>      changelog to edit (default: ${DEFAULT_FILE})
  --replace <regex>  rewrite the first bullet in the section whose text matches,
                     instead of appending a second one — for a note that reruns,
                     such as a dependency bump updating its own line
  --section <name>   Keep a Changelog section (default: ${DEFAULT_SECTION})

  <entry> is the bullet's text; a leading "- " is optional. The block is created
  when the previous release consumed it, so there is always somewhere to write.

  This never touches package.json's version or a ## [X.Y.Z] heading. Both belong
  to the release workflow, which derives the version from the release tags and
  promotes the whole ## [Unreleased] block under a heading it writes itself.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
