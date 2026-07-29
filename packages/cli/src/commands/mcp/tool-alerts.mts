import { Type } from '@sinclair/typebox'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { fetchSocketAlerts } from './lib/socket-api.mts'
import { readToolNumber, readToolString } from './tool-args.mts'
import {
  authRequiredToolResult,
  errorToolResult,
  resolveScopedToolAuthToken,
  textToolResult,
} from './tool-auth.mts'
import { isSocketOrgSlug } from './tool-input.mts'

import type { ToolSpec } from './tool-types.mts'

export const ALERTS_TOOL_NAME = 'alerts'

export const ALERTS_TOOL_DESCRIPTION =
  "List the latest security alerts for a Socket organization. Requires `org_slug` — call the `organizations` tool first if you don't have it. Filter by severity, category, status, artifact type or name, alert type, and repo. Use this to surface supply-chain, vulnerability, quality, license, and maintenance issues across the organization's monitored packages. Results are paginated: pass the previous response's `endCursor` as `cursor` to fetch the next page."

export const AlertsInputSchema = Type.Object({
  alert_type: Type.Optional(
    Type.String({
      description:
        'Comma-separated Socket alert types (e.g. "usesEval,unmaintained")',
    }),
  ),
  artifact_name: Type.Optional(
    Type.String({ description: 'Filter to a specific package name' }),
  ),
  artifact_type: Type.Optional(
    Type.String({
      description:
        'Comma-separated ecosystems: subset of npm,pypi,gem,maven,golang,nuget,cargo,chrome,openvsx',
    }),
  ),
  category: Type.Optional(
    Type.String({
      description:
        'Comma-separated categories: subset of supplyChainRisk,maintenance,quality,license,vulnerability',
    }),
  ),
  cursor: Type.Optional(
    Type.String({
      description:
        "Pagination cursor — the `endCursor` from a previous response's metadata",
    }),
  ),
  org_slug: Type.String({
    description:
      'Organization slug, e.g. "my-org" (use the `organizations` tool to discover this)',
  }),
  per_page: Type.Optional(
    Type.Integer({
      description: 'Results per page (default 100, max 5000)',
      maximum: 5000,
      minimum: 1,
    }),
  ),
  repo_slug: Type.Optional(
    Type.String({ description: 'Comma-separated repo slugs' }),
  ),
  severity: Type.Optional(
    Type.String({
      description:
        'Comma-separated severities to include: subset of low,medium,high,critical',
    }),
  ),
  status: Type.Optional(
    Type.Union([Type.Literal('open'), Type.Literal('cleared')], {
      description: 'Filter to open or cleared alerts',
    }),
  ),
})

export function defineAlertsTool(): ToolSpec {
  return {
    annotations: { readOnlyHint: true },
    description: ALERTS_TOOL_DESCRIPTION,
    handler: async (args, extra, context) => {
      const orgSlug = readToolString(args, 'org_slug')
      if (!orgSlug || !isSocketOrgSlug(orgSlug)) {
        return errorToolResult(
          `Listing Socket alerts failed. Where: the \`org_slug\` argument. Saw: ${JSON.stringify(orgSlug ?? null)}, wanted an organization slug of letters, digits, dots, hyphens, or underscores. Fix: call the \`organizations\` tool and pass one of the slugs it lists.`,
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
        const data = await fetchSocketAlerts(apiToken, orgSlug, {
          alertType: readToolString(args, 'alert_type'),
          artifactName: readToolString(args, 'artifact_name'),
          artifactType: readToolString(args, 'artifact_type'),
          category: readToolString(args, 'category'),
          cursor: readToolString(args, 'cursor'),
          perPage: readToolNumber(args, 'per_page') ?? 100,
          repoSlug: readToolString(args, 'repo_slug'),
          severity: readToolString(args, 'severity'),
          status: readToolString(args, 'status'),
        })
        return textToolResult(JSON.stringify(data, undefined, 2))
      } catch (e) {
        return errorToolResult(errorMessage(e))
      }
    },
    inputSchema: AlertsInputSchema,
    name: ALERTS_TOOL_NAME,
    title: 'List Alerts Tool',
  }
}
