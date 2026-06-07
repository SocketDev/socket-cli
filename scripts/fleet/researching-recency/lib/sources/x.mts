/**
 * @file X (Twitter) source adapter (opt-in). Uses the xAI Responses API
 *   (`api.x.ai/v1/responses`) with the native `x_search` tool — Grok searches X
 *   over the date window and returns structured posts. This is the keychain-
 *   friendly path: a single bearer token (`XAI_API_KEY`), no browser-cookie
 *   scraping. When the key is absent the adapter reports `skipped` with a
 *   reason, so the keyless sources still carry the run.
 *
 *   Auth: the key lives in `XAI_API_KEY` (process env), populated from the OS
 *   keychain at session start — never read from the keychain on the hot path
 *   (that triggers a per-call UI prompt; see no-blind-keychain-read-guard). See
 *   the skill reference for the keychain how-to.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { httpJson } from '@socketsecurity/lib-stable/http-request'

import type {
  FetchContext,
  SourceAdapter,
  SourceItem,
  SourceResult,
} from '../types.mts'

const RESPONSES_URL = 'https://api.x.ai/v1/responses'

// The Grok model with X search. Tracks the model the xAI X-search docs use; the
// account's entitlement governs which models actually resolve. Override with
// XAI_MODEL.
const DEFAULT_MODEL = 'grok-4.3'

// The xAI x_search tool caps each handle list at 20.
const MAX_HANDLES = 20

// Handle allow/deny for the x_search tool. allowed = only these accounts;
// excluded = every account but these. The two are mutually exclusive at the API
// (allow wins here when both are set). Handles are bare (no leading @).
export interface XSearchOptions {
  allowedHandles?: readonly string[] | undefined
  excludedHandles?: readonly string[] | undefined
}

// Strip a leading @, drop blanks, de-dupe, and cap at the API's 20-handle limit.
export function normalizeHandles(handles: readonly string[]): string[] {
  const seen = new Set<string>()
  for (let i = 0, { length } = handles; i < length; i += 1) {
    const handle = handles[i]!.trim().replace(/^@/, '')
    if (handle) {
      seen.add(handle)
    }
  }
  return [...seen].slice(0, MAX_HANDLES)
}

// One post as Grok is asked to return it inside the JSON envelope. url is
// required (it's the citation); the rest is best-effort.
export interface XPost {
  url?: string | undefined
  text?: string | undefined
  author?: string | undefined
  createdAt?: string | undefined
  likes?: number | undefined
  reposts?: number | undefined
  replies?: number | undefined
  views?: number | undefined
}

// Read the xAI key from the environment. Returns undefined when unset (the
// adapter then skips). Never reads the keychain directly — the key is loaded
// into env at session start.
export function resolveKey(): string | undefined {
  return process.env['XAI_API_KEY'] || undefined
}

// Build the Responses-API payload: the x_search tool with the date window
// (plus optional handle allow/deny), and a prompt asking Grok for a JSON
// envelope of the top posts. allowed_x_handles and excluded_x_handles are
// mutually exclusive at the API, so the allowlist wins when both are supplied.
export function buildPayload(
  searchQuery: string,
  fromDate: string,
  toDate: string,
  perStream: number,
  options: XSearchOptions = {},
): Record<string, unknown> {
  const xSearch: Record<string, unknown> = {
    type: 'x_search',
    from_date: fromDate,
    to_date: toDate,
  }
  const allowed = options.allowedHandles
    ? normalizeHandles(options.allowedHandles)
    : []
  const excluded = options.excludedHandles
    ? normalizeHandles(options.excludedHandles)
    : []
  if (allowed.length > 0) {
    xSearch['allowed_x_handles'] = allowed
  } else if (excluded.length > 0) {
    xSearch['excluded_x_handles'] = excluded
  }
  const scope =
    allowed.length > 0
      ? ` from these accounts only: ${allowed.map(h => `@${h}`).join(', ')}`
      : ''
  return {
    model: process.env['XAI_MODEL'] || DEFAULT_MODEL,
    tools: [xSearch],
    input: [
      {
        role: 'user',
        content: `Search X for the ${perStream} most relevant posts about "${searchQuery}" between ${fromDate} and ${toDate}${scope}. Return ONLY a JSON object of the form {"items":[{"url","text","author","createdAt","likes","reposts","replies","views"}]} — no prose, no markdown fence.`,
      },
    ],
  }
}

// Pull the model's output text out of the Responses-API envelope (handles the
// `output: [{type:'message', content:[{type:'output_text', text}]}]` shape and
// the older `choices[].message.content` shape).
export function extractOutputText(response: unknown): string {
  if (typeof response !== 'object' || response === null) {
    return ''
  }
  const record = response as Record<string, unknown>
  const output = record['output']
  if (typeof output === 'string') {
    return output
  }
  if (Array.isArray(output)) {
    for (let i = 0, { length } = output; i < length; i += 1) {
      const entry = output[i]
      if (typeof entry !== 'object' || entry === null) {
        continue
      }
      const content = (entry as Record<string, unknown>)['content']
      if (Array.isArray(content)) {
        for (let j = 0, { length: count } = content; j < count; j += 1) {
          const part = content[j]
          if (
            typeof part === 'object' &&
            part !== null &&
            (part as Record<string, unknown>)['type'] === 'output_text'
          ) {
            const text = (part as Record<string, unknown>)['text']
            if (typeof text === 'string') {
              return text
            }
          }
        }
      }
    }
  }
  const choices = record['choices']
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown>)['message']
    if (typeof message === 'object' && message !== null) {
      const content = (message as Record<string, unknown>)['content']
      if (typeof content === 'string') {
        return content
      }
    }
  }
  return ''
}

function isXPost(value: unknown): value is XPost {
  return typeof value === 'object' && value !== null
}

export function toSourceItem(post: XPost): SourceItem {
  const text = post.text ?? ''
  return {
    itemId: post.url ?? '',
    source: 'x',
    title: text.slice(0, 120),
    body: text,
    url: post.url ?? '',
    author: post.author || undefined,
    container: 'X',
    publishedAt: post.createdAt || undefined,
    engagement: {
      likes: post.likes ?? 0,
      reposts: post.reposts ?? 0,
      replies: post.replies ?? 0,
      views: post.views ?? 0,
    },
    snippet: text,
    metadata: {},
  }
}

// Parse the model's output text into SourceItems: find the JSON envelope, read
// its `items`, drop url-less entries. Returns [] on any parse failure (the
// adapter never throws past its boundary).
export function parseResponse(outputText: string): SourceItem[] {
  const match = outputText.match(/\{[\s\S]*"items"[\s\S]*\}/)
  if (!match) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return []
  }
  const items =
    isXPost(parsed) &&
    Array.isArray((parsed as { items?: unknown[] | undefined }).items)
      ? (parsed as { items: unknown[] }).items
      : []
  const out: SourceItem[] = []
  for (let i = 0, { length } = items; i < length; i += 1) {
    const post = items[i]
    if (isXPost(post) && post.url) {
      out.push(toSourceItem(post))
    }
  }
  return out
}

export const xAdapter: SourceAdapter = {
  async fetch(
    searchQuery: string,
    context: FetchContext,
  ): Promise<SourceResult> {
    const key = resolveKey()
    if (!key) {
      return {
        source: 'x',
        status: 'skipped',
        items: [],
        note: 'set XAI_API_KEY (xAI bearer token) to enable X search',
      }
    }
    try {
      const toDate = new Date(context.now).toISOString().slice(0, 10)
      const fromDate = new Date(context.now - context.days * 86_400_000)
        .toISOString()
        .slice(0, 10)
      const response = await httpJson<unknown>(RESPONSES_URL, {
        method: 'POST',
        body: JSON.stringify(
          buildPayload(searchQuery, fromDate, toDate, context.perStream, {
            allowedHandles: context.xHandles?.allowed,
            excludedHandles: context.xHandles?.excluded,
          }),
        ),
        headers: { Authorization: `Bearer ${key}` },
        // Grok live-search is slow; give it room.
        timeout: 120_000,
      })
      return {
        source: 'x',
        status: 'ok',
        items: parseResponse(extractOutputText(response)),
      }
    } catch (error) {
      return {
        source: 'x',
        status: 'error',
        items: [],
        note: errorMessage(error),
      }
    }
  },
  isAvailable: () => resolveKey() !== undefined,
  source: 'x',
}
