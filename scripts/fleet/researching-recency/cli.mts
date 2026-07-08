#!/usr/bin/env node
/**
 * @file Researching-recency engine CLI. Orchestrates the pipeline the SKILL.md
 *   contract drives: resolve a query plan (model-supplied via --plan, or a
 *   default single-subquery plan for a bare topic), fan out to the programming
 *   sources, dedupe each stream, fuse via reciprocal-rank, render the compact
 *   evidence envelope + pass-through footer, and save the raw brief. The model
 *   reads the envelope and synthesizes prose; the footer it passes through
 *   verbatim. Usage: node cli.mts "<topic>" [--emit=compact] [--days=30]
 *   [--depth=quick|default|deep]
 *   [--search=github,hackernews,reddit,lobsters,devto,bluesky,web] [--plan
 *   <path|json>] [--web-file <path>] [--save-dir <dir>]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { RESEARCH_SAVE_DIR } from './paths.mts'
import { dedupeItems } from './lib/dedupe.mts'
import { fetchAll } from './lib/fetch.mts'
import { defaultPlan, validatePlan } from './lib/plan.mts'
import { weightedRrf } from './lib/rank.mts'
import { renderCompact } from './lib/render/compact.mts'
import { parseWebHits } from './lib/sources/web.mts'

import type { FetchContext, QueryPlan, SourceName } from './lib/types.mts'

const logger = getDefaultLogger()

// Per-depth limits: items pulled per stream, and the fused pool size. Quick
// trades recall for latency; deep is the thorough sweep.
const DEPTH_SETTINGS: Readonly<
  Record<string, { perStream: number; poolLimit: number }>
> = {
  deep: { perStream: 30, poolLimit: 40 },
  default: { perStream: 15, poolLimit: 24 },
  quick: { perStream: 8, poolLimit: 12 },
}

export interface CliArgs {
  topic: string
  emit: string
  days: number
  depth: string
  search: SourceName[] | undefined
  planArg: string | undefined
  webFile: string | undefined
  saveDir: string
}

// Parse a `--flag=value` or `--flag value` argv into typed CLI args. The first
// non-flag positional is the topic.
export function parseArgs(argv: readonly string[]): CliArgs {
  let topic = ''
  let emit = 'compact'
  let days = 30
  let depth = 'default'
  let search: SourceName[] | undefined
  let planArg: string | undefined
  let webFile: string | undefined
  let saveDir = RESEARCH_SAVE_DIR

  function valueOf(arg: string, index: number): string {
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      return arg.slice(eq + 1)
    }
    return argv[index + 1] ?? ''
  }

  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      if (!topic) {
        topic = arg
      }
      continue
    }
    const inline = arg.includes('=')
    if (arg.startsWith('--emit')) {
      emit = valueOf(arg, i)
    } else if (arg.startsWith('--days')) {
      days = Number(valueOf(arg, i)) || 30
    } else if (arg.startsWith('--depth')) {
      depth = valueOf(arg, i)
    } else if (arg.startsWith('--search')) {
      search = valueOf(arg, i)
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0) as SourceName[]
    } else if (arg.startsWith('--plan')) {
      planArg = valueOf(arg, i)
    } else if (arg.startsWith('--web-file')) {
      webFile = valueOf(arg, i)
    } else if (arg.startsWith('--save-dir')) {
      saveDir = valueOf(arg, i)
    }
    if (!inline) {
      i += 1
    }
  }

  return { topic, emit, days, depth, search, planArg, webFile, saveDir }
}

// Resolve the plan: from --plan (a JSON string or a path to a JSON file), else a
// default single-subquery plan over the requested (or keyless) sources.
async function resolvePlan(args: CliArgs): Promise<QueryPlan> {
  if (args.planArg) {
    const trimmed = args.planArg.trim()
    const raw = trimmed.startsWith('{')
      ? trimmed
      : await readFile(trimmed, 'utf8')
    return validatePlan(JSON.parse(raw), args.topic)
  }
  return defaultPlan(args.topic, args.search)
}

// Slugify a topic into a save-file stem.
function topicSlug(topic: string): string {
  return (
    topic
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'research'
  )
}

export async function run(argv: readonly string[]): Promise<string> {
  const args = parseArgs(argv)
  if (!args.topic) {
    throw new Error(
      'researching-recency: no topic given. Pass the research topic as the first argument, e.g. `cli.mts "rolldown" --emit=compact`.',
    )
  }
  const depth = DEPTH_SETTINGS[args.depth] ?? DEPTH_SETTINGS['default']!
  const now = Date.now()
  const plan = await resolvePlan(args)
  const context: FetchContext = {
    days: args.days,
    now,
    perStream: depth.perStream,
    xHandles: plan.xHandles,
  }

  const { results, streams } = await fetchAll(plan, context)

  // Web hits come from the model's --web-file, not a network adapter; fold them
  // into a synthetic stream so fusion ranks them alongside the fetched sources.
  if (args.webFile) {
    const webItems = parseWebHits(await readFile(args.webFile, 'utf8'))
    if (webItems.length > 0) {
      streams.set('main web', webItems)
      results.push({ source: 'web', status: 'ok', items: webItems })
    }
  }

  // Dedupe each stream before fusion so a source's own reposts don't crowd it.
  for (const [key, items] of streams) {
    streams.set(key, dedupeItems(items))
  }

  const candidates = weightedRrf(streams, plan, depth.poolLimit)

  const syncedDate = new Date(now).toISOString().slice(0, 10)
  const fromDate = new Date(now - args.days * 86_400_000)
    .toISOString()
    .slice(0, 10)
  await mkdir(args.saveDir, { recursive: true })
  const savedPath = path.join(args.saveDir, `${topicSlug(args.topic)}-raw.md`)

  const output = renderCompact({
    candidates,
    results,
    topic: args.topic,
    syncedDate,
    fromDate,
    savedPath,
  })
  await writeFile(savedPath, output, 'utf8')
  return output
}

async function main(): Promise<void> {
  try {
    const output = await run(process.argv.slice(2))
    logger.log(output)
  } catch (error) {
    logger.error(`researching-recency failed: ${errorMessage(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1]?.endsWith('cli.mts')) {
  // Async IIFE: await inside (no top-level await — CJS bundle target), promise
  // still awaited so a rejection isn't silently floated. main() sets exitCode.
  void (async () => {
    await main()
  })()
}
