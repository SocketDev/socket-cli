/**
 * @file Bluesky source adapter (opt-in). Uses the AT Protocol public search
 *   endpoint (`searchPosts`), authenticating with a free app password from
 *   `BSKY_HANDLE` + `BSKY_APP_PASSWORD`. When those env vars are absent the
 *   adapter reports `skipped` with a reason rather than failing — the keyless
 *   sources still carry the run.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpJson } from '@socketsecurity/lib-stable/http-request'

import type {
  FetchContext,
  SourceAdapter,
  SourceItem,
  SourceResult,
} from '../types.mts'

const PDS = 'https://bsky.social'
const SEARCH_HOST = 'https://public.api.bsky.app'

// An AT Protocol post view from app.bsky.feed.searchPosts. Subset of fields.
export interface BlueskyPost {
  uri?: string | undefined
  cid?: string | undefined
  author?:
    | { handle?: string | undefined; displayName?: string | undefined }
    | undefined
  record?:
    | { text?: string | undefined; createdAt?: string | undefined }
    | undefined
  likeCount?: number | undefined
  repostCount?: number | undefined
  replyCount?: number | undefined
  quoteCount?: number | undefined
}

interface SearchPostsResponse {
  posts?: BlueskyPost[] | undefined
}

function isSearchResponse(value: unknown): value is SearchPostsResponse {
  return typeof value === 'object' && value !== null
}

// Turn an at:// post URI into a bsky.app web link the reader can open.
export function postWebUrl(post: BlueskyPost): string {
  const uri = post.uri ?? ''
  // Matches an AT Protocol post URI: anchor ^ / $; group 1 `(did:[^/]+)` captures the
  // DID authority (e.g. did:plc:xyz) up to the first `/`; literal path segment
  // `app\.bsky\.feed\.post`; group 2 `(.+)` captures the record key (rkey).
  const match = uri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/(.+)$/)
  if (!match) {
    return ''
  }
  const handle = post.author?.handle ?? match[1]!
  return `https://bsky.app/profile/${handle}/post/${match[2]}`
}

export function toSourceItem(post: BlueskyPost): SourceItem {
  const text = post.record?.text ?? ''
  return {
    itemId: post.uri ?? post.cid ?? '',
    source: 'bluesky',
    title: text.slice(0, 120),
    body: text,
    url: postWebUrl(post),
    author: post.author?.handle || undefined,
    container: 'Bluesky',
    publishedAt: post.record?.createdAt || undefined,
    engagement: {
      likes: post.likeCount ?? 0,
      reposts: post.repostCount ?? 0,
      replies: post.replyCount ?? 0,
      quotes: post.quoteCount ?? 0,
    },
    snippet: text,
    metadata: {},
  }
}

export function searchUrl(searchQuery: string, perStream: number): string {
  const params = new URLSearchParams({
    q: searchQuery,
    sort: 'top',
    limit: String(perStream),
  })
  return `${SEARCH_HOST}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`
}

// Exchange the app password for a session access token.
async function createSession(
  handle: string,
  appPassword: string,
): Promise<string> {
  const session = await httpJson<{ accessJwt?: string | undefined }>(
    `${PDS}/xrpc/com.atproto.server.createSession`,
    {
      method: 'POST',
      body: JSON.stringify({ identifier: handle, password: appPassword }),
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
    },
  )
  return session.accessJwt ?? ''
}

function credentials(): { handle: string; appPassword: string } | undefined {
  const handle = process.env['BSKY_HANDLE']
  const appPassword = process.env['BSKY_APP_PASSWORD']
  return handle && appPassword ? { handle, appPassword } : undefined
}

export const blueskyAdapter: SourceAdapter = {
  async fetch(
    searchQuery: string,
    context: FetchContext,
  ): Promise<SourceResult> {
    const creds = credentials()
    if (!creds) {
      return {
        source: 'bluesky',
        status: 'skipped',
        items: [],
        note: 'set BSKY_HANDLE + BSKY_APP_PASSWORD to enable Bluesky',
      }
    }
    try {
      const token = await createSession(creds.handle, creds.appPassword)
      const response = await httpJson<unknown>(
        searchUrl(searchQuery, context.perStream),
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30_000,
        },
      )
      const posts = isSearchResponse(response) ? (response.posts ?? []) : []
      return { source: 'bluesky', status: 'ok', items: posts.map(toSourceItem) }
    } catch (error) {
      return {
        source: 'bluesky',
        status: 'error',
        items: [],
        note: errorMessage(error),
      }
    }
  },
  isAvailable: () => credentials() !== undefined,
  source: 'bluesky',
}
