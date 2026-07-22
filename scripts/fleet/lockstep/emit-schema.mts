/**
 * @file Emit `.config/fleet/lockstep.schema.json` from the TypeBox schema. The
 *   TypeBox schema in `scripts/fleet/lockstep/schema.mts` is the source of
 *   truth. TypeBox schemas are JSON Schema natively — no conversion library
 *   needed, just serialize the schema object and add the draft-2020-12 meta
 *   headers. The schema is fleet-identical, so it lives under `.config/fleet/`
 *   (segregated from the repo-owned `.config/repo/lockstep.json` manifest). Run
 *   via `pnpm run lockstep:emit-schema` when the schema changes.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { LOCKSTEP_SCHEMA, REPO_ROOT } from '../paths.mts'
import { LockstepManifestSchema } from './schema.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const rootDir = REPO_ROOT
const outPath = LOCKSTEP_SCHEMA

// TypeBox schemas carry JSON Schema shape directly, plus a Symbol-keyed
// [Kind] marker that JSON.stringify drops. Spreading the schema first
// then layering the canonical $schema / $id / title on top gives a clean
// draft-2020-12 document with the Socket-specific headers.
export function buildLockstepSchemaDocument(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/SocketDev/lockstep.schema.json',
    title: 'lockstep manifest',
    ...LockstepManifestSchema,
  }
}

export async function main(): Promise<void> {
  writeFileSync(
    outPath,
    JSON.stringify(buildLockstepSchemaDocument(), null, 2) + '\n',
    'utf8',
  )

  // Format the output through the package.json wrapper (it owns the config +
  // ignore set; never a bare oxfmt invocation). Without this, `pnpm run check
  // --all` would flag the emitted schema as drifted on every repo that
  // re-emits it. The schema is in IDENTICAL_FILES, so the formatted form is
  // the byte-canonical form fleet-wide.
  await spawn('pnpm', ['run', 'format', outPath], {
    cwd: rootDir,
    stdio: 'inherit',
  })

  logger.success(`wrote ${path.relative(rootDir, outPath)}`)
}

if (isMainModule(import.meta.url)) {
  void main()
}
