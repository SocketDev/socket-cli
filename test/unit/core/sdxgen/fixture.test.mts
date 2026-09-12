import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { expect, it } from 'vitest'

import { generateSdxgenManifest } from '../../../../src/core/sdxgen/generate.mts'

it('loads the bundled generator and parses a project manifest', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'socket-sdxgen-fixture-'),
  )
  try {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: 'example-project', version: '1.2.3' }),
    )
    const result = await generateSdxgenManifest(directory)
    expect(result.bomFormat).toBe('CycloneDX')
    expect(result['metadata']).toEqual(
      expect.objectContaining({
        component: expect.objectContaining({
          name: 'example-project',
          version: '1.2.3',
        }),
      }),
    )
  } finally {
    await safeDelete(directory, { maxRetries: 0 })
  }
})
