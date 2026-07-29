import { Type } from '@sinclair/typebox'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { fetchSocketThreatFeed } from './lib/socket-api.mts'
import {
  readToolBoolean,
  readToolNumber,
  readToolString,
} from './tool-args.mts'
import {
  authRequiredToolResult,
  errorToolResult,
  resolveScopedToolAuthToken,
  textToolResult,
} from './tool-auth.mts'
import { describeToolArgument, isSocketOrgSlug } from './tool-input.mts'

import type { ToolSpec } from './tool-types.mts'

export const THREAT_FEED_TOOL_NAME = 'threat_feed'

export const THREAT_FEED_TOOL_DESCRIPTION =
  "Look up items in the Socket organization threat feed with the `threat_feed` tool. Requires `org_slug` — call the `organizations` tool first if you don't have it. Returns recently flagged packages (malware, typosquats, obfuscated code, etc.) along with a `nextPageCursor` for pagination. Use `filter` to narrow the threat category (default `mal` for malware), `ecosystem` to scope to a registry, or `name`/`version` to look up a specific package. Pass the previous response's cursor as `cursor` to fetch the next page."

export const ThreatFeedInputSchema = Type.Object({
  created_after: Type.Optional(
    Type.String({
      description: 'ISO timestamp; only return items created after this',
    }),
  ),
  cursor: Type.Optional(
    Type.String({
      description:
        'Pagination cursor — the `nextPageCursor` from a previous response',
    }),
  ),
  direction: Type.Optional(
    Type.Union([Type.Literal('asc'), Type.Literal('desc')], {
      description: 'Sort direction (default `desc`)',
    }),
  ),
  ecosystem: Type.Optional(
    Type.String({
      description:
        'Ecosystem filter, e.g. npm, pypi, gem, maven, golang, nuget, cargo, chrome, openvsx, vscode, huggingface',
    }),
  ),
  filter: Type.Optional(
    Type.String({
      description:
        'Threat category filter (default `mal`). Common values: `mal` (malware), `vuln`, `typ` (typosquat), `obf` (obfuscated), `mjo`, `kes`, `spy`, `ano`, `ucf`, `ptp`, `ual`',
    }),
  ),
  is_human_reviewed: Type.Optional(
    Type.Boolean({
      description: 'Only return human-reviewed items (default false)',
    }),
  ),
  name: Type.Optional(Type.String({ description: 'Filter by package name' })),
  org_slug: Type.String({
    description:
      'Organization slug, e.g. "my-org" (use the `organizations` tool to discover this)',
  }),
  per_page: Type.Optional(
    Type.Integer({
      description: 'Results per page (default 30, max 100)',
      maximum: 100,
      minimum: 1,
    }),
  ),
  sort: Type.Optional(
    Type.Union(
      [
        Type.Literal('id'),
        Type.Literal('created_at'),
        Type.Literal('updated_at'),
      ],
      { description: 'Sort field (default `updated_at`)' },
    ),
  ),
  updated_after: Type.Optional(
    Type.String({
      description: 'ISO timestamp; only return items updated after this',
    }),
  ),
  version: Type.Optional(
    Type.String({ description: 'Filter by package version' }),
  ),
})

/**
 * Map the tool's snake_case arguments onto the threat-feed endpoint's query
 * parameters. Only fields the caller set are forwarded, so the API's own
 * defaults apply to the rest.
 */
export function buildThreatFeedQueryParams(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  const stringFields = [
    ['created_after', 'created_after'],
    ['cursor', 'page_cursor'],
    ['direction', 'direction'],
    ['ecosystem', 'ecosystem'],
    ['filter', 'filter'],
    ['name', 'name'],
    ['sort', 'sort'],
    ['updated_after', 'updated_after'],
    ['version', 'version'],
  ] as const
  for (const [argKey, paramKey] of stringFields) {
    const value = readToolString(args, argKey)
    if (value !== undefined) {
      params[paramKey] = value
    }
  }
  const isHumanReviewed = readToolBoolean(args, 'is_human_reviewed')
  if (isHumanReviewed !== undefined) {
    params['is_human_reviewed'] = isHumanReviewed
  }
  const perPage = readToolNumber(args, 'per_page')
  if (perPage !== undefined) {
    params['per_page'] = perPage
  }
  return params
}

export function defineThreatFeedTool(): ToolSpec {
  return {
    annotations: { readOnlyHint: true },
    description: THREAT_FEED_TOOL_DESCRIPTION,
    handler: async (args, extra, context) => {
      const orgSlug = readToolString(args, 'org_slug')
      if (!orgSlug || !isSocketOrgSlug(orgSlug)) {
        return errorToolResult(
          `Reading the Socket threat feed failed. Where: the \`org_slug\` argument. Saw: ${describeToolArgument(orgSlug)}, wanted an organization slug of letters, digits, dots, hyphens, or underscores. Fix: call the \`organizations\` tool and pass one of the slugs it lists.`,
        )
      }
      const apiToken = resolveScopedToolAuthToken(
        extra.authInfo?.token,
        context,
      )
      if (!apiToken) {
        return authRequiredToolResult()
      }
      try {
        const data = await fetchSocketThreatFeed(
          apiToken,
          orgSlug,
          buildThreatFeedQueryParams(args),
        )
        return textToolResult(JSON.stringify(data, undefined, 2))
      } catch (e) {
        return errorToolResult(errorMessage(e))
      }
    },
    inputSchema: ThreatFeedInputSchema,
    name: THREAT_FEED_TOOL_NAME,
    title: 'Threat Feed Tool',
  }
}
