#!/usr/bin/env node
/*
 * @file CLI wrapper for the rolling dependency PR's body composer. Reads the
 *   previous body on stdin, empty for a first run, and writes the refreshed body
 *   to stdout, so the workflow step stays a pipe and never does markdown
 *   surgery in bash.
 *
 *   Usage:
 *     printf '%s' "$BODY" |
 *       node scripts/fleet/weekly-update/pr-body-cli.mts \
 *         --base main --date 2026-08-04 --run-url <url> \
 *         --before-pkg /tmp/pkg-before.json --after-pkg /tmp/pkg-after.json \
 *         --before-workspace /tmp/ws-before.yaml \
 *         --after-workspace /tmp/ws-after.yaml \
 *         [--line '- subject']…
 *
 *   Both file pairs are optional. Without them the entry still renders, just
 *   with no dependency table, which is what a run that changed only lockfile
 *   metadata should say. The WORKSPACE pair is the one that usually matters:
 *   the fleet routes its exact pins through pnpm's catalog, so package.json
 *   reads `catalog:` on both sides while the version moves in the catalog.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import {
  collectPins,
  diffDeps,
  renderDepChanges,
  summarizeDepChanges,
} from './dep-changes.mts'
import { buildEntry, composePrBody } from './pr-body.mts'

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}

function flags(argv: readonly string[], name: string): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1] !== undefined) {
      out.push(argv[i + 1] as string)
    }
  }
  return out
}

// A file that is missing or unreadable reads as empty rather than throwing. A
// body is more useful than a crashed step.
function readOrEmpty(filepath: string | undefined): string {
  if (!filepath) {
    return ''
  }
  try {
    return readFileSync(filepath, 'utf8')
  } catch {
    return ''
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return ''
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const base = flag(argv, '--base') ?? 'main'
  const date = flag(argv, '--date') ?? new Date().toISOString().slice(0, 10)
  const runUrl = flag(argv, '--run-url') ?? ''
  // The catalog is the primary source: the fleet pins exact versions through
  // pnpm's catalog protocol, so the manifest says `catalog:` while the version
  // moves in pnpm-workspace.yaml.
  const changes = diffDeps(
    collectPins({
      manifestText: readOrEmpty(flag(argv, '--before-pkg')),
      workspaceText: readOrEmpty(flag(argv, '--before-workspace')),
    }),
    collectPins({
      manifestText: readOrEmpty(flag(argv, '--after-pkg')),
      workspaceText: readOrEmpty(flag(argv, '--after-workspace')),
    }),
  )
  const previousRaw = await readStdin()
  const previous = previousRaw.trim() === '' ? undefined : previousRaw
  process.stdout.write(
    composePrBody({
      base,
      date,
      entry: buildEntry({
        commits: flags(argv, '--line'),
        date,
        depTable: renderDepChanges(changes),
        note: summarizeDepChanges(changes),
        runUrl,
      }),
      previous,
    }),
  )
}

void main()
