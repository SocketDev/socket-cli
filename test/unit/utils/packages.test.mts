import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readPackageJson } from '../../../src/utils/packages.mts'

describe('editable package.json', () => {
  let dir: string | undefined

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true })
    }
    dir = undefined
  })

  it('reads and saves UTF-8 BOM input while preserving indentation and line endings', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-package-bom-'))
    const filename = path.join(dir, 'package.json')
    const source = '\uFEFF{\r\n  "name": "before"\r\n}\r\n'
    await fs.writeFile(filename, source)

    const editable = await readPackageJson(filename, { editable: true })
    expect(editable?.content.name).toBe('before')
    editable?.update({ name: 'after' })
    expect(await editable?.save()).toBe(true)
    expect(await fs.readFile(filename, 'utf8')).toBe(
      '\uFEFF{\r\n  "name": "after"\r\n}\r\n',
    )
  })
})
