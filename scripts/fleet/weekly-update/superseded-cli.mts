#!/usr/bin/env node
/*
 * @file Print the PR numbers the rolling dependency PR supersedes, one per
 *   line, so the workflow can close them in a loop without parsing JSON in
 *   bash.
 *
 *   Usage:
 *     gh pr list --repo "$REPO" --state open \
 *       --json number,headRefName,labels,author |
 *       node scripts/fleet/weekly-update/superseded-cli.mts --branch weekly-update
 *
 *   Prints nothing when there is nothing to close, which is the steady state.
 */

import process from 'node:process'

import { supersededPrNumbers } from './superseded.mts'

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
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

// gh's shape to ours. An unrecognized payload yields an empty list, so a gh
// change can only ever close FEWER PRs, never more.
function parsePrs(text: string): Array<{
  number: number
  headRefName: string
  labels: string[]
  authorIsBot: boolean
}> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) {
    return []
  }
  const out = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const pr = item as Record<string, unknown>
    const author = pr['author'] as Record<string, unknown> | undefined
    out.push({
      number: Number(pr['number']),
      headRefName: String(pr['headRefName'] ?? ''),
      labels: Array.isArray(pr['labels'])
        ? (pr['labels'] as Array<Record<string, unknown>>).map(l =>
            String(l['name'] ?? ''),
          )
        : [],
      authorIsBot:
        author?.['is_bot'] === true ||
        author?.['isBot'] === true ||
        String(author?.['login'] ?? '').endsWith('[bot]') ||
        String(author?.['__typename'] ?? '') === 'Bot',
    })
  }
  return out
}

async function main(): Promise<void> {
  const branch = flag(process.argv.slice(2), '--branch') ?? 'weekly-update'
  const numbers = supersededPrNumbers(parsePrs(await readStdin()), branch)
  if (numbers.length) {
    process.stdout.write(`${numbers.join('\n')}\n`)
  }
}

void main()
