#!/usr/bin/env node
/**
 * @file Generate the root `llms.txt` — the publish-safe discovery index of
 *   every subpath a package exports, grouped by namespace. Each entry links the
 *   shipped `.d.mts` declaration rather than `src/`, because a published
 *   tarball has no `src/` and the declaration is where an agent finds the
 *   signature. The human-facing twin, which links `src/`, is
 *   `scripts/fleet/make-api-md.mts`; one generator owns each path.
 *   Opt-in: writes only when the member sets `docs.llmsTxt` in
 *   `.config/repo/socket-wheelhouse.json`. A member with no export surface is a
 *   named skip, never an empty file.
 *   Usage: node scripts/fleet/make-llms-txt.mts [--check] [--quiet]
 *   --check  Compare the committed file against a fresh render; exit 1 when
 *   it is stale or missing. Writes nothing.
 *   --quiet  Suppress the skip / success line; failures still print.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import { runDocsArtifact } from './lib/api-docs/docs-artifact.mts'
import { sortApiGroupKeys } from './lib/api-docs/export-rows.mts'

import type {
  DocsArtifactSpec,
  DocsRenderContext,
} from './lib/api-docs/docs-artifact.mts'

const logger = getDefaultLogger()

/**
 * The command every skip and staleness message names.
 */
export const MAKE_LLMS_TXT_COMMAND = 'node scripts/fleet/make-llms-txt.mts'

/**
 * The blockquote lead: the package description, then the export count that
 * tells a reader how large the surface is.
 */
export function renderLlmsTxtLead(context: DocsRenderContext): string {
  const described = context.packageDescription
    ? `${context.packageDescription.replace(/\.$/, '')}. `
    : ''
  return `> ${described}${context.rows.length} subpath exports, grouped by namespace.`
}

/**
 * Render the full root `llms.txt` document.
 */
export function renderLlmsTxtIndex(context: DocsRenderContext): string {
  const keys = sortApiGroupKeys(context.groups)
  const exampleSubpath = context.rows[0]?.subpath ?? ''
  const lines: string[] = [
    `# ${context.packageName}`,
    '',
    renderLlmsTxtLead(context),
    '',
    `Import any namespace by its subpath, e.g. \`import '${context.packageName}/${exampleSubpath}'\`. Each link below points at the TypeScript declarations shipped in the package, where the full signature for that subpath lives.`,
    '',
  ]

  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    lines.push(`## ${key}`, '')
    for (const row of context.groups.get(key) ?? []) {
      const described = row.summary ? `: ${row.summary}` : ''
      lines.push(
        `- [${context.packageName}/${row.subpath}](${row.typesPath})${described}`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * The artifact identity `runDocsArtifact` drives.
 */
export const LLMS_TXT_SPEC: DocsArtifactSpec = {
  command: MAKE_LLMS_TXT_COMMAND,
  key: 'llmsTxt',
  relPath: 'llms.txt',
  render: renderLlmsTxtIndex,
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const quiet = argv.includes('--quiet')
  const outcome = await runDocsArtifact(LLMS_TXT_SPEC, {
    checkOnly: argv.includes('--check'),
  })
  if (outcome.kind === 'stale') {
    logger.error(outcome.message)
    return 1
  }
  if (!quiet) {
    logger.info(outcome.message)
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  runMain(main)
}
