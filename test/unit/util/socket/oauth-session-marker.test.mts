import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hasPendingOAuthRefresh } from '../../../../src/util/socket/oauth-session.mts'

let directory = ''
let marker = ''

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'socket-oauth-marker-'))
  marker = path.join(directory, 'rotation.pending')
})

afterEach(async () => {
  await safeDelete(directory)
})

describe('OAuth pending marker', () => {
  it('accepts only a missing marker as absent', async () => {
    expect(await hasPendingOAuthRefresh(marker)).toBe(false)
  })

  it('detects a durable pending marker', async () => {
    await writeFile(marker, '', { mode: 0o600 })
    expect(await hasPendingOAuthRefresh(marker)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'fails closed on a filesystem lookup error',
    async () => {
      await symlink(marker, marker)
      await expect(hasPendingOAuthRefresh(marker)).rejects.toMatchObject({
        code: 'ELOOP',
      })
    },
  )
})
