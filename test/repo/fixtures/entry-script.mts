import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

interface ScriptDescription {
  description: string
  name: string
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export function describeEntryScript(scriptPath: string): ScriptDescription {
  const result = spawnSync(
    process.execPath,
    [scriptPath, '--describe', '--json'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  )
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`entry description failed for ${scriptPath}`)
  }
  return JSON.parse(result.stdout) as ScriptDescription
}
