/**
 * @fileoverview Emit `xport.schema.json` from the TypeBox schema.
 *
 * The TypeBox schema in `scripts/xport-schema.mts` is the source of truth.
 * TypeBox schemas are JSON Schema natively — no conversion library needed,
 * just serialize the schema object and add the draft-2020-12 meta headers.
 *
 * Run via `pnpm run xport:emit-schema` when the schema changes.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { XportManifestSchema } from './xport-schema.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outPath = path.join(rootDir, 'xport.schema.json')

// TypeBox schemas carry JSON Schema shape directly, plus a Symbol-keyed
// [Kind] marker that JSON.stringify drops. Spreading the schema first
// then layering the canonical $schema / $id / title on top gives a clean
// draft-2020-12 document with the Socket-specific headers.
const enriched = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/SocketDev/xport.schema.json',
  title: 'xport lock-step manifest',
  ...XportManifestSchema,
}

writeFileSync(outPath, JSON.stringify(enriched, null, 2) + '\n', 'utf8')
logger.success(`wrote ${path.relative(rootDir, outPath)}`)
