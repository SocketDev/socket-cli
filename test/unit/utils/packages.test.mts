import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  readPackageJson,
  toEditablePackageJson,
} from '@socketsecurity/registry/lib/packages'

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

  it('saves sync with its original format and clears willSave after saving', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-package-sync-'))
    const filename = path.join(dir, 'package.json')
    await fs.writeFile(filename, '\uFEFF{\r\n  "name": "before"\r\n}\r\n')

    const editable = await readPackageJson(filename, { editable: true })
    expect(editable?.content.name).toBe('before')
    editable?.update({ name: 'after' })
    expect(editable?.willSave()).toBe(true)
    expect(await editable?.saveSync()).toBe(true)
    expect(editable?.willSave()).toBe(false)
    expect(await fs.readFile(filename, 'utf8')).toBe(
      '\uFEFF{\r\n  "name": "after"\r\n}\r\n',
    )
  })

  it('uses the supplied package JSON when creating an editable package', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-package-supplied-'))
    const filename = path.join(dir, 'package.json')
    await fs.writeFile(filename, '{\n  "name": "on-disk"\n}\n')
    const editable = await toEditablePackageJson(
      { name: 'supplied', version: '1.0.0' },
      { path: filename },
    )

    expect(editable.content.name).toBe('supplied')
    editable.update({ name: 'updated' })
    expect(await editable.save()).toBe(true)
    expect(JSON.parse(await fs.readFile(filename, 'utf8'))).toMatchObject({
      name: 'updated',
      version: '1.0.0',
    })
  })
})
