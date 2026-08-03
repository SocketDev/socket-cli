// Tool config loaded from external-tools.json (self-contained). Lives in its
// own file because installers.mts is at the 500-line soft cap — the schema +
// manifest-loading + per-tool consts are one cohesive "what does the manifest
// say" domain, separate from the installers that act on it.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Type } from '@sinclair/typebox'

import { parseSchema } from '@socketsecurity/lib-stable/schema/parse'

const platformEntrySchema = Type.Object({
  asset: Type.String(),
  integrity: Type.String(),
})

const toolSchema = Type.Object({
  description: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  versionDate: Type.Optional(Type.String()),
  purl: Type.Optional(Type.String()),
  integrity: Type.Optional(Type.String()),
  repository: Type.Optional(Type.String()),
  release: Type.Optional(Type.String()),
  installDir: Type.Optional(Type.String()),
  platforms: Type.Optional(Type.Record(Type.String(), platformEntrySchema)),
  ecosystems: Type.Optional(Type.Array(Type.String())),
})

const configSchema = Type.Object({
  description: Type.Optional(Type.String()),
  tools: Type.Record(Type.String(), toolSchema),
})

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
const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'))

export const config = parseSchema(configSchema, rawConfig)

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
