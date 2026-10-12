import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateSocketFactsForFix } from './generated-socket-facts.mts'

const mockRunDynamicSbomInference = vi.hoisted(() => vi.fn())

vi.mock('../scan/run-dynamic-sbom-inference.mts', () => ({
  runDynamicSbomInference: mockRunDynamicSbomInference,
}))

describe('generateSocketFactsForFix', () => {
  let cwd: string
  let tmpDir: string
  let existing: string
  let fresh: string

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-fix-facts-cwd-'))
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-fix-facts-tmp-'))
    existing = path.join(cwd, 'pom.xml.socket.facts.json')
    fresh = path.join(cwd, 'sub', 'gradle.socket.facts.json')
    await fs.mkdir(path.dirname(fresh))
    await fs.writeFile(existing, 'original')
  })

  afterEach(async () => {
    await fs.rm(cwd, { force: true, recursive: true })
    await fs.rm(tmpDir, { force: true, recursive: true })
  })

  async function generate() {
    return await generateSocketFactsForFix({
      cwd,
      excludePaths: [],
      existingPaths: [existing],
      findFactsPaths: async () => [existing, fresh].filter(p => existsSync(p)),
      tmpDir,
    })
  }

  it('restores the generated facts per attempt and the original facts afterwards', async () => {
    mockRunDynamicSbomInference.mockImplementation(async () => {
      await fs.writeFile(existing, 'regenerated')
      await fs.writeFile(fresh, 'generated')
      return { factsPaths: [existing, fresh] }
    })

    const generated = await generate()
    await fs.rm(existing)
    await fs.rm(fresh)
    await generated.restore()

    expect(await fs.readFile(existing, 'utf8')).toBe('regenerated')
    expect(await fs.readFile(fresh, 'utf8')).toBe('generated')

    await generated.remove()

    expect(await fs.readFile(existing, 'utf8')).toBe('original')
    expect(existsSync(fresh)).toBe(false)
  })

  it('restores an existing facts file that generation does not rewrite', async () => {
    mockRunDynamicSbomInference.mockImplementation(async () => {
      await fs.writeFile(fresh, 'generated')
      return { factsPaths: [fresh] }
    })

    const generated = await generate()
    await fs.rm(existing)
    await generated.restore()

    expect(await fs.readFile(existing, 'utf8')).toBe('original')
  })

  it('leaves the facts files as they were when generation fails', async () => {
    mockRunDynamicSbomInference.mockImplementation(async () => {
      await fs.writeFile(existing, 'partial')
      await fs.writeFile(fresh, 'partial')
      throw new Error('build root failed')
    })

    await expect(generate()).rejects.toThrow('build root failed')

    expect(await fs.readFile(existing, 'utf8')).toBe('original')
    expect(existsSync(fresh)).toBe(false)
  })
})
