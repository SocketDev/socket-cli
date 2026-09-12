import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, it } from 'vitest'

import packageManifest from '../../../package.json' with { type: 'json' }

it('runs the package coverage command through the fleet entry', () => {
  const [command, entry, ...extra] = packageManifest.scripts.cover.split(' ')
  expect(command).toBe('node')
  expect(extra).toEqual([])
  expect(entry).toBe('scripts/fleet/cover.mts')
  const result = spawnSync(process.execPath, [entry!, '--describe'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    encoding: 'utf8',
  })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('cover')
})
