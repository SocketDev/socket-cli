#!/usr/bin/env node
/*
 * @file The deterministic executor `bot-comment-collapse-guard` points at —
 *   the full visual collapse of a PR's bot review noise in ONE command:
 *   resolve the review threads a bot started, then minimize its top-level
 *   review/comment bodies as RESOLVED. The guard only detects and prints a
 *   plan; this script is the thing that runs it.
 *
 *   The FORBIDDEN fallback lives here, not in prose: `minimizeComment` gets
 *   FORBIDDEN for every local credential on a repo we don't have write on
 *   (an external PR, a fork), while the review bot itself always has
 *   permission to act on its OWN comments and threads. On the first
 *   FORBIDDEN, this script stops trying mutations and instead posts the
 *   bot's own verified directive command (`bot-directives.mts`) so the bot
 *   does the collapsing. A bot with no verified directive is reported as
 *   needing the PR UI — never an invented command.
 *
 *   Usage: node scripts/fleet/collapse-bot-comments.mts <owner>/<repo> <pr> [--dry-run]
 */

import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'

import { directiveFor } from './_shared/bot-directives.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

// A caught mutation error whose message matches this is the no-write-access
// signal `bot-directives.mts` was built around, not an unrelated failure
// (a typo'd id, a network blip) — those are re-thrown, not swallowed.
const FORBIDDEN_RE = /permission|forbidden/i

export type SurfaceKind = 'comment' | 'review'

export interface BotSurfaceNode {
  readonly __typename?: string | undefined
  readonly author?:
    | {
        readonly __typename?: string | null | undefined
        readonly login?: string | null | undefined
      }
    | null
    | undefined
  readonly id: string
  readonly isMinimized?: boolean | undefined
}

export interface PartitionedSurfaces {
  readonly bot: BotSurfaceNode[]
  readonly human: BotSurfaceNode[]
}

export type FallbackAction =
  | { readonly command: string; readonly kind: 'post'; readonly login: string }
  | { readonly kind: 'needs-ui'; readonly login: string }

export type SurfaceStatus =
  | 'fallback-directive-posted'
  | 'minimized'
  | 'needs-ui'

export interface SurfaceResult {
  readonly id: string
  readonly kind: SurfaceKind
  readonly login: string
  readonly status: SurfaceStatus
}

/**
 * True for a bot author. GraphQL `author.login` carries NO `[bot]` suffix —
 * that spelling is REST-only — so the reliable GraphQL signal is the author's
 * own `__typename` of `Bot`. The suffix check remains for REST-shaped input.
 * Case-insensitive: the canonical login case is not guaranteed lowercase.
 */
export function isBotAuthor(
  login: string,
  authorTypename?: string | undefined,
): boolean {
  return authorTypename === 'Bot' || login.toLowerCase().endsWith('[bot]')
}

/**
 * Split `nodes` into bot-authored vs human-authored, dropping anything
 * already minimized — there is nothing left to collapse — or with no
 * resolvable author. Pure — the classification `main()` runs the fetched
 * review/comment/thread nodes through before deciding what to mutate.
 */
export function partitionBotSurfaces(
  nodes: readonly BotSurfaceNode[],
): PartitionedSurfaces {
  const bot: BotSurfaceNode[] = []
  const human: BotSurfaceNode[] = []
  for (const node of nodes) {
    if (node.isMinimized === true) {
      continue
    }
    const login = node.author?.login
    if (!login) {
      continue
    }
    if (isBotAuthor(login, node.author?.__typename ?? undefined)) {
      bot.push(node)
    } else {
      human.push(node)
    }
  }
  return { bot, human }
}

/**
 * The fallback plan for a set of bot logins whose `minimizeComment` calls hit
 * FORBIDDEN: one `post` action per distinct bot with a verified
 * `resolve-own-comments` directive (`bot-directives.mts`), one `needs-ui`
 * action per distinct bot without one. Dedupes by normalized login, so two
 * surfaces from the same bot collapse to a single post — the guard's whole
 * point is one comment per bot, not one per surface. Pure — `main()` posts
 * the resulting `post` actions, and reports `needs-ui` ones instead of
 * guessing a command.
 */
export function fallbackPlan(logins: readonly string[]): FallbackAction[] {
  const seen = new Set<string>()
  const actions: FallbackAction[] = []
  for (const login of logins) {
    const normalized = login.toLowerCase().replace(/\[bot\]$/, '')
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    const directive = directiveFor(login, 'resolve-own-comments')
    actions.push(
      directive
        ? { command: directive.command, kind: 'post', login: normalized }
        : { kind: 'needs-ui', login: normalized },
    )
  }
  return actions
}

/**
 * The process exit code for a completed run: 0 when every surface ended
 * `minimized` or `fallback-directive-posted`, 1 when any ended `needs-ui`.
 * Pure — `main()` reports the per-surface breakdown, then returns this.
 */
export function verdictFor(results: readonly SurfaceResult[]): number {
  return results.some(r => r.status === 'needs-ui') ? 1 : 0
}

/**
 * Run `gh` and return trimmed stdout. On failure, prefer the captured stderr
 * over the wrapper's own "Command failed" message — stderr is where a
 * GraphQL FORBIDDEN error actually shows up, and `FORBIDDEN_RE` needs to see
 * it.
 */
async function gh(args: readonly string[]): Promise<string> {
  try {
    const result = await spawn('gh', args as string[], { shell: WIN32 })
    return String(result.stdout)
  } catch (e) {
    const stderr = isSpawnError(e) ? String(e.stderr ?? '') : ''
    throw new Error(`gh ${args.join(' ')} failed: ${stderr || errorMessage(e)}`)
  }
}

interface RawSurfaceNode {
  readonly __typename: string
  readonly author: { readonly login: string | null } | null
  readonly id: string
  readonly isMinimized: boolean
}

interface RawThreadNode {
  readonly comments: {
    readonly nodes: ReadonlyArray<{
      readonly author: { readonly login: string | null } | null
    }>
  }
  readonly id: string
  readonly isResolved: boolean
}

interface PrSurfacesData {
  readonly comments: { readonly nodes: readonly RawSurfaceNode[] }
  readonly reviewThreads: { readonly nodes: readonly RawThreadNode[] }
  readonly reviews: { readonly nodes: readonly RawSurfaceNode[] }
}

const PR_SURFACES_QUERY = `
  query CollapseBotComments($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviews(first: 50) {
          nodes { id isMinimized __typename author { __typename login } }
        }
        comments(first: 100) {
          nodes { id isMinimized __typename author { __typename login } }
        }
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 1) { nodes { author { login } } }
          }
        }
      }
    }
  }`

async function fetchPrSurfaces(
  owner: string,
  repo: string,
  pr: number,
): Promise<PrSurfacesData> {
  const out = await gh([
    'api',
    'graphql',
    '-f',
    `query=${PR_SURFACES_QUERY}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `repo=${repo}`,
    '-F',
    `pr=${pr}`,
  ])
  const parsed = JSON.parse(out) as {
    data?:
      | {
          repository?:
            | { pullRequest?: PrSurfacesData | null | undefined }
            | null
            | undefined
        }
      | undefined
  }
  const prData = parsed.data?.repository?.pullRequest
  if (!prData) {
    throw new Error(
      `cannot load PR surfaces for ${owner}/${repo}#${pr}\n` +
        '  What: the GraphQL query returned no pullRequest node.\n' +
        `  Where: fetchPrSurfaces(${owner}/${repo}, ${pr}).\n` +
        '  Saw vs. wanted: empty repository.pullRequest; wanted reviews/comments/reviewThreads.\n' +
        '  Fix: confirm the owner/repo and PR number, and that gh is authenticated with read access.',
    )
  }
  return prData
}

async function resolveThread(threadId: string): Promise<void> {
  await gh([
    'api',
    'graphql',
    '-f',
    `query=mutation { resolveReviewThread(input: {threadId: "${threadId}"}) { thread { isResolved } } }`,
  ])
}

async function minimizeComment(subjectId: string): Promise<void> {
  await gh([
    'api',
    'graphql',
    '-f',
    `query=mutation { minimizeComment(input: {subjectId: "${subjectId}", classifier: RESOLVED}) { minimizedComment { isMinimized } } }`,
  ])
}

async function postFallbackComment(
  ownerRepo: string,
  pr: number,
  body: string,
): Promise<void> {
  await gh(['pr', 'comment', String(pr), '--repo', ownerRepo, '--body', body])
}

function kindFor(typename: string | undefined): SurfaceKind {
  return typename === 'PullRequestReview' ? 'review' : 'comment'
}

interface SurfaceEntry {
  readonly kind: SurfaceKind
  readonly login: string
  readonly node: RawSurfaceNode
}

function surfaceEntries(nodes: readonly RawSurfaceNode[]): SurfaceEntry[] {
  const { bot } = partitionBotSurfaces(nodes)
  const entries: SurfaceEntry[] = []
  for (const node of bot) {
    const login = node.author?.login
    if (login) {
      entries.push({
        kind: kindFor(node.__typename),
        login,
        node: node as RawSurfaceNode,
      })
    }
  }
  return entries
}

function needsUiMessage(
  ownerRepo: string,
  pr: number,
  entry: SurfaceEntry,
): string {
  return (
    `${entry.login} ${entry.kind} ${entry.node.id} needs the PR UI\n` +
    `  What: minimizeComment returned FORBIDDEN and ${entry.login} has no verified resolve-own-comments directive.\n` +
    `  Where: ${ownerRepo}#${pr}, ${entry.kind} ${entry.node.id}.\n` +
    `  Saw vs. wanted: no entry for ${entry.login} in BOT_DIRECTIVES; wanted a verified fallback command.\n` +
    `  Fix: minimize ${entry.node.id} manually via the PR web UI.`
  )
}

interface ThreadEntry {
  readonly id: string
  readonly login: string
}

function threadEntries(nodes: readonly RawThreadNode[]): ThreadEntry[] {
  const threadNodes: BotSurfaceNode[] = nodes.map(t => ({
    author: t.comments.nodes[0]?.author,
    id: t.id,
    isMinimized: t.isResolved,
  }))
  const entries: ThreadEntry[] = []
  for (const node of partitionBotSurfaces(threadNodes).bot) {
    const login = node.author?.login
    if (login) {
      entries.push({ id: node.id, login })
    }
  }
  return entries
}

export async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean' },
    },
    strict: false,
  })
  const ownerRepo = positionals[0]
  const prArg = positionals[1]
  const dryRun = !!values['dry-run']

  if (
    !ownerRepo ||
    !ownerRepo.includes('/') ||
    !prArg ||
    !/^\d+$/.test(prArg)
  ) {
    logger.fail(
      'usage: node scripts/fleet/collapse-bot-comments.mts <owner>/<repo> <pr-number> [--dry-run]\n' +
        '  What: missing or malformed positional arguments.\n' +
        `  Where: argv ${JSON.stringify(process.argv.slice(2))}.\n` +
        `  Saw vs. wanted: owner/repo=${JSON.stringify(ownerRepo)}, pr=${JSON.stringify(prArg)}; wanted "<owner>/<repo>" and a numeric PR.\n` +
        '  Fix: pass both positionals, e.g. PerryTS/perry 7317.',
    )
    return 1
  }
  const pr = Number(prArg)
  const [owner, repo] = ownerRepo.split('/')
  if (!owner || !repo) {
    logger.fail(`malformed owner/repo: ${ownerRepo}`)
    return 1
  }

  const prData = await fetchPrSurfaces(owner, repo, pr)
  const threads = threadEntries(prData.reviewThreads.nodes)
  const surfaces = surfaceEntries([
    ...prData.reviews.nodes,
    ...prData.comments.nodes,
  ])

  if (dryRun) {
    logger.log(`[collapse-bot-comments] plan for ${ownerRepo}#${pr}:`)
    logger.log(
      `  ${threads.length} bot-started review thread(s) would be resolved:`,
    )
    for (const t of threads) {
      logger.substep(`resolveReviewThread(${t.id}) — ${t.login}`)
    }
    logger.log(
      `  ${surfaces.length} unminimized bot surface(s) would be minimized:`,
    )
    for (const entry of surfaces) {
      logger.substep(
        `minimizeComment(${entry.node.id}) — ${entry.login} ${entry.kind}`,
      )
    }
    logger.log(
      '  if any minimizeComment returns FORBIDDEN, the fallback would be:',
    )
    for (const action of fallbackPlan(surfaces.map(e => e.login))) {
      logger.substep(
        action.kind === 'post'
          ? `post "${action.command}" on the PR — ${action.login}`
          : `needs-ui — ${action.login} has no verified directive`,
      )
    }
    return 0
  }

  for (const t of threads) {
    try {
      await resolveThread(t.id)
      logger.substep(`resolved review thread ${t.id} (${t.login})`)
    } catch (e) {
      logger.warn(
        `[collapse-bot-comments] resolveReviewThread(${t.id}) failed: ${errorMessage(e)}`,
      )
    }
  }

  const results: SurfaceResult[] = []
  const remaining: SurfaceEntry[] = []
  let forbidden = false
  for (const entry of surfaces) {
    if (forbidden) {
      remaining.push(entry)
      continue
    }
    try {
      await minimizeComment(entry.node.id)
      results.push({
        id: entry.node.id,
        kind: entry.kind,
        login: entry.login,
        status: 'minimized',
      })
    } catch (e) {
      const message = errorMessage(e)
      if (FORBIDDEN_RE.test(message)) {
        forbidden = true
        remaining.push(entry)
      } else {
        throw new Error(
          `minimizeComment(${entry.node.id}) failed with an unexpected error\n` +
            '  What: the mutation failed, but not with a permission/FORBIDDEN error.\n' +
            `  Where: ${ownerRepo}#${pr}, ${entry.kind} ${entry.node.id}.\n` +
            `  Saw vs. wanted: ${message}; wanted success or a FORBIDDEN we can fall back from.\n` +
            '  Fix: inspect the error — this is not the no-write-access case the fallback covers.',
        )
      }
    }
  }

  if (remaining.length > 0) {
    const plan = fallbackPlan(remaining.map(e => e.login))
    const planByLogin = new Map(plan.map(action => [action.login, action]))
    for (const action of plan) {
      if (action.kind === 'post') {
        await postFallbackComment(ownerRepo, pr, action.command)
        logger.substep(`posted "${action.command}" on ${ownerRepo}#${pr}`)
      }
    }
    for (let i = 0, { length } = remaining; i < length; i += 1) {
      const entry = remaining[i]!
      const normalized = entry.login.toLowerCase().replace(/\[bot\]$/, '')
      const action = planByLogin.get(normalized)
      if (action?.kind === 'post') {
        results.push({
          id: entry.node.id,
          kind: entry.kind,
          login: entry.login,
          status: 'fallback-directive-posted',
        })
      } else {
        results.push({
          id: entry.node.id,
          kind: entry.kind,
          login: entry.login,
          status: 'needs-ui',
        })
        logger.fail(
          `[collapse-bot-comments] ${needsUiMessage(ownerRepo, pr, entry)}`,
        )
      }
    }
  }

  logger.log(`[collapse-bot-comments] ${ownerRepo}#${pr} report:`)
  for (let i = 0, { length } = results; i < length; i += 1) {
    const r = results[i]!
    logger.substep(`${r.kind} ${r.id} (${r.login}): ${r.status}`)
  }

  const verdict = verdictFor(results)
  if (verdict === 0) {
    logger.success(
      `[collapse-bot-comments] ${ownerRepo}#${pr}: every bot surface is minimized or has a directive posted.`,
    )
  }
  return verdict
}

const SCRIPT_META: ScriptMeta = {
  describe:
    "collapses a PR's bot review noise — resolves bot threads and minimizes bot comments as resolved",
  help: `Usage: node scripts/fleet/collapse-bot-comments.mts <owner>/<repo> <pr-number> [flags]

  --dry-run  print the collapse plan without mutating anything`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
