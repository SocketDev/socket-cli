import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readOrDefaultSocketJsonUpTo } from './socket-json.mts'

import type { SocketJson } from './socket-json.mts'

const fallback = { version: 1 } as SocketJson

async function writeSocketJson(dir: string, data: unknown): Promise<void> {
  await fs.writeFile(
    path.join(dir, 'socket.json'),
    JSON.stringify(data),
    'utf8',
  )
}

describe('readOrDefaultSocketJsonUpTo', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'socket-json-up-to-'))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('returns the fallback when dir is the boundary itself', () => {
    expect(readOrDefaultSocketJsonUpTo(root, root, fallback)).toBe(fallback)
  })

  it("returns the build root's own socket.json when present", async () => {
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(buildRoot, { version: 1, marker: 'own' })

    const result = readOrDefaultSocketJsonUpTo(buildRoot, root, fallback)
    expect((result as { marker?: string }).marker).toBe('own')
  })

  it('walks up to an intermediate ancestor between dir and the boundary', async () => {
    const middle = path.join(root, 'workspace')
    const buildRoot = path.join(middle, 'project')
    await fs.mkdir(buildRoot, { recursive: true })
    await writeSocketJson(middle, { version: 1, marker: 'workspace' })

    const result = readOrDefaultSocketJsonUpTo(buildRoot, root, fallback)
    expect((result as { marker?: string }).marker).toBe('workspace')
  })

  it('falls back when nothing is found between dir and the boundary', async () => {
    const buildRoot = path.join(root, 'workspace', 'project')
    await fs.mkdir(buildRoot, { recursive: true })

    expect(readOrDefaultSocketJsonUpTo(buildRoot, root, fallback)).toBe(
      fallback,
    )
  })

  it('does not walk past the boundary even if an ancestor above it has one', async () => {
    await writeSocketJson(tmpdir(), { version: 1, marker: 'outside-scope' })
    const buildRoot = path.join(root, 'project')
    await fs.mkdir(buildRoot, { recursive: true })

    try {
      expect(readOrDefaultSocketJsonUpTo(buildRoot, root, fallback)).toBe(
        fallback,
      )
    } finally {
      await fs.rm(path.join(tmpdir(), 'socket.json'), { force: true })
    }
  })
})
