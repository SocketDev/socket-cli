// Tool config loaded from external-tools.json. Lives in its own file because
// installers.mts is at the 500-line soft cap — manifest-loading + the per-tool
// consts are one cohesive "what does the manifest say" domain, separate from the
// installers that act on it.
//
// The shape is checked by `checkToolsConfig`, an AHEAD-OF-TIME validator that
// scripts/fleet/gen/hook-validators.mts generates from the fleet's canonical
// `ToolsConfig` schema. A hook process is one per tool event, so compiling the
// schema here would pay the TypeBox compiler's codegen on every run and amortize
// it over this single check; the generated validator is a plain function call and
// keeps TypeBox out of the hook bundle. The `Static` types come from that same
// schema through a type-only import, which erases.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ToolsConfigType } from '../../../../../scripts/fleet/lib/external-tools-schema.mts'
import { checkToolsConfig } from '../../_shared/generated-validators.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// external-tools.json lives one level up at the hook root
// (.claude/hooks/fleet/setup-security-tools/external-tools.json) — keep it
// out of `lib/` so it's discoverable as a top-level config file rather
// than buried as an implementation detail. Fall back to a sibling path
// so an early-installed copy in lib/ still resolves during onboarding.
const configPath = (() => {
  const parentPath = path.join(__dirname, '..', 'external-tools.json')
  if (existsSync(parentPath)) {
    return parentPath
  }
  return path.join(__dirname, 'external-tools.json')
})()
const rawConfig: unknown = JSON.parse(readFileSync(configPath, 'utf8'))

if (!checkToolsConfig(rawConfig)) {
  throw new Error(
    'setup-security-tools: external-tools.json does not match the ToolsConfig schema.\n' +
      `  Where: ${configPath}\n` +
      '  Saw:   a shape the generated ToolsConfig validator rejected — a renamed field,\n' +
      '         a wrong nesting, or an unmodeled key.\n' +
      '  Fix:   run `node scripts/fleet/check/external-tools-are-valid.mts` for the\n' +
      '         path-listed violations, then fix the file (or the schema in\n' +
      '         scripts/fleet/lib/external-tools-schema.mts).',
  )
}

export const config = rawConfig as ToolsConfigType

export const ACTIONLINT = config.tools['actionlint']!
export const AGENTSHIELD = config.tools['agentshield']!
export const CDXGEN = config.tools['cdxgen']!
export const SYNP = config.tools['synp']!
export const ZIZMOR = config.tools['zizmor']!
export const SFW_FREE = config.tools['sfw-free']!
export const SFW_ENTERPRISE = config.tools['sfw-enterprise']!
export const TRUFFLEHOG = config.tools['trufflehog']!
export const TRIVY = config.tools['trivy']!
export const OPENGREP = config.tools['opengrep']!
export const UV = config.tools['uv']!
export const JANUS = config.tools['janus']!
export const SKILLSPECTOR = config.tools['skillspector']!
export const HEADROOM = config.tools['headroom']!

export type ToolEntry = (typeof config.tools)[string]
export type PlatformEntry = NonNullable<ToolEntry['platforms']>[string]
