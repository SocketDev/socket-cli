import { access, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { describe, expect, it } from 'vitest'

import { cleanCliCache } from '../../../scripts/repo/clean-cache.mts'

describe('CLI cache cleanup', () => {
  it('supports dry runs and deletes only the selected cache', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'example-cli-cache-'),
    )
    const cacheDir = path.join(directory, 'cache')
    const sibling = path.join(directory, 'example-source.txt')
    try {
      await mkdir(cacheDir)
      await writeFile(path.join(cacheDir, 'example-entry'), 'example cache')
      await writeFile(sibling, 'example source')
      await cleanCliCache({ cacheDir, dryRun: true })
      await expect(access(cacheDir)).resolves.toBeUndefined()
      await cleanCliCache({ cacheDir })
      await expect(access(cacheDir)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(sibling)).resolves.toBeUndefined()
      await cleanCliCache({ cacheDir })
    } finally {
      await safeDelete(directory)
    }
  })
})
