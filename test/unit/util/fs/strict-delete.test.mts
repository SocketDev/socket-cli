import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import {
  deleteRefusalReason,
  strictDelete,
} from '../../../../src/util/fs/strict-delete.mts'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.allSettled(
    cleanupPaths.splice(0).map(filepath => safeDelete(filepath)),
  )
})

describe('strictDelete', () => {
  it.each(['', '.', './'])('refuses unsafe target %j', target => {
    expect(deleteRefusalReason(target)).toBe(
      'the target is empty or resolves to the current directory',
    )
  })

  it('refuses filesystem roots and paths outside the base', () => {
    expect(deleteRefusalReason(path.parse(process.cwd()).root)).toBe(
      'the target is a filesystem root',
    )
    expect(deleteRefusalReason('/example/outside', '/example/base')).toBe(
      'the target sits outside the base directory',
    )
  })

  it('deletes a target strictly below the base', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-cli-delete-'))
    cleanupPaths.push(base)
    const target = path.join(base, 'example.txt')
    await fs.writeFile(target, 'example')

    await strictDelete(target, { base })

    expect(existsSync(target)).toBe(false)
  })
})
